import type Database from 'better-sqlite3';
import path from 'node:path';
import { parseFilmDirName, parseParentDirName } from './parser';
import { listFilmFiles, walkFilmDirs } from './walker';
import { nowMs, tx } from '../db/dao';
import {
  upsertActorByName, upsertGenreByName,
  replaceFilmActors, replaceFilmGenres, replaceFilmTags, replaceFilmFiles,
  listAllFilmPaths, markSoftDeleted, recomputeCodeCounts,
} from '../db/queries';
import type { ScanMode } from '../util/types';

export interface ProgressCb { (p: ScanProgress): void; }
export interface ScanProgress { stage: string; current: number; total: number; currentPath: string; }

export interface ScannerOptions {
  mode: ScanMode;
  rootPath: string;
  defaultType: 'actor' | 'genre';
  onProgress?: ProgressCb;
}

export interface ScanStats {
  dir_seen: number;
  dir_added: number;
  dir_updated: number;
  dir_removed: number;
}

export function runScan(db: Database.Database, opts: ScannerOptions): ScanStats {
  const stats: ScanStats = { dir_seen: 0, dir_added: 0, dir_updated: 0, dir_removed: 0 };
  const visits = Array.from(walkFilmDirs(opts.rootPath));

  const baseline = new Map(listAllFilmPaths(db, opts.rootPath).map(r => [r.abs_path, r]));

  for (const v of visits) {
    stats.dir_seen++;
    opts.onProgress?.({ stage: 'scan', current: stats.dir_seen, total: visits.length, currentPath: v.filmAbsPath });

    const prev = baseline.get(v.filmAbsPath);
    if (opts.mode === 'incremental' && prev && v.mtime_ms === prev.fs_mtime_ms) {
      baseline.delete(v.filmAbsPath);
      continue;
    }

    const parsed = parseFilmDirName(v.filmDirName);
    const parentId = parseParentDirName(v.parentDirName, { defaultType: opts.defaultType });
    // 平铺根扫描时 parentId.name 为 null；这种情况下 parent_type 也应落空，
    // 避免在 films 表留下误导性的 'actor'/'genre' 标记（详情页能据此判断无归属）。
    const effectiveParentType = parentId.name ? parentId.parent_type : null;

    const files = listFilmFiles(v.filmAbsPath);
    const cover = files.filter(f => f.is_image).sort((a, b) => b.size - a.size)[0] ?? null;
    const coverRel = cover ? path.relative(v.filmAbsPath, cover.abs_path) : null;

    const actorIds: number[] = [];
    const genreIds: number[] = [];
    if (parentId.parent_type === 'actor' && parentId.name) actorIds.push(upsertActorByName(db, parentId.name, v.parentDirName));
    if (parentId.parent_type === 'genre' && parentId.name) genreIds.push(upsertGenreByName(db, parentId.name));

    tx(db, () => {
      let filmId: number;
      if (prev) {
        db.prepare(`UPDATE films SET code=?, title=?, raw_dir_name=?, parent_dir_name=?, parent_type=?, locale=?, cover_path=?, scan_status=?, fs_mtime_ms=?, is_deleted=0, updated_at=? WHERE id=?`)
          .run(parsed.code, parsed.title, v.filmDirName, v.parentDirName, effectiveParentType, parsed.locale, coverRel, parsed.scan_status, v.mtime_ms, nowMs(), prev.id);
        filmId = prev.id;
        if (v.mtime_ms !== prev.fs_mtime_ms) stats.dir_updated++;
        baseline.delete(v.filmAbsPath);
      } else {
        const r = db.prepare(`INSERT INTO films(code, title, raw_dir_name, abs_path, parent_dir_name, parent_type, locale, cover_path, scan_status, fs_mtime_ms, is_deleted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`)
          .run(parsed.code, parsed.title, v.filmDirName, v.filmAbsPath, v.parentDirName, effectiveParentType, parsed.locale, coverRel, parsed.scan_status, v.mtime_ms, nowMs(), nowMs());
        filmId = Number(r.lastInsertRowid);
        stats.dir_added++;
      }
      replaceFilmActors(db, filmId, actorIds);
      replaceFilmGenres(db, filmId, genreIds);
      replaceFilmTags(db, filmId, parsed.tags);
      replaceFilmFiles(db, filmId, files);
    });
  }

  // Remaining baseline => missing => soft delete
  const missing = Array.from(baseline.values());
  if (missing.length) {
    tx(db, () => { markSoftDeleted(db, missing.map(m => m.id)); });
    stats.dir_removed = missing.length;
  }

  // 重算每部影片的同编号重复计数。扫描过后立刻保证列表徽标反映最新状态；
  // 增量扫描走同一路径，因为增量也可能让某个 code 从 1 份变 2 份（或反之）。
  recomputeCodeCounts(db);

  return stats;
}
