import { BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import {
  upsertActorByName,
  upsertGenreByName,
  replaceFilmActors,
  replaceFilmGenres,
  replaceFilmTags,
  replaceFilmFiles,
} from '../db/queries';
import { listFilmFiles } from '../scanner/walker';
import { loadDriveMappings, realToVirtual, virtualToReal } from '../util/driveMap';
import {
  scrapeJavbus,
  fetchBinary,
  safeFileBase,
  formatScrapeNotes,
  sniffJavbusWorkResources,
} from '../scraper/javbus';
import * as log from '../util/logger';
import { getCurrentLogFile, getLogDir } from '../util/logger';

const TAG = 'scrape';

function readIntSetting(key: string, fallback: number, min: number, max: number): number {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    const n = Number(row?.value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  } catch {
    return fallback;
  }
}

/** 图片下载超时（毫秒）。设置项 scrape_image_timeout_ms，默认 10s。 */
function imageTimeoutMs(): number {
  return readIntSetting('scrape_image_timeout_ms', 10_000, 3_000, 60_000);
}

/** 单片内预览图并发。设置项 scrape_sample_concurrency，默认 6。 */
function sampleConcurrency(): number {
  return readIntSetting('scrape_sample_concurrency', 6, 1, 16);
}

/** 批量影片并发。设置项 scrape_film_concurrency，默认 6。 */
export function filmConcurrencyDefault(): number {
  return readIntSetting('scrape_film_concurrency', 6, 1, 16);
}

/** 刮削范围开关：'0'/'false'/'off' 为关，其它为开；缺省默认开。 */
function scrapeFlag(key: string, defaultOn = true): boolean {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    if (row?.value == null || row.value === '') return defaultOn;
    const v = String(row.value).toLowerCase();
    return !(v === '0' || v === 'false' || v === 'off');
  } catch {
    return defaultOn;
  }
}

function scrapeScope() {
  return {
    title: scrapeFlag('scrape_enable_title', true),
    meta: scrapeFlag('scrape_enable_meta', true), // 演员/题材/备注/发行信息
    cover: scrapeFlag('scrape_enable_cover', true),
    // 样图默认关：DMM sample 常超时，关掉可明显提速
    samples: scrapeFlag('scrape_enable_samples', false),
  };
}

export interface ScrapeProgress {
  filmId: number;
  stage: 'start' | 'page' | 'cover' | 'samples' | 'meta' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

function emitProgress(p: ScrapeProgress) {
  log.info(TAG, `progress film=${p.filmId} ${p.stage} ${p.current}/${p.total} ${p.message}`);
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('scrape:progress', p);
  }
}

function listExistingBasenames(dir: string): Set<string> {
  const out = new Set<string>();
  try {
    for (const name of fs.readdirSync(dir)) out.add(name.toLowerCase());
  } catch {
    // ignore
  }
  return out;
}

function pickCoverRel(dir: string, preferred: string | null): string | null {
  if (preferred) {
    const abs = path.join(dir, preferred);
    if (fs.existsSync(abs)) return preferred;
  }
  try {
    let best: { name: string; size: number } | null = null;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) continue;
      const st = fs.statSync(path.join(dir, name));
      if (!best || st.size > best.size) best = { name, size: st.size };
    }
    return best?.name ?? null;
  } catch {
    return null;
  }
}

/** 简单并发池：最多 limit 个 promise 同时跑。 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function scrapeOneFilm(filmId: number) {
  const tAll = log.timed(TAG, `film#${filmId}`);
  const db = getDb();
  const film = db.prepare('SELECT * FROM films WHERE id=?').get(filmId) as any;
  if (!film) throw new Error('影片不存在');
  if (!film.code) throw new Error('影片编号为空，无法刮削');

  emitProgress({ filmId, stage: 'start', current: 0, total: 1, message: `开始 ${String(film.code).toUpperCase()}` });

  const settingsRow = db.prepare("SELECT value FROM settings WHERE key='javbus_base_url'").get() as { value: string } | undefined;
  const baseUrl = (settingsRow?.value ?? '').trim();
  if (!baseUrl) throw new Error('请先在「设置」里配置 JavBus 站点地址（javbus_base_url）');

  const scope = scrapeScope();
  log.info(TAG, `film#${filmId} code=${film.code} base=${baseUrl} path=${film.abs_path} scope=${JSON.stringify(scope)}`);

  emitProgress({ filmId, stage: 'page', current: 0, total: 1, message: '请求详情页…' });
  const tPage = log.timed(TAG, `film#${filmId} page`);
  let scraped;
  try {
    scraped = await scrapeJavbus(baseUrl, film.code);
    tPage('ok', { title: scraped.title, samples: scraped.sampleUrls.length, cover: !!scraped.coverUrl });
  } catch (e: unknown) {
    tPage('fail', String((e as Error)?.message ?? e));
    throw e;
  }

  // 盘符映射：库内虚拟盘符 -> 磁盘真实盘符；下载的图写进真实目录，清单仍按虚拟路径入库。
  const mappings = loadDriveMappings(db);
  const realDir = film.abs_path ? virtualToReal(film.abs_path, mappings) : '';
  const dirExists = !!(realDir && fs.existsSync(realDir));
  const written: string[] = [];
  let coverRel: string | null = film.cover_path ?? null;
  let samplesOk = 0;
  let samplesFail = 0;
  let samplesSkip = 0;

  if (dirExists && (scope.cover || scope.samples)) {
    const existing = listExistingBasenames(realDir);
    const baseName = safeFileBase(scraped.title || scraped.code);

    // —— 封面 ——
    if (scope.cover) {
      emitProgress({ filmId, stage: 'cover', current: 0, total: 1, message: '处理封面…' });
      if (scraped.coverUrl) {
        const coverFile = `${baseName}.jpg`;
        if (!existing.has(coverFile.toLowerCase())) {
          const tCover = log.timed(TAG, `film#${filmId} cover`);
          try {
            const buf = await fetchBinary(scraped.coverUrl, imageTimeoutMs());
            fs.writeFileSync(path.join(realDir, coverFile), buf);
            written.push(coverFile);
            existing.add(coverFile.toLowerCase());
            coverRel = coverFile;
            tCover('ok', { bytes: buf.length, file: coverFile });
          } catch (e: unknown) {
            tCover('fail', String((e as Error)?.message ?? e));
            log.warn(TAG, `cover fail film#${filmId}`, String((e as Error)?.message ?? e));
          }
        } else {
          coverRel = coverRel || coverFile;
          log.info(TAG, `film#${filmId} cover skip exists ${coverFile}`);
        }
        if (!coverRel) coverRel = pickCoverRel(realDir, null);
      }
    } else {
      log.info(TAG, `film#${filmId} cover skipped by setting`);
    }

    // —— 预览样图（sample-box）：默认关闭，因 DMM 图床常超时 ——
    if (scope.samples) {
      const samples = scraped.sampleUrls;
      const totalS = samples.length;
      emitProgress({ filmId, stage: 'samples', current: 0, total: Math.max(totalS, 1), message: totalS ? `下载预览 0/${totalS}` : '无预览图' });

      if (totalS > 0) {
        let finished = 0;
        const imgTimeout = imageTimeoutMs();
        const sampleConc = sampleConcurrency();
        log.info(TAG, `film#${filmId} samples n=${totalS} concurrency=${sampleConc} timeout=${imgTimeout}ms`);
        await mapPool(samples, sampleConc, async (url, i) => {
          const sampleFile = `${baseName}-${i + 1}.jpg`;
          if (existing.has(sampleFile.toLowerCase())) {
            samplesSkip++;
            finished++;
            emitProgress({ filmId, stage: 'samples', current: finished, total: totalS, message: `预览 ${finished}/${totalS} 跳过 ${sampleFile}` });
            return;
          }
          const t0 = Date.now();
          try {
            const buf = await fetchBinary(url, imgTimeout);
            fs.writeFileSync(path.join(realDir, sampleFile), buf);
            written.push(sampleFile);
            existing.add(sampleFile.toLowerCase());
            samplesOk++;
            log.info(TAG, `film#${filmId} sample ok ${sampleFile} ${buf.length}b ${Date.now() - t0}ms`);
          } catch (e: unknown) {
            samplesFail++;
            log.warn(TAG, `film#${filmId} sample fail #${i + 1} ${Date.now() - t0}ms`, String((e as Error)?.message ?? e));
          } finally {
            finished++;
            emitProgress({
              filmId,
              stage: 'samples',
              current: finished,
              total: totalS,
              message: `预览 ${finished}/${totalS}（成功 ${samplesOk} 失败 ${samplesFail} 跳过 ${samplesSkip}）`,
            });
          }
        });
      }
    } else {
      emitProgress({ filmId, stage: 'samples', current: 0, total: 0, message: '已跳过样图下载（设置关闭）' });
      log.info(TAG, `film#${filmId} samples skipped by setting`);
    }

    if (!coverRel && scope.cover) coverRel = pickCoverRel(realDir, written[0] ?? null);

    if (written.length > 0 || scope.cover || scope.samples) {
      const files = listFilmFiles(realDir).map(f => ({ ...f, abs_path: realToVirtual(f.abs_path, mappings) }));
      replaceFilmFiles(db, filmId, files);
      log.info(TAG, `film#${filmId} restat files=${files.length} written=${written.length}`);
    }
  } else if (!dirExists) {
    log.info(TAG, `film#${filmId} dir missing, meta only: ${film.abs_path}`);
  }

  // —— 元数据（标题 / 演员题材备注）——
  emitProgress({ filmId, stage: 'meta', current: 1, total: 1, message: '写入元数据…' });
  const newTitle = scope.title ? (scraped.title || film.title) : film.title;
  const newCode = film.code;

  const actorIds: number[] = [];
  const genreIds: number[] = [];
  let tags: string[] = [];
  let newNotes: string | null = film.notes ?? null;
  // 制作商/发行商：受 meta 开关控制（与演员/题材一致）。刮到才覆盖，未刮到则保留原值。
  let newStudio: string | null = film.studio ?? null;
  let newLabel: string | null = film.label ?? null;

  if (scope.meta) {
    for (const name of scraped.actresses) {
      const n = (name ?? '').trim();
      if (!n) continue;
      try {
        const id = upsertActorByName(db, n, n);
        actorIds.push(id);
        log.info(TAG, `film#${filmId} actress "${n}" → actor_id=${id}`);
      } catch (e: unknown) {
        log.warn(TAG, `film#${filmId} actress upsert fail "${n}"`, String((e as Error)?.message ?? e));
      }
    }
    for (const g of scraped.genres) {
      try { genreIds.push(upsertGenreByName(db, g)); } catch { /* ignore */ }
    }
    const oldTags = (db.prepare('SELECT tag FROM film_tags WHERE film_id=?').all(filmId) as { tag: string }[]).map(t => t.tag);
    tags = Array.from(new Set([...oldTags, ...scraped.genres]));

    // 制作商/发行商独立字段；刮到非空值才覆盖。
    if (scraped.studio && scraped.studio.trim()) newStudio = scraped.studio.trim();
    if (scraped.label && scraped.label.trim()) newLabel = scraped.label.trim();

    const scrapeNote = formatScrapeNotes(scraped);
    if (scrapeNote) {
      if (!newNotes) newNotes = scrapeNote;
      else if (!newNotes.includes(scraped.pageUrl)) newNotes = `${newNotes.trim()}\n\n[JavBus]\n${scrapeNote}`;
    }
  }

  const scrapedAt = nowMs();
  const newScanStatus = newCode && newTitle ? 'parsed' : (newCode || newTitle ? 'partial' : 'unknown');
  tx(db, () => {
    // 始终更新 scraped_at；title/cover/notes/studio/label 按开关写
    if (scope.title || scope.cover || scope.meta) {
      db.prepare(
        `UPDATE films SET
          title=?,
          cover_path=COALESCE(?, cover_path),
          notes=?,
          studio=?,
          label=?,
          scraped_at=?,
          updated_at=?,
          scan_status=?
         WHERE id=?`
      ).run(newTitle, scope.cover ? coverRel : null, newNotes,
        newStudio, newLabel,
        scrapedAt, scrapedAt, newScanStatus, filmId);
    } else {
      // 仅样图等极端情况也打标记
      db.prepare(`UPDATE films SET scraped_at=?, updated_at=? WHERE id=?`).run(scrapedAt, scrapedAt, filmId);
    }

    if (scope.meta) {
      if (actorIds.length) {
        const existing = (db.prepare('SELECT actor_id FROM film_actors WHERE film_id=?').all(filmId) as { actor_id: number }[]).map(r => r.actor_id);
        replaceFilmActors(db, filmId, Array.from(new Set([...existing, ...actorIds])));
      }
      if (genreIds.length) {
        const existing = (db.prepare('SELECT genre_id FROM film_genres WHERE film_id=?').all(filmId) as { genre_id: number }[]).map(r => r.genre_id);
        replaceFilmGenres(db, filmId, Array.from(new Set([...existing, ...genreIds])));
      }
      if (tags.length) replaceFilmTags(db, filmId, tags);
    }
  });

  const result = {
    ok: true as const,
    title: newTitle,
    code: newCode,
    pageUrl: scraped.pageUrl,
    actresses: scraped.actresses,
    genres: scraped.genres,
    samplesFound: scope.samples ? scraped.sampleUrls.length : 0,
    samplesOk,
    samplesFail,
    samplesSkip,
    filesWritten: written,
    coverPath: coverRel,
    dirExists: !!dirExists,
    releaseDate: scraped.releaseDate,
    studio: scraped.studio,
    label: scraped.label,
    scraped_at: scrapedAt,
    scope,
    logFile: getCurrentLogFile(),
  };

  emitProgress({
    filmId,
    stage: 'done',
    current: 1,
    total: 1,
    message: `完成 写文件 ${written.length}`
      + (scope.samples ? ` 预览 ${samplesOk}/${scraped.sampleUrls.length}` : ' 样图已跳过'),
  });
  tAll('ok', { written: written.length, samplesOk, samplesFail, samplesSkip, scope });
  return result;
}

/** 批量任务：主进程持有，切页面不打断。 */
export interface BatchScrapeProgress {
  running: boolean;
  done: number;
  total: number;
  ok: number;
  fail: number;
  skip: number;
  /** 当前正在跑的编号（并发时可能多个） */
  active: string[];
  message: string;
  finished?: boolean;
  cancelled?: boolean;
}

let batchRunning = false;
let batchCancel = false;
let lastBatchProgress: BatchScrapeProgress = {
  running: false, done: 0, total: 0, ok: 0, fail: 0, skip: 0, active: [], message: '',
};

function emitBatchProgress(p: BatchScrapeProgress) {
  lastBatchProgress = p;
  log.info(TAG, `batch ${p.done}/${p.total} ok=${p.ok} fail=${p.fail} active=[${p.active.join(',')}] ${p.message}`);
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('scrape:batchProgress', p);
  }
}

async function runBatchScrape(filmIds: number[], concurrency: number): Promise<BatchScrapeProgress> {
  batchRunning = true;
  batchCancel = false;
  const ids = filmIds.filter(id => Number.isFinite(id) && id > 0);
  const total = ids.length;
  let done = 0;
  let ok = 0;
  let fail = 0;
  let skip = 0;
  const active = new Map<number, string>();

  const snapshot = (message: string, finished = false): BatchScrapeProgress => ({
    running: !finished,
    done,
    total,
    ok,
    fail,
    skip,
    active: Array.from(active.values()),
    message,
    finished,
    cancelled: batchCancel,
  });

  try {
    emitBatchProgress(snapshot('批量刮削开始'));

    await mapPool(ids, Math.max(1, Math.min(concurrency, 16)), async (filmId) => {
      if (batchCancel) {
        skip++;
        done++;
        emitBatchProgress(snapshot('已取消，跳过剩余'));
        return;
      }

      const film = getDb().prepare('SELECT id, code, scraped_at FROM films WHERE id=?').get(filmId) as
        { id: number; code: string | null; scraped_at: number | null } | undefined;
      const codeLabel = film?.code ? film.code.toUpperCase() : `#${filmId}`;
      if (!film?.code) {
        skip++;
        done++;
        emitBatchProgress(snapshot(`跳过无编号 ${codeLabel}`));
        return;
      }
      // 已刮削过的跳过，避免重复耗时
      if (film.scraped_at) {
        skip++;
        done++;
        emitBatchProgress(snapshot(`跳过已刮削 ${codeLabel}`));
        log.info(TAG, `batch skip already scraped film#${filmId} at ${film.scraped_at}`);
        return;
      }

      active.set(filmId, codeLabel);
      emitBatchProgress(snapshot(`刮削中 ${codeLabel}`));
      try {
        await scrapeOneFilm(filmId);
        ok++;
      } catch (e: unknown) {
        fail++;
        log.error(TAG, `batch film#${filmId} fail`, String((e as Error)?.message ?? e));
        // 标记刮削失败，后续自动刮削跳过
        try { getDb().prepare('UPDATE films SET scrape_failed_at=? WHERE id=?').run(nowMs(), filmId); } catch {}
      } finally {
        active.delete(filmId);
        done++;
        emitBatchProgress(snapshot(batchCancel ? '收尾中…' : `进度 ${done}/${total}`));
      }
    });

    const final = snapshot(batchCancel ? '批量刮削已停止' : '批量刮削完成', true);
    emitBatchProgress(final);
    return final;
  } catch (error: unknown) {
    const failed = snapshot('批量刮削异常中止', true);
    try {
      emitBatchProgress(failed);
    } catch (emitError: unknown) {
      log.error(TAG, 'failed to emit batch abort progress', String((emitError as Error)?.message ?? emitError));
    }
    throw error;
  } finally {
    // 主进程任务异常也必须释放互斥状态，否则后续扫描和手动批量会永久误判为仍在运行。
    batchRunning = false;
  }
}

export function isBatchScrapeRunning(): boolean {
  return batchRunning;
}

/** 扫描自动续刮与手动批量刮削共用同一主进程任务入口。 */
export async function startBatchScrape(
  filmIds: number[],
  concurrency = filmConcurrencyDefault(),
): Promise<BatchScrapeProgress> {
  if (batchRunning) throw new Error('已有批量刮削任务在进行，请等待完成或先停止');
  if (!Array.isArray(filmIds) || filmIds.length === 0) throw new Error('未选择影片');
  log.info(TAG, `batch start n=${filmIds.length} concurrency=${concurrency}`);
  return runBatchScrape(filmIds, concurrency);
}

export function registerScrapeIpc() {
  ipcMain.handle('scrape:javbus', async (_e, filmId: number) => {
    try {
      return await scrapeOneFilm(filmId);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      log.error(TAG, `film#${filmId} failed`, msg);
      emitProgress({ filmId, stage: 'error', current: 0, total: 1, message: msg });
      // 附带日志路径，方便用户在 toast 里看到
      const logPath = getCurrentLogFile();
      throw new Error(logPath ? `${msg}\n日志: ${logPath}` : msg);
    }
  });

  // 批量：主进程并行跑，与渲染进程页面生命周期解耦——切页不中断。
  ipcMain.handle('scrape:javbusBatch', async (_e, filmIds: number[], concurrency?: number) => {
    return startBatchScrape(filmIds, concurrency ?? filmConcurrencyDefault());
  });

  ipcMain.handle('scrape:cancelBatch', () => {
    if (!batchRunning) return { ok: false, message: '当前没有批量任务' };
    batchCancel = true;
    log.info(TAG, 'batch cancel requested');
    emitBatchProgress({ ...lastBatchProgress, message: '正在停止…', cancelled: true });
    return { ok: true };
  });

  ipcMain.handle('scrape:getBatchStatus', () => lastBatchProgress);

  ipcMain.handle('scrape:openLogDir', async () => {
    const dir = getLogDir();
    if (!dir) return { ok: false, error: '日志目录未初始化' };
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return { ok: err === '', path: dir, error: err || undefined, currentFile: getCurrentLogFile() };
  });

  ipcMain.handle('scrape:getLogPath', () => ({
    dir: getLogDir(),
    file: getCurrentLogFile(),
  }));

  // 嗅探作品详情页的磁力/种子资源（演员页「最新作品」点击展开用）。
  ipcMain.handle('scrape:workResources', async (_e, rawUrl: string) => {
    const r = await sniffJavbusWorkResources(rawUrl);
    log.info(TAG, `work resources url=${rawUrl} magnets=${r.magnets.length} torrents=${r.torrents.length}`);
    return r;
  });
}
