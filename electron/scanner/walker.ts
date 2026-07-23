import fs from 'node:fs';
import path from 'node:path';

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.m4v', '.iso', '.rmvb', '.ts']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const FILE_MAX_DEPTH = 3;
export const DEFAULT_SCAN_MAX_DEPTH = 3;
export const MIN_SCAN_MAX_DEPTH = 1;
export const MAX_SCAN_MAX_DEPTH = 10;

export interface FilmFileStat {
  rel_path: string;
  abs_path: string;
  name: string;
  ext: string;
  size: number;
  is_video: number;
  is_image: number;
  mtime_ms: number;
}

export interface FilmDirVisit {
  parentDirName: string;
  filmDirName: string;
  filmAbsPath: string;
  parentAbsPath: string;
  mtime_ms: number;
}

export function listFilmFiles(filmDir: string): FilmFileStat[] {
  const out: FilmFileStat[] = [];
  const recurse = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < FILE_MAX_DEPTH) recurse(abs, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const st = fs.statSync(abs);
        out.push({
          rel_path: path.relative(filmDir, abs),
          abs_path: abs,
          name: e.name,
          ext,
          size: st.size,
          is_video: VIDEO_EXT.has(ext) ? 1 : 0,
          is_image: IMAGE_EXT.has(ext) ? 1 : 0,
          mtime_ms: st.mtimeMs,
        });
      }
    }
  };
  recurse(filmDir, 0);
  return out;
}

function looksLikeActorOrGenre(name: string): boolean {
  return /^\d+-.+/.test(name);
}

function looksLikeFilmDir(name: string): boolean {
  const txt = name.trim();
  // 原始两级启发：以"字母+数字"打头 (ABC-123 / abc_123) 或含 [标签]。
  return /^[A-Za-z]+[-_]?[0-9]+/.test(txt) || /\[[^\]]+\]/.test(txt);
}

function clampScanDepth(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_MAX_DEPTH;
  return Math.max(MIN_SCAN_MAX_DEPTH, Math.min(MAX_SCAN_MAX_DEPTH, Math.floor(value!)));
}

function resolveFilmParent(root: string, ancestors: string[]): { name: string; absPath: string } {
  if (ancestors.length === 0) return { name: '', absPath: root };
  let index = -1;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (looksLikeActorOrGenre(ancestors[i])) {
      index = i;
      break;
    }
  }
  if (index < 0) index = ancestors.length - 1;
  return {
    name: ancestors[index],
    absPath: path.join(root, ...ancestors.slice(0, index + 1)),
  };
}

/**
 * 在 root 以下递归发现影片目录。maxDepth 表示影片目录相对 root 的最大层级：
 * root/film 为 1，root/group/film 为 2。命中影片目录后不再向内递归。
 */
export function* walkFilmDirs(root: string, maxDepth = DEFAULT_SCAN_MAX_DEPTH): Iterable<FilmDirVisit> {
  const depthLimit = clampScanDepth(maxDepth);
  let rootEntries: fs.Dirent[];
  try { rootEntries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return; }
  const rootDirs = rootEntries.filter(e => e.isDirectory());
  // 保留既有混合根语义：根下存在 0-/1- 父目录时，不把并列的编号目录误吞为平铺影片。
  const suppressDirectFilms = rootDirs.some(d => looksLikeActorOrGenre(d.name));

  function* recurse(dir: string, depth: number, ancestors: string[], entries?: fs.Dirent[]): Iterable<FilmDirVisit> {
    let children = entries;
    if (!children) {
      try { children = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const childDepth = depth + 1;
      const childAbs = path.join(dir, child.name);
      const isDirectSuppressed = childDepth === 1 && suppressDirectFilms;
      if (looksLikeFilmDir(child.name)) {
        if (!isDirectSuppressed) {
          const parent = resolveFilmParent(root, ancestors);
          yield {
            parentDirName: parent.name,
            filmDirName: child.name,
            filmAbsPath: childAbs,
            parentAbsPath: parent.absPath,
            mtime_ms: dirMtime(childAbs),
          };
        }
        continue;
      }
      if (childDepth < depthLimit) {
        yield* recurse(childAbs, childDepth, [...ancestors, child.name]);
      }
    }
  }

  yield* recurse(root, 0, [], rootEntries);
}

function dirMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}
