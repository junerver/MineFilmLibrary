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
  // 原始两级启发：以"字母+数字"打头 (ABC-123 / abc_123) 或含 [标签]。
  return /^[A-Za-z]+[-_]?[0-9]+/.test(txt) || /\[[^\]]+\]/.test(txt);
}

// 平铺根专用更宽松的启发：root 下若没有任何编号/标签目录穿插，
// 则把所有"显然不是 演员/题材 父目录"的子目录直接当影片处理。
// 用于 `F:\Movie\已处理\其他精品` 这种 root → films 一级结构。
// 注意：纯靠"长度≥N"会把 groupA 这种容器目录误判成影片，所以这里要求
// 目录名要么有编号/标签，要么含中文/假名（电影标题特征），否则不认。
function looksLikeFilmDirFlat(name: string): boolean {
  const txt = name.trim();
  if (!txt) return false;
  // 已是编号/标签形式的，直接认。
  if (looksLikeFilmDir(txt)) return true;
  // 演员/题材父目录（0-/1- 前缀）不当作影片——避免误吞。
  if (looksLikeActorOrGenre(txt)) return false;
  // 含中文/假名的目录名几乎肯定是影片标题（演员/题材目录通常用拉丁字母）。
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(txt)) return txt.length >= 4;
  // 不含中文又不带编号/标签的，不认——避免把 groupA、Backup 这类容器目录当影片。
  return false;
}

export function* walkFilmDirs(root: string): Iterable<FilmDirVisit> {
  let firstLevel: fs.Dirent[];
  try { firstLevel = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return; }

  const dirsAtRoot = firstLevel.filter(e => e.isDirectory());

  // —— 平铺根快车道 ——
  // 如果 root 的直接子目录里没有任何"演员/题材"父目录（0-/1- 前缀），
  // 且有 ≥1 个目录通过宽松启发认定为影片目录，则走平铺模式：
  // root 直接是影片的容器，parent 落空，所有影片挂 parent_dir_name=''。
  const hasActorOrGenreParent = dirsAtRoot.some(d => looksLikeActorOrGenre(d.name));
  if (!hasActorOrGenreParent) {
    const flatHits = dirsAtRoot.filter(d => looksLikeFilmDirFlat(d.name));
    if (flatHits.length >= 1) {
      for (const s of flatHits) {
        const abs = path.join(root, s.name);
        yield { parentDirName: '', filmDirName: s.name, filmAbsPath: abs, parentAbsPath: root, mtime_ms: dirMtime(abs) };
      }
      return;
    }
  }

  for (const parent of dirsAtRoot) {
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
