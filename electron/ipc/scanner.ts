import { ipcMain, BrowserWindow } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';
import { listPendingFilmScrapes } from '../db/queries';
import { runScan } from '../scanner';
import type { ScanProgress } from '../scanner';
import { applyUnScrapedAddedFilmFallbacks } from '../scanner/enrich';
import { DEFAULT_SCAN_MAX_DEPTH, MAX_SCAN_MAX_DEPTH, MIN_SCAN_MAX_DEPTH } from '../scanner/walker';
import { filmConcurrencyDefault, isBatchScrapeRunning, startBatchScrape } from './scrape';
import * as log from '../util/logger';

const TAG = 'scanner';

export function registerScannerIpc(progressKey = 'scanner:progress') {
  ipcMain.handle('scanner:listRoots', () => getDb().prepare('SELECT * FROM scan_roots ORDER BY id').all());
  ipcMain.handle('scanner:addRoot', async (_e, p: string, label?: string) => {
    try {
      const r = getDb().prepare('INSERT INTO scan_roots(path, label, last_full_scan_at, last_incremental_scan_at, enabled) VALUES(?,?,?,?,1)')
        .run(p, label ?? null, null, null);
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('scanner:removeRoot', (_e, id: number) => {
    getDb().prepare('DELETE FROM scan_roots WHERE id=?').run(id);
    return true;
  });

  async function run(rootId: number, mode: 'full' | 'incremental') {
    const root = getDb().prepare('SELECT * FROM scan_roots WHERE id=?').get(rootId) as any;
    if (!root) throw new Error('root not found');
    const runRow = getDb().prepare('INSERT INTO scan_runs(root_id, mode, started_at, status) VALUES(?,?,?,?)').run(rootId, mode, nowMs(), 'running');
    const runId = Number(runRow.lastInsertRowid);

    const settingsRow = getDb().prepare("SELECT value FROM settings WHERE key='default_parent_type'").get() as { value: string } | undefined;
    const defaultType = settingsRow?.value === 'genre' ? 'genre' : 'actor';
    const depthRow = getDb().prepare("SELECT value FROM settings WHERE key='scan_max_depth'").get() as { value: string } | undefined;
    const rawDepth = Number(depthRow?.value);
    const maxDepth = Number.isFinite(rawDepth)
      ? Math.max(MIN_SCAN_MAX_DEPTH, Math.min(MAX_SCAN_MAX_DEPTH, Math.floor(rawDepth)))
      : DEFAULT_SCAN_MAX_DEPTH;
    // 自动包装裸视频：默认关闭，设置键 scan_wrap_loose_videos='1' 时开启。
    const wrapRow = getDb().prepare("SELECT value FROM settings WHERE key='scan_wrap_loose_videos'").get() as { value: string } | undefined;
    const wrapLoose = wrapRow?.value === '1';

    let errorMessage: string | null = null;
    try {
      const onProgress = (p: ScanProgress) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(progressKey, { runId, ...p });
        }
      };
      const scanResult = runScan(getDb(), {
        mode,
        rootPath: root.path,
        defaultType: defaultType as 'actor' | 'genre',
        maxDepth,
        wrapLoose,
        onProgress,
      });
      if (scanResult.wrap) {
        const w = scanResult.wrap;
        log.info(TAG, `wrap loose root=${root.path} seen=${w.loose_seen} into_existing=${w.into_existing} into_new=${w.into_new} skipped=${w.skipped} failed=${w.failed}`);
      }
      const { addedFilms, ...scanStats } = scanResult;
      const pendingFilms = listPendingFilmScrapes(getDb(), root.path);
      const addedIds = new Set(addedFilms.map(film => film.filmId));
      const scrapeResumed = pendingFilms.filter(film => !addedIds.has(film.id)).length;
      let scrapeOk = 0;
      let scrapeFail = 0;
      let scrapeBatchSkipped = 0;
      let scrapeDeferred = 0;

      if (pendingFilms.length > 0) {
        if (isBatchScrapeRunning()) {
          scrapeDeferred = pendingFilms.length;
          log.warn(TAG, `auto batch deferred: another batch is running, pending=${pendingFilms.length}`);
        } else {
          log.info(
            TAG,
            `auto batch start root=${root.path} pending=${pendingFilms.length} resumed=${scrapeResumed}`,
          );
          const batch = await startBatchScrape(
            pendingFilms.map(film => film.id),
            filmConcurrencyDefault(),
          );
          scrapeOk = batch.ok;
          scrapeFail = batch.fail;
          scrapeBatchSkipped = batch.skip;
        }
      }

      const fallback = applyUnScrapedAddedFilmFallbacks(getDb(), addedFilms, p => {
        const currentPath = p.film.absPath;
        onProgress({ stage: p.stage, current: p.current, total: p.total, currentPath });
      });
      const stats = {
        ...scanStats,
        wrap_seen: scanResult.wrap?.loose_seen ?? 0,
        wrap_into_existing: scanResult.wrap?.into_existing ?? 0,
        wrap_into_new: scanResult.wrap?.into_new ?? 0,
        wrap_skipped: scanResult.wrap?.skipped ?? 0,
        wrap_failed: scanResult.wrap?.failed ?? 0,
        scrape_candidates: pendingFilms.length,
        scrape_resumed: scrapeResumed,
        scrape_deferred: scrapeDeferred,
        scrape_ok: scrapeOk,
        scrape_fail: scrapeFail,
        scrape_skipped: scrapeBatchSkipped + fallback.scrape_skipped,
        fallback_applied: fallback.fallback_applied,
        fallback_fail: fallback.fallback_fail,
      };
      const finished = nowMs();
      if (mode === 'full') getDb().prepare('UPDATE scan_roots SET last_full_scan_at=? WHERE id=?').run(finished, rootId);
      else getDb().prepare('UPDATE scan_roots SET last_incremental_scan_at=? WHERE id=?').run(finished, rootId);
      getDb().prepare('UPDATE scan_runs SET finished_at=?, dir_seen=?, dir_added=?, dir_updated=?, dir_removed=?, status=? WHERE id=?')
        .run(finished, stats.dir_seen, stats.dir_added, stats.dir_updated, stats.dir_removed, 'done', runId);
      // 终止事件：让前端的 useScanProgress 把进度条清掉。
      // 把 current/total 设成最终值，万一前端先收到 'done' 时显示一下"扫描完成"也能拿到合理数字。
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(progressKey, { runId, stage: 'done', current: stats.dir_seen, total: stats.dir_seen, currentPath: '' });
      }
      return { ok: true, stats };
    } catch (err: any) {
      errorMessage = err.message;
      getDb().prepare('UPDATE scan_runs SET finished_at=?, status=?, error_message=? WHERE id=?').run(nowMs(), 'error', errorMessage, runId);
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(progressKey, { runId, stage: 'error', current: 0, total: 0, currentPath: '', errorMessage });
      }
      return { ok: false, error: errorMessage };
    }
  }

  ipcMain.handle('scanner:runFull', (_e, rootId: number) => run(rootId, 'full'));
  ipcMain.handle('scanner:runIncremental', (_e, rootId: number) => run(rootId, 'incremental'));
  ipcMain.handle('scanner:clearHistory', () => {
    getDb().prepare('DELETE FROM scan_runs').run();
    return true;
  });

  ipcMain.handle('scanner:listRuns', (_e, limit = 50) => getDb().prepare(`
    SELECT r.*, sr.path AS root_path
    FROM scan_runs r
    LEFT JOIN scan_roots sr ON sr.id = r.root_id
    ORDER BY r.started_at DESC LIMIT ?
  `).all(limit));
}
