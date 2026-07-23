import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFilmFiles, walkFilmDirs } from '../electron/scanner/walker';

let tmp = '';
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-w-'));
});
function rmSyncRetry(target: string) {
  let lastErr: any;
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(target, { recursive: true, force: true }); return; }
    catch (e) { lastErr = e; }
    // busy wait backoff
    const end = Date.now() + 30;
    while (Date.now() < end) { /* spin */ }
  }
  if (lastErr) throw lastErr;
}
afterEach(() => { rmSyncRetry(tmp); });

describe('listFilmFiles', () => {
  it('lists files at depth <=3 with video/image flags', () => {
    const filmDir = path.join(tmp, 'CJOD-295-C [FHD] T');
    fs.mkdirSync(path.join(filmDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(filmDir, 'a.mp4'), 'x');
    fs.writeFileSync(path.join(filmDir, 'cover.jpg'), 'y');
    fs.writeFileSync(path.join(filmDir, 'sub', 'note.txt'), 'z');
    const files = listFilmFiles(filmDir);
    expect(files.map(f => f.name).sort()).toEqual(['a.mp4', 'cover.jpg', 'note.txt']);
    const mp4 = files.find(f => f.name === 'a.mp4')!;
    expect(mp4.is_video).toBe(1);
    expect(mp4.is_image).toBe(0);
    expect(mp4.size).toBe(1);
    const jpg = files.find(f => f.name === 'cover.jpg')!;
    expect(jpg.is_image).toBe(1);
  });

  it('picks largest image as cover candidate', () => {
    const filmDir = path.join(tmp, 'F-1 T');
    fs.mkdirSync(filmDir, { recursive: true });
    fs.writeFileSync(path.join(filmDir, 'small.jpg'), 'yy');
    fs.writeFileSync(path.join(filmDir, 'big.png'), 'yyyyyyyyyy');
    const files = listFilmFiles(filmDir);
    const cover = pickCover(files);
    expect(cover).toBe(path.join(filmDir, 'big.png'));
  });
});

describe('walkFilmDirs', () => {
  it('walks two-level actor -> film structure', () => {
    fs.mkdirSync(path.join(tmp, '0-Julia', 'AAA-1 [FHD] T1'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '0-Julia', 'AAA-2 T2'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '1-剧情', 'BBB-3 T3'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    expect(visited.map(v => v.parentDirName).sort()).toEqual(['0-Julia', '0-Julia', '1-剧情']);
    expect(visited.map(v => v.filmDirName)).toEqual(expect.arrayContaining(['AAA-1 [FHD] T1', 'AAA-2 T2', 'BBB-3 T3']));
  });

  it('fallback to depth+1 when first level is not actor-like', () => {
    fs.mkdirSync(path.join(tmp, 'groupA', '0-Maria', 'CCC-1 T'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    expect(visited.map(v => v.filmDirName)).toEqual(['CCC-1 T']);
    expect(visited[0].parentDirName).toBe('0-Maria');
  });

  it('uses a configurable maximum directory depth (default 3)', () => {
    fs.mkdirSync(path.join(tmp, 'groupA', 'groupB', 'groupC', 'FC2-PPV-739673-HD'), { recursive: true });
    expect(Array.from(walkFilmDirs(tmp))).toHaveLength(0);
    const visited = Array.from(walkFilmDirs(tmp, 4));
    expect(visited.map(v => v.filmDirName)).toEqual(['FC2-PPV-739673-HD']);
    expect(visited[0].parentDirName).toBe('groupC');
  });

  // Q1：`F:\Movie\已处理\其他精品` 这种 root 直接放影片目录的结构。
  // 没有任何 0-/1- 父目录时，应该走平铺根快车道，所有命中影片 parentDirName 都为 ''。
  it('flat root recognizes films directly under root (no actor parents)', () => {
    fs.mkdirSync(path.join(tmp, 'CJOD-295-C [FHD] Title A'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'SSIS-100 Title B'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    expect(visited.length).toBe(2);
    expect(visited.every(v => v.parentDirName === '')).toBe(true);
    expect(visited.map(v => v.filmDirName).sort()).toEqual(['CJOD-295-C [FHD] Title A', 'SSIS-100 Title B']);
  });

  // 平铺快车道只在 root 不含 actor/genre 父目录时触发；只要有一个 0-/1- 前缀的目录，
  // 就回到两级逻辑，避免误吞。
  it('flat branch NOT taken when an actor/genre parent exists', () => {
    fs.mkdirSync(path.join(tmp, '0-Julia', 'AAA-1 T'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'CJOD-295-C strayfilm'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    // 0-Julia 子目录 AAA-1 T 应该走两级走法；strayfilm 不应被当作平铺影片识别。
    expect(visited.map(v => v.filmDirName)).toContain('AAA-1 T');
    expect(visited.map(v => v.parentDirName)).toContain('0-Julia');
  });
});

function pickCover(files: { abs_path: string; is_image: number; size: number }[]): string | null {
  const imgs = files.filter(f => f.is_image);
  if (!imgs.length) return null;
  return imgs.sort((a, b) => b.size - a.size)[0].abs_path;
}
