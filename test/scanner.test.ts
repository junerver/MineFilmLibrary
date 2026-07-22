import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { runScan } from '../electron/scanner/index';

let tmp = '';
let dbPath = '';
let rootPath = '';
let db: Database.Database;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-scan-'));
  dbPath = path.join(tmp, 't.sqlite');
  rootPath = path.join(tmp, 'root');
  fs.mkdirSync(rootPath, { recursive: true });
  db = openDbForTest(dbPath);
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
  try { db.close(); } catch {}
  rmSyncRetry(tmp);
});

function mkdir(rel: string) { fs.mkdirSync(path.join(rootPath, rel), { recursive: true }); }
function touch(rel: string, content = 'x') { fs.writeFileSync(path.join(rootPath, rel), content); }

describe('runScan full mode', () => {
  it('inserts films, actors, tags, files', () => {
    mkdir('0-Julia/CJOD-295-C [FHD] Title A');
    touch('0-Julia/CJOD-295-C [FHD] Title A/m.mp4', 'xx');
    touch('0-Julia/CJOD-295-C [FHD] Title A/c.jpg', 'yy');

    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(1);
    expect(stats.dir_seen).toBe(1);

    const film = db.prepare('SELECT * FROM films WHERE id=1').get() as any;
    expect(film.code).toBe('CJOD-295');
    expect(film.locale).toBe('C');
    expect(film.title).toBe('Title A');

    const actor = db.prepare('SELECT * FROM actors').get() as any;
    expect(actor.name).toBe('Julia');

    const tags = db.prepare('SELECT tag FROM film_tags').all() as any[];
    expect(tags.map(t => t.tag)).toEqual(['FHD']);

    const files = db.prepare('SELECT * FROM film_files').all() as any[];
    expect(files.length).toBe(2);

    const cover = db.prepare('SELECT cover_path FROM films').get() as any;
    expect(cover.cover_path).toBe('c.jpg');
  });

  it('genre parent creates genre not actor', () => {
    mkdir('1-剧情/BBB-1 T');
    touch('1-剧情/BBB-1 T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const actors = db.prepare('SELECT COUNT(*) n FROM actors').get() as any;
    const genres = db.prepare('SELECT name FROM genres').all() as any[];
    expect(actors.n).toBe(0);
    expect(genres.map(g => g.name)).toEqual(['剧情']);
  });

  it('soft deletes missing dirs on re-scan', () => {
    mkdir('0-J/CJOD-295-C [FHD] T');
    touch('0-J/CJOD-295-C [FHD] T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    // remove dir
    fs.rmSync(path.join(rootPath, '0-J'), { recursive: true, force: true });
    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_removed).toBe(1);
    const film = db.prepare('SELECT is_deleted FROM films').get() as any;
    expect(film.is_deleted).toBe(1);
  });

  it('incremental skips unchanged dirs', () => {
    mkdir('0-J/CJOD-295-C [FHD] T');
    touch('0-J/CJOD-295-C [FHD] T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const stats = runScan(db, { mode: 'incremental', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(0);
    expect(stats.dir_updated).toBe(0);
  });
});
