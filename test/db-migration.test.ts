// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';

let tmp = '';
let dbPath = '';
// Track DB instances opened during a test so afterEach can close them.
// On Windows, an open better-sqlite3 handle locks the file and prevents
// the temp dir from being removed (EBUSY).
const openedDbs: Database.Database[] = [];

// Wrap openDbForTest so each opened handle is registered for cleanup.
function openDbForTestTracked(target: string): Database.Database {
  const db = openDbForTest(target);
  openedDbs.push(db);
  return db;
}

function rmSyncRetry(target: string) {
  let lastErr: unknown;
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      // EBUSY/EPERM can happen transiently on Windows while handles close.
      // Wait briefly and retry.
      // eslint-disable-next-line no-undef
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  throw lastErr;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-'));
  dbPath = path.join(tmp, 't.sqlite');
  openedDbs.length = 0;
});

afterEach(() => {
  // Close any DB handles the test opened before removing the temp dir.
  for (const db of openedDbs) {
    try { db.close(); } catch { /* already closed */ }
  }
  openedDbs.length = 0;
  if (fs.existsSync(tmp)) rmSyncRetry(tmp);
});

describe('db migration 0001', () => {
  it('creates all expected tables', () => {
    const db = openDbForTestTracked(dbPath);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = rows.map(r => r.name);
    for (const t of ['actors', 'genres', 'films', 'film_actors', 'film_genres', 'film_tags', 'film_files', 'cover_blobs', 'scan_roots', 'scan_runs', 'schema_version', 'settings']) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent — re-opening keeps applied version at top of chain', () => {
    openDbForTestTracked(dbPath);
    const db = new Database(dbPath);
    openedDbs.push(db);
    // openDbForTest 跑完整条迁移链，所以版本落在最高 8。
    // 重开一次（这里用裸 Database 只读不跑迁移）也仍是 8，保证迁移不会回退版本。
    const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    expect(row.version).toBe(8);
  });

  it('foreign keys enforce cascade', () => {
    const db = openDbForTestTracked(dbPath);
    const now = Date.now();
    db.prepare(`INSERT INTO films(raw_dir_name, abs_path, parent_dir_name, scan_status, fs_mtime_ms, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('d', '/x/d', 'p', 'unknown', now, now, now);
    db.prepare('INSERT INTO film_files(film_id, rel_path, abs_path, name, ext, size, is_video, is_image, mtime_ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(1, 'a.mp4', '/x/d/a.mp4', 'a.mp4', '.mp4', 1, 1, 0, now, now);
    db.prepare('DELETE FROM films WHERE id=1').run();
    const c = db.prepare('SELECT COUNT(*) n FROM film_files WHERE film_id=1').get() as { n: number };
    expect(c.n).toBe(0);
  });
});

describe('db migration 0002', () => {
  it('creates actor_aliases table + films.code_count column', () => {
    const db = openDbForTestTracked(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('actor_aliases');
    const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('code_count');
    // 默认值是 0。
    const now = Date.now();
    db.prepare(`INSERT INTO films(raw_dir_name, abs_path, parent_dir_name, scan_status, fs_mtime_ms, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('d', '/x/d', 'p', 'unknown', now, now, now);
    const f = db.prepare('SELECT code_count FROM films WHERE id=1').get() as { code_count: number };
    expect(f.code_count).toBe(0);
    // schema_version 在 openDbForTest 跑完整条迁移链后应停在最新 8。
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    expect(v.version).toBe(8);
  });

  it('is idempotent — re-open keeps version 8 (full migration chain)', () => {
    openDbForTestTracked(dbPath);
    const db = openDbForTestTracked(dbPath);
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    // 重开跑完整链，最新版本应停在 8。
    expect(v.version).toBe(8);
  });
});

describe('db migration 0003', () => {
  it('adds actors.notes column + keeps schema_version at 8', () => {
    const db = openDbForTestTracked(dbPath);
    const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('notes');
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    expect(v.version).toBe(8);
    // 默认 NULL，不破坏现有行。
    const now = Date.now();
    db.prepare('INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)').run('X', '0-X', now, now);
    const a = db.prepare('SELECT notes FROM actors WHERE name=?').get('X') as { notes: string | null };
    expect(a.notes).toBeNull();
  });
});

describe('db migration 0005', () => {
  it('adds actor JavBus homepage and cached data columns', () => {
    const db = openDbForTestTracked(dbPath);
    const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['javbus_url', 'javbus_data_json', 'javbus_scraped_at']));
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    expect(v.version).toBe(8);
  });
});

describe('db migration 0006', () => {
  it('adds extended actor profile columns', () => {
    const db = openDbForTestTracked(dbPath);
    const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining([
      'birthday', 'age', 'height', 'cup', 'bust', 'waist', 'hips', 'measurements', 'hobby',
    ]));
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    // openDbForTest 跑完全部迁移；最新版本为 8
    expect(v.version).toBe(8);
  });
});

describe('db migration 0007', () => {
  it('adds actors.is_favorite column default 0 + schema_version 7', () => {
    const db = openDbForTestTracked(dbPath);
    const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('is_favorite');
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    // openDbForTest 跑完全部迁移；最新版本为 8
    expect(v.version).toBe(8);
    const now = Date.now();
    db.prepare('INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)')
      .run('FavActor', '0-FavActor', now, now);
    const a = db.prepare('SELECT is_favorite FROM actors WHERE name=?').get('FavActor') as { is_favorite: number };
    expect(a.is_favorite).toBe(0);
  });
});

describe('db migration 0008', () => {
  it('adds films.is_favorite column default 0 + schema_version 8', () => {
    const db = openDbForTestTracked(dbPath);
    const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('is_favorite');
    const v = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number };
    expect(v.version).toBe(8);
    const now = Date.now();
    db.prepare(`INSERT INTO films(
      code, title, raw_dir_name, abs_path, parent_dir_name, scan_status,
      fs_mtime_ms, is_deleted, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'FAV-001', 'Fav Film', 'FAV-001', `${dbPath}-fav-film`, '', 'parsed', now, 0, now, now,
    );
    const f = db.prepare('SELECT is_favorite FROM films WHERE code=?').get('FAV-001') as { is_favorite: number };
    expect(f.is_favorite).toBe(0);
  });
});
