import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { runScan } from '../electron/scanner/index';
import {
  DRIVE_MAPPINGS_KEY,
  loadDriveMappings,
  normalizeDriveLetter,
  parseDriveMappings,
  realToVirtual,
  serializeDriveMappings,
  virtualToReal,
} from '../electron/util/driveMap';

describe('normalizeDriveLetter', () => {
  it('accepts plain letter, trailing colon and slashes', () => {
    expect(normalizeDriveLetter('f')).toBe('F:');
    expect(normalizeDriveLetter('F:')).toBe('F:');
    expect(normalizeDriveLetter(' f:\\ ')).toBe('F:');
    expect(normalizeDriveLetter('g/')).toBe('G:');
  });

  it('rejects non-drive input', () => {
    expect(normalizeDriveLetter('')).toBeNull();
    expect(normalizeDriveLetter('ABC')).toBeNull();
    expect(normalizeDriveLetter('1:')).toBeNull();
    expect(normalizeDriveLetter(null)).toBeNull();
    expect(normalizeDriveLetter(42 as any)).toBeNull();
  });
});

describe('parseDriveMappings', () => {
  it('round-trips through serialize', () => {
    const raw = serializeDriveMappings([{ from: 'F:', to: 'G:' }]);
    expect(parseDriveMappings(raw)).toEqual([{ from: 'F:', to: 'G:' }]);
  });

  it('drops invalid rows and bad payloads', () => {
    expect(parseDriveMappings('not json')).toEqual([]);
    expect(parseDriveMappings('{"a":1}')).toEqual([]);
    expect(parseDriveMappings(null)).toEqual([]);
    expect(parseDriveMappings(undefined)).toEqual([]);
    expect(parseDriveMappings('')).toEqual([]);
    const raw = JSON.stringify([
      { from: 'f', to: 'g' },
      { from: 'X:', to: 'X:' },
      { from: 'Y:', to: 'nope' },
      'junk',
      { from: 'Q', to: 'R' },
    ]);
    expect(parseDriveMappings(raw)).toEqual([
      { from: 'F:', to: 'G:' },
      { from: 'Q:', to: 'R:' },
    ]);
  });
});

(process.platform === 'win32' ? describe : describe.skip)('drive prefix mapping', () => {
  it('maps only matching drive, case-insensitively', () => {
    const mappings = [{ from: 'F:', to: 'G:' }];
    expect(virtualToReal('F:\\Movie\\已分类', mappings)).toBe('G:\\Movie\\已分类');
    expect(virtualToReal('f:\\movie', mappings)).toBe('G:\\movie');
    expect(virtualToReal('F:\\', mappings)).toBe('G:\\');
    // 无映射命中的盘符保持原样
    expect(virtualToReal('D:\\data', mappings)).toBe('D:\\data');
    expect(virtualToReal('C:\\data', [])).toBe('C:\\data');
  });

  it('leaves UNC and relative paths untouched', () => {
    const mappings = [{ from: 'F:', to: 'G:' }];
    expect(virtualToReal('\\\\nas\\media\\film', mappings)).toBe('\\\\nas\\media\\film');
  });

  it('reverse-maps real to virtual', () => {
    const mappings = [{ from: 'F:', to: 'G:' }];
    expect(realToVirtual('G:\\Movie\\ABC-1', mappings)).toBe('F:\\Movie\\ABC-1');
    expect(realToVirtual('D:\\Movie', mappings)).toBe('D:\\Movie');
  });
});

describe('loadDriveMappings', () => {
  let tmp = '';
  let db: Database.Database;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-drivemap-'));
    db = openDbForTest(path.join(tmp, 't.sqlite'));
  });

  afterEach(() => {
    try { db.close(); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('reads mappings from settings and tolerates a missing table', () => {
    expect(loadDriveMappings(db)).toEqual([]);
    db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO settings(key, value) VALUES(?,?)').run(DRIVE_MAPPINGS_KEY, serializeDriveMappings([{ from: 'F:', to: 'G:' }]));
    expect(loadDriveMappings(db)).toEqual([{ from: 'F:', to: 'G:' }]);
  });
});

(process.platform === 'win32' ? describe : describe.skip)('runScan with drive mapping', () => {
  let tmp = '';
  let dbPath = '';
  let realRoot = '';
  let virtualRoot = '';
  let db: Database.Database;
  let realDrive: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-scan-map-'));
    dbPath = path.join(tmp, 't.sqlite');
    realRoot = path.join(tmp, 'root');
    fs.mkdirSync(realRoot, { recursive: true });
    realDrive = `${realRoot.slice(0, 2).toUpperCase()}`;
    virtualRoot = `Q:${realRoot.slice(2)}`;
    db = openDbForTest(dbPath);
    db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO settings(key, value) VALUES(?,?)')
      .run(DRIVE_MAPPINGS_KEY, serializeDriveMappings([{ from: 'Q:', to: realDrive }]));
  });

  afterEach(() => {
    try { db.close(); } catch {}
    let lastErr: any;
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); return; } catch (e) { lastErr = e; }
      const end = Date.now() + 30;
      while (Date.now() < end) { /* spin */ }
    }
    if (lastErr) throw lastErr;
  });

  it('walks the real drive but stores virtual paths', () => {
    const filmDir = path.join(realRoot, '0-Julia', 'CJOD-295-C [FHD] T');
    fs.mkdirSync(filmDir, { recursive: true });
    fs.writeFileSync(path.join(filmDir, 'm.mp4'), 'x');
    fs.writeFileSync(path.join(filmDir, 'c.jpg'), 'y');

    const stats = runScan(db, { mode: 'full', rootPath: virtualRoot, defaultType: 'actor' });
    expect(stats.dir_added).toBe(1);

    const film = db.prepare('SELECT abs_path, parent_dir_name FROM films').get() as any;
    expect(film.abs_path.startsWith('Q:\\')).toBe(true);
    expect(film.abs_path).toBe(path.join(virtualRoot, '0-Julia', 'CJOD-295-C [FHD] T'));
    expect(film.parent_dir_name).toBe('0-Julia');

    const files = db.prepare('SELECT abs_path, rel_path FROM film_files').all() as any[];
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f.abs_path.startsWith('Q:\\')).toBe(true);
      expect(fs.existsSync(f.abs_path)).toBe(false); // 虚拟盘符在磁盘上并不存在
      expect(fs.existsSync(virtualToReal(f.abs_path, [{ from: 'Q:', to: realDrive }]))).toBe(true);
    }

    // 增量重扫：虚拟路径基线命中，不产生重复记录
    const again = runScan(db, { mode: 'incremental', rootPath: virtualRoot, defaultType: 'actor' });
    expect(again.dir_added).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM films').get() as any).n).toBe(1);
  });
});
