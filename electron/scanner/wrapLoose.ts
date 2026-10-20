import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SCAN_MAX_DEPTH, MAX_SCAN_MAX_DEPTH, MIN_SCAN_MAX_DEPTH,
  looksLikeFilmDir,
} from './walker';

/** 与参考脚本 wrap-loose-videos.ps1 一致的裸视频扩展名。 */
const LOOSE_VIDEO_EXT = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m2ts', '.iso', '.rmvb',
]);

/**
 * 脚本同款编号规则：字母开头的 token、以 -数字（2–7 位）结尾，支持 FC2-PPV-1218169。
 * 数字开头（如 040415-846、20240501）与无编号文件一律不算裸视频，保持原样。
 */
const LOOSE_CODE_RE = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\d{2,7})/;

export interface WrapLooseStats {
  /** 命中视频扩展名的散落文件数（含跳过/失败）。 */
  loose_seen: number;
  /** 移入已有影片目录的文件数。 */
  into_existing: number;
  /** 移入新建目录的文件数。 */
  into_new: number;
  /** 无编号 / 同编号匹配到多个目录 / 目标已有同名文件。 */
  skipped: number;
  failed: number;
}

export interface WrapLooseProgress {
  stage: 'wrap';
  current: number;
  total: number;
  currentPath: string;
}

export interface WrapLooseOptions {
  /** 影片目录相对扫描根的最大层级，语义与 walkFilmDirs 一致。 */
  maxDepth?: number;
  onProgress?: (p: WrapLooseProgress) => void;
}

interface PendingDir {
  dir: string;
  files: fs.Dirent[];
  dirNames: string[];
}

function clampDepth(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_MAX_DEPTH;
  return Math.max(MIN_SCAN_MAX_DEPTH, Math.min(MAX_SCAN_MAX_DEPTH, Math.floor(value!)));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 第一遍收集：非影片目录（扫描根、演员/题材等分组目录）第一层散落的视频文件。
 * 递归边界与 walkFilmDirs 完全一致：影片目录不进入，非影片目录在 depth < depthLimit 时进入，
 * 保证包装出的影片目录一定落在 walker 能发现的层级上。
 */
function collectPendingDirs(dir: string, depth: number, depthLimit: number, out: PendingDir[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  const loose = entries.filter(e => e.isFile() && LOOSE_VIDEO_EXT.has(path.extname(e.name).toLowerCase()));
  if (loose.length > 0) {
    out.push({ dir, files: loose, dirNames: entries.filter(e => e.isDirectory()).map(e => e.name) });
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || looksLikeFilmDir(entry.name)) continue;
    const childDepth = depth + 1;
    if (childDepth < depthLimit) collectPendingDirs(path.join(dir, entry.name), childDepth, depthLimit, out);
  }
}

/**
 * 把各目录下散落的视频文件按编号包装进影片目录：已有对应目录则移入，
 * 没有则新建以编号命名的目录。只移动、不重命名、不覆盖同名文件。
 * 在 runScan 调用 walkFilmDirs 之前执行，新建目录可在同一次扫描中被发现入库。
 */
export function wrapLooseVideos(root: string, opts: WrapLooseOptions = {}): WrapLooseStats {
  const stats: WrapLooseStats = { loose_seen: 0, into_existing: 0, into_new: 0, skipped: 0, failed: 0 };
  const pending: PendingDir[] = [];
  collectPendingDirs(root, 0, clampDepth(opts.maxDepth), pending);

  const total = pending.reduce((n, p) => n + p.files.length, 0);
  let current = 0;
  for (const p of pending) {
    for (const entry of p.files) {
      current++;
      stats.loose_seen++;
      const name = entry.name;
      const ext = path.extname(name);
      const baseName = name.slice(0, name.length - ext.length);
      opts.onProgress?.({ stage: 'wrap', current, total, currentPath: path.join(p.dir, name) });

      const m = LOOSE_CODE_RE.exec(baseName);
      if (!m) { stats.skipped++; continue; }
      const code = m[1];

      // 边界安全、大小写不敏感的前缀匹配（脚本同款）：
      // HMN-260 命中 "HMN-260-C"、"HMN-260 [FHD]"，但不会命中 "HMN-2600"。
      const pat = new RegExp(`^${escapeRegExp(code)}([\\s\\-_\\[\\].]|$)`, 'i');
      const hits = p.dirNames.filter(d => pat.test(d));

      let targetName: string;
      let isNew: boolean;
      if (hits.length === 1) {
        targetName = hits[0];
        isNew = false;
      } else if (hits.length === 0) {
        targetName = code;
        isNew = true;
      } else {
        // 同编号匹配到多个目录，交给用户手动处理。
        stats.skipped++;
        continue;
      }

      const dest = path.join(p.dir, targetName, name);
      if (fs.existsSync(dest)) { stats.skipped++; continue; }
      try {
        fs.mkdirSync(path.join(p.dir, targetName), { recursive: true });
        fs.renameSync(path.join(p.dir, name), dest);
        // 新建目录登记进快照，同编号的后续文件直接移入同一目录。
        if (isNew) p.dirNames.push(targetName);
        if (isNew) stats.into_new++; else stats.into_existing++;
      } catch {
        stats.failed++;
      }
    }
  }
  return stats;
}
