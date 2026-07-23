// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db';
import { applyScanFallback, runScan } from '../electron/scanner';
import { enrichAddedFilms } from '../electron/scanner/enrich';

let tmp = '';
let db: Database.Database;
let root = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-enrich-'));
  db = openDbForTest(path.join(tmp, 'test.sqlite'));
  root = path.join(tmp, 'root');
  fs.mkdirSync(root, { recursive: true });
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeFilm(name: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'movie.mp4'), 'x');
}

describe('enrichAddedFilms', () => {
  it('waits for a successful scrape and does not apply fallback', async () => {
    makeFilm('ABC-001 Directory Title');
    const scan = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    const scrape = vi.fn(async () => true);
    const result = await enrichAddedFilms(db, scan.addedFilms, scrape);
    expect(scrape).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ scrape_ok: 1, scrape_fail: 0, fallback_applied: 0 });
    expect((db.prepare('SELECT title FROM films').get() as { title: string | null }).title).toBeNull();
  });

  it('falls back to directory metadata when scraping fails', async () => {
    makeFilm('0-Actor/ABC-002-C [FHD] Directory Title');
    const scan = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    const result = await enrichAddedFilms(db, scan.addedFilms, async () => { throw new Error('offline'); });
    expect(result).toMatchObject({ scrape_ok: 0, scrape_fail: 1, fallback_applied: 1 });
    const film = db.prepare('SELECT title, locale, cover_path, scan_status FROM films').get() as any;
    expect(film.title).toBe('Directory Title');
    expect(film.locale).toBe('C');
    expect(film.scan_status).toBe('parsed');
    expect((db.prepare('SELECT name FROM actors').get() as { name: string }).name).toBe('Actor');
  });

  it('does not scrape a duplicate code added in a later scan', async () => {
    makeFilm('ABC-003 First');
    const first = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    expect(applyScanFallback(db, first.addedFilms[0])).toBe(true);

    fs.rmSync(path.join(root, 'ABC-003 First'), { recursive: true, force: true });
    makeFilm('ABC-003 Second');
    const second = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    const scrape = vi.fn(async () => true);
    const result = await enrichAddedFilms(db, second.addedFilms, scrape);
    expect(scrape).not.toHaveBeenCalled();
    expect(result.scrape_skipped).toBe(1);
    expect(result.fallback_applied).toBe(0);
  });
});
