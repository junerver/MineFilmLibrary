import type Database from 'better-sqlite3';
import path from 'node:path';
import { parseFilmDirName, parseParentDirName } from './parser';
import { listFilmFiles, walkFilmDirs } from './walker';
import { nowMs, tx } from '../db/dao';
import {
  upsertActorByName, upsertGenreByName,
  replaceFilmActors, replaceFilmGenres, replaceFilmTags, replaceFilmFiles,
  filmCodeExists, listAllFilmPaths, recomputeCodeCounts,
} from '../db/queries';
import type { ParsedDir, ScanMode } from '../util/types';

export interface ProgressCb { (p: ScanProgress): void; }
export interface ScanProgress { stage: 'scan' | 'scrape' | 'fallback'; current: number; total: number; currentPath: string; }

export interface ScannerOptions {
  mode: ScanMode;
  rootPath: string;
  defaultType: 'actor' | 'genre';
  /** 影片目录相对扫描根目录的最大层级，默认 3。 */
  maxDepth?: number;
  onProgress?: ProgressCb;
}

export interface ScanStats {
  dir_seen: number;
  dir_added: number;
  dir_updated: number;
  dir_removed: number;
}

/** 扫描阶段暂存的旧规则结果，仅在刮削失败时用于兜底。 */
export interface ScanAddedFilm {
  filmId: number;
  code: string | null;
  absPath: string;
  initializeMetadata: boolean;
  parsed: ParsedDir;
  parentDirName: string;
  defaultType: 'actor' | 'genre';
  coverRel: string | null;
}

export interface ScanResult extends ScanStats {
  addedFilms: ScanAddedFilm[];
}

export function runScan(db: Database.Database, opts: ScannerOptions): ScanResult {
  const stats: ScanStats = { dir_seen: 0, dir_added: 0, dir_updated: 0, dir_removed: 0 };
  const addedFilms: ScanAddedFilm[] = [];
  const visits = Array.from(walkFilmDirs(opts.rootPath, opts.maxDepth));

  // Windows 路径大小写不敏感。数据库中可能保留了旧路径的不同大小写，
  // 用标准化 key 匹配可避免重扫时把同一目录当成新片重复插入。
  const pathKey = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const baseline = new Map(listAllFilmPaths(db, opts.rootPath).map(r => [pathKey(r.abs_path), r]));

  for (const v of visits) {
    stats.dir_seen++;
    opts.onProgress?.({ stage: 'scan', current: stats.dir_seen, total: visits.length, currentPath: v.filmAbsPath });

    const key = pathKey(v.filmAbsPath);
    const prev = baseline.get(key);
    if (opts.mode === 'incremental' && prev && v.mtime_ms === prev.fs_mtime_ms) {
      baseline.delete(key);
      continue;
    }

    const files = listFilmFiles(v.filmAbsPath);

    if (prev) {
      const dirChanged = v.mtime_ms !== prev.fs_mtime_ms;
      tx(db, () => {
        if (dirChanged) {
          // 已有影片的业务元数据可能来自手工维护或刮削。目录 mtime 变化只说明
          // 文件清单需要刷新，绝不能重新用目录名覆盖标题、封面、关联等字段。
          db.prepare('UPDATE films SET fs_mtime_ms=?, updated_at=? WHERE id=?')
            .run(v.mtime_ms, nowMs(), prev.id);
        }
        replaceFilmFiles(db, prev.id, files);
      });
      if (dirChanged) stats.dir_updated++;
      baseline.delete(key);
      continue;
    }

    const parsed = parseFilmDirName(v.filmDirName);
    // 扫描只负责建立路径/编号/文件清单。目录名解析结果暂存为刮削失败时的
    // 兜底数据，避免扫描阶段直接把目录命名当成正式元数据来源。
    const initializeMetadata = !filmCodeExists(db, parsed.code);
    const cover = files.filter(f => f.is_image).sort((a, b) => b.size - a.size)[0] ?? null;
    const coverRel = cover ? path.relative(v.filmAbsPath, cover.abs_path) : null;

    let filmId = 0;
    tx(db, () => {
      const r = db.prepare(`INSERT INTO films(code, title, raw_dir_name, abs_path, parent_dir_name, parent_type, locale, cover_path, scan_status, fs_mtime_ms, is_deleted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`)
        .run(
          parsed.code,
          null,
          v.filmDirName,
          v.filmAbsPath,
          v.parentDirName,
          null,
          null,
          null,
          parsed.code ? 'partial' : 'unknown',
          v.mtime_ms,
          nowMs(),
          nowMs(),
        );
      filmId = Number(r.lastInsertRowid);
      stats.dir_added++;
      replaceFilmFiles(db, filmId, files);
    });
    addedFilms.push({
      filmId,
      code: parsed.code,
      absPath: v.filmAbsPath,
      initializeMetadata,
      parsed,
      parentDirName: v.parentDirName,
      defaultType: opts.defaultType,
      coverRel,
    });
  }

  // 未在磁盘上见到的路径仍保留数据库记录。目录有效性由详情页实时检查，
  // 扫描不会自动把记录送进回收站，也不会恢复用户手动删除的记录。

  // 重算每部影片的同编号重复计数。扫描过后立刻保证列表徽标反映最新状态；
  // 增量扫描走同一路径，因为增量也可能让某个 code 从 1 份变 2 份（或反之）。
  recomputeCodeCounts(db);

  return { ...stats, addedFilms };
}

/**
 * 刮削失败时给新入库影片应用旧的目录识别结果。
 * 已存在同编号的副本不做兜底初始化，继续保持“只记录路径/编号”的规则。
 */
export function applyScanFallback(db: Database.Database, item: ScanAddedFilm): boolean {
  if (!item.initializeMetadata) return false;
  const parent = parseParentDirName(item.parentDirName, { defaultType: item.defaultType });
  const actorIds: number[] = [];
  const genreIds: number[] = [];

  tx(db, () => {
    if (parent.parent_type === 'actor' && parent.name) {
      actorIds.push(upsertActorByName(db, parent.name, item.parentDirName));
    }
    if (parent.parent_type === 'genre' && parent.name) {
      genreIds.push(upsertGenreByName(db, parent.name));
    }
    db.prepare(`UPDATE films SET
      title=?, locale=?, cover_path=?, parent_type=?, scan_status=?, updated_at=?
      WHERE id=?`)
      .run(
        item.parsed.title,
        item.parsed.locale,
        item.coverRel,
        parent.name ? parent.parent_type : null,
        item.parsed.scan_status,
        nowMs(),
        item.filmId,
      );
    replaceFilmActors(db, item.filmId, actorIds);
    replaceFilmGenres(db, item.filmId, genreIds);
    replaceFilmTags(db, item.filmId, item.parsed.tags);
  });
  return true;
}
