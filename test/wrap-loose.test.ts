import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { runScan } from '../electron/scanner/index';
import { wrapLooseVideos } from '../electron/scanner/wrapLoose';

let tmp = '';
let root = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-wrap-'));
  root = path.join(tmp, 'root');
  fs.mkdirSync(root, { recursive: true });
});

function rmSyncRetry(target: string) {
  let lastErr: any;
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(target, { recursive: true, force: true }); return; }
    catch (e) { lastErr = e; }
    const end = Date.now() + 30;
    while (Date.now() < end) { /* spin */ }
  }
  if (lastErr) throw lastErr;
}
afterEach(() => {
  rmSyncRetry(tmp);
});

function mkdir(rel: string) { fs.mkdirSync(path.join(root, rel), { recursive: true }); }
function touch(rel: string, content = 'x') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function exists(rel: string) { return fs.existsSync(path.join(root, rel)); }
function read(rel: string) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

describe('wrapLooseVideos', () => {
  it('wraps a loose video into a new code-named dir under its list dir', () => {
    touch('0-A/HMN-260.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/HMN-260/HMN-260.mp4')).toBe(true);
    expect(s).toEqual({ loose_seen: 1, into_existing: 0, into_new: 1, skipped: 0, failed: 0 });
  });

  it('moves into an existing dir via boundary-safe case-insensitive match', () => {
    mkdir('0-A/HMN-261-C [FHD] T');
    touch('0-A/hmn-261.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/HMN-261-C [FHD] T/hmn-261.mp4')).toBe(true);
    expect(exists('0-A/HMN-261')).toBe(false);
    expect(s.into_existing).toBe(1);
    expect(s.into_new).toBe(0);
  });

  it('never conflates codes of different lengths in either direction', () => {
    mkdir('0-A/HMN-262 T');
    touch('0-A/HMN-2620.mp4');
    mkdir('0-A/HMN-2630 T');
    touch('0-A/HMN-263.mp4');
    const s = wrapLooseVideos(root);
    // HMN-2620 不进 HMN-262，HMN-263 也不进 HMN-2630：各自新建编号目录。
    expect(exists('0-A/HMN-2620/HMN-2620.mp4')).toBe(true);
    expect(exists('0-A/HMN-262 T/HMN-2620.mp4')).toBe(false);
    expect(exists('0-A/HMN-263/HMN-263.mp4')).toBe(true);
    expect(exists('0-A/HMN-2630 T/HMN-263.mp4')).toBe(false);
    expect(s.loose_seen).toBe(2);
    expect(s.into_new).toBe(2);
  });

  it('skips when the code matches multiple existing dirs', () => {
    mkdir('0-A/HMN-264');
    mkdir('0-A/HMN-264-C');
    touch('0-A/HMN-264.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/HMN-264.mp4')).toBe(true);
    expect(s.skipped).toBe(1);
    expect(s.into_new + s.into_existing).toBe(0);
  });

  it('never overwrites a same-named destination file', () => {
    mkdir('0-A/HMN-265');
    touch('0-A/HMN-265/HMN-265.mp4', 'inside');
    touch('0-A/HMN-265.mp4', 'loose');
    const s = wrapLooseVideos(root);
    expect(read('0-A/HMN-265.mp4')).toBe('loose');
    expect(read('0-A/HMN-265/HMN-265.mp4')).toBe('inside');
    expect(s.skipped).toBe(1);
  });

  it('leaves files without a leading code in place', () => {
    touch('0-A/beach-day.mp4');
    touch('0-A/20240501.mp4');
    touch('0-A/HMN.txt');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/beach-day.mp4')).toBe(true);
    expect(exists('0-A/20240501.mp4')).toBe(true);
    expect(exists('0-A/HMN.txt')).toBe(true);
    expect(s.loose_seen).toBe(2);
    expect(s.skipped).toBe(2);
  });

  it('supports FC2-PPV style codes', () => {
    touch('0-A/FC2-PPV-1218169.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/FC2-PPV-1218169/FC2-PPV-1218169.mp4')).toBe(true);
    expect(s.into_new).toBe(1);
  });

  it('only treats script video extensions as loose videos', () => {
    touch('0-A/HMN-266.flv');
    touch('0-A/HMN-267.webm');
    touch('0-A/HMN-268.m2ts');
    touch('0-A/HMN-269.srt');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/HMN-266/HMN-266.flv')).toBe(true);
    expect(exists('0-A/HMN-267/HMN-267.webm')).toBe(true);
    expect(exists('0-A/HMN-268/HMN-268.m2ts')).toBe(true);
    expect(exists('0-A/HMN-269.srt')).toBe(true);
    expect(s.loose_seen).toBe(3);
  });

  it('leaves files inside film dirs untouched', () => {
    mkdir('0-A/ABC-1 T');
    touch('0-A/ABC-1 T/x.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/ABC-1 T/x.mp4')).toBe(true);
    expect(s.loose_seen).toBe(0);
  });

  it('wraps inside nested non-film dirs too', () => {
    touch('0-A/sub/HMN-270.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/sub/HMN-270/HMN-270.mp4')).toBe(true);
    expect(s.into_new).toBe(1);
  });

  it('respects maxDepth the same way the walker does', () => {
    touch('HMN-271.mp4');
    touch('0-A/HMN-272.mp4');
    const s = wrapLooseVideos(root, { maxDepth: 1 });
    expect(exists('HMN-271/HMN-271.mp4')).toBe(true);
    expect(exists('0-A/HMN-272.mp4')).toBe(true);
    expect(s.into_new).toBe(1);
  });

  it('groups same-code files into one dir', () => {
    touch('0-A/HMN-273.mp4');
    touch('0-A/HMN-273-C.mp4');
    const s = wrapLooseVideos(root);
    expect(exists('0-A/HMN-273/HMN-273.mp4')).toBe(true);
    expect(exists('0-A/HMN-273/HMN-273-C.mp4')).toBe(true);
    expect(s.into_new).toBe(1);
    expect(s.into_existing).toBe(1);
  });

  it('reports wrap progress with real paths', () => {
    touch('0-A/HMN-274.mp4');
    touch('0-A/HMN-275.mp4');
    const events: { current: number; total: number; currentPath: string }[] = [];
    wrapLooseVideos(root, { onProgress: p => events.push({ current: p.current, total: p.total, currentPath: p.currentPath }) });
    expect(events).toHaveLength(2);
    expect(events[1].current).toBe(2);
    expect(events[1].total).toBe(2);
    expect(events[1].currentPath).toBe(path.join(root, '0-A', 'HMN-275.mp4'));
  });
});

describe('runScan with wrapLoose', () => {
  it('wraps loose videos before walking so the new film dir is indexed', () => {
    const dbPath = path.join(tmp, 't.sqlite');
    const db = openDbForTest(dbPath);
    try {
      touch('0-B/HMN-280.mp4');
      const res = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor', wrapLoose: true });
      expect(res.wrap?.into_new).toBe(1);
      expect(res.dir_added).toBe(1);

      const film = db.prepare('SELECT code, abs_path FROM films').get() as { code: string; abs_path: string };
      expect(film.code).toBe('HMN-280');
      expect(film.abs_path).toBe(path.join(root, '0-B', 'HMN-280'));
      const files = db.prepare('SELECT name FROM film_files').all() as { name: string }[];
      expect(files.map(f => f.name)).toEqual(['HMN-280.mp4']);
    } finally {
      db.close();
    }
  });

  it('does not touch anything when wrapLoose is off', () => {
    const dbPath = path.join(tmp, 't.sqlite');
    const db = openDbForTest(dbPath);
    try {
      touch('0-C/HMN-281.mp4');
      const res = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
      expect(res.wrap ?? null).toBeNull();
      expect(exists('0-C/HMN-281.mp4')).toBe(true);
      expect(res.dir_added).toBe(0);
      expect((db.prepare('SELECT COUNT(*) n FROM films').get() as any).n).toBe(0);
    } finally {
      db.close();
    }
  });
});
