import fs from 'node:fs';
import path from 'node:path';

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.m4v', '.iso', '.rmvb', '.ts']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_DEPTH = 3;

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
        if (depth < MAX_DEPTH) recurse(abs, depth + 1);
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
  return /^[A-Za-z]+[-_]?[0-9]+/.test(txt) || /\[[^\]]+\]/.test(txt);
}

export function* walkFilmDirs(root: string): Iterable<FilmDirVisit> {
  let firstLevel: fs.Dirent[];
  try { firstLevel = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return; }

  for (const parent of firstLevel) {
    if (!parent.isDirectory()) continue;
    const parentAbs = path.join(root, parent.name);

    let subs: fs.Dirent[];
    try { subs = fs.readdirSync(parentAbs, { withFileTypes: true }); }
    catch { continue; }

    const filmSubs = subs.filter(s => s.isDirectory() && looksLikeFilmDir(s.name));
    if (filmSubs.length > 0) {
      for (const s of filmSubs) {
        const abs = path.join(parentAbs, s.name);
        yield { parentDirName: parent.name, filmDirName: s.name, filmAbsPath: abs, parentAbsPath: parentAbs, mtime_ms: dirMtime(abs) };
      }
      continue;
    }

    // fallback: parent 层不像 actor/genre，再下一层
    if (!looksLikeActorOrGenre(parent.name)) {
      for (const inner of subs) {
        if (!inner.isDirectory()) continue;
        const innerAbs = path.join(parentAbs, inner.name);
        let innerSubs: fs.Dirent[];
        try { innerSubs = fs.readdirSync(innerAbs, { withFileTypes: true }); }
        catch { continue; }
        for (const s of innerSubs) {
          if (s.isDirectory() && looksLikeFilmDir(s.name)) {
            const abs = path.join(innerAbs, s.name);
            yield { parentDirName: inner.name, filmDirName: s.name, filmAbsPath: abs, parentAbsPath: innerAbs, mtime_ms: dirMtime(abs) };
          }
        }
      }
    }
  }
}

function dirMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}
