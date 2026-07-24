// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db';
import { listPendingFilmScrapes } from '../electron/db/queries';
import { runScan } from '../electron/scanner';
import { applyUnScrapedAddedFilmFallbacks } from '../electron/scanner/enrich';

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

describe('scan scrape recovery', () => {
  it('does not apply fallback after a successful scrape checkpoint', () => {
    makeFilm('ABC-001 Directory Title');
    const scan = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    db.prepare('UPDATE films SET scraped_at=? WHERE id=?').run(Date.now(), scan.addedFilms[0].filmId);

    const result = applyUnScrapedAddedFilmFallbacks(db, scan.addedFilms);

    expect(result).toEqual({ scrape_skipped: 0, fallback_applied: 0, fallback_fail: 0 });
    expect((db.prepare('SELECT title FROM films').get() as { title: string | null }).title).toBeNull();
  });

  it('applies directory fallback to a newly added film that remains unscraped', () => {
    makeFilm('0-Actor/ABC-002-C [FHD] Directory Title');
    const scan = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });

    const result = applyUnScrapedAddedFilmFallbacks(db, scan.addedFilms);

    expect(result).toEqual({ scrape_skipped: 0, fallback_applied: 1, fallback_fail: 0 });
    const film = db.prepare('SELECT title, locale, scan_status FROM films').get() as any;
    expect(film).toMatchObject({ title: 'Directory Title', locale: 'C', scan_status: 'parsed' });
    expect((db.prepare('SELECT name FROM actors').get() as { name: string }).name).toBe('Actor');
  });

  it('keeps duplicate-code additions out of metadata fallback', () => {
    makeFilm('ABC-003 First');
    makeFilm('ABC-003 Second');
    const scan = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    const canonical = scan.addedFilms.find(film => film.initializeMetadata)!;
    db.prepare('UPDATE films SET scraped_at=? WHERE id=?').run(Date.now(), canonical.filmId);

    const result = applyUnScrapedAddedFilmFallbacks(db, scan.addedFilms);

    expect(result.scrape_skipped).toBe(1);
    expect(result.fallback_applied).toBe(0);
  });

  it('finds existing unscraped films again after a later full scan', () => {
    makeFilm('AAA-001 First');
    makeFilm('BBB-002 Second');
    makeFilm('CCC-003 Third');
    const first = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    db.prepare('UPDATE films SET scraped_at=? WHERE id=?').run(Date.now(), first.addedFilms[0].filmId);

    const beforeRestart = listPendingFilmScrapes(db, root).map(film => film.code);
    const second = runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });
    const afterRestart = listPendingFilmScrapes(db, root).map(film => film.code);

    expect(second.addedFilms).toHaveLength(0);
    expect(beforeRestart).toEqual(['BBB-002', 'CCC-003']);
    expect(afterRestart).toEqual(beforeRestart);
  });

  it('returns only the earliest row for duplicate codes', () => {
    makeFilm('ABC-004 First');
    makeFilm('abc-004 Second');
    runScan(db, { mode: 'full', rootPath: root, defaultType: 'actor' });

    const pending = listPendingFilmScrapes(db, root);

    expect(pending).toHaveLength(1);
    expect(pending[0].code).toBe('ABC-004');
  });
});
