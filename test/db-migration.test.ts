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

  it('is idempotent — second open keeps version 1', () => {
    openDbForTestTracked(dbPath);
    const db = new Database(dbPath);
    openedDbs.push(db);
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
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
