import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { applyScanFallback, runScan } from '../electron/scanner/index';
import { addActorAlias, listAllFilmPaths, mergeActors } from '../electron/db/queries';

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
  it('inserts only path, code and files; metadata is not initialized by scanning', () => {
    mkdir('0-Julia/CJOD-295-C [FHD] Title A');
    touch('0-Julia/CJOD-295-C [FHD] Title A/m.mp4', 'xx');
    touch('0-Julia/CJOD-295-C [FHD] Title A/c.jpg', 'yy');

    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(1);
    expect(stats.dir_seen).toBe(1);

    const film = db.prepare('SELECT * FROM films WHERE id=1').get() as any;
    expect(film.code).toBe('CJOD-295');
    expect(film.locale).toBeNull();
    expect(film.title).toBeNull();
    expect(film.parent_type).toBeNull();
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM film_tags').get() as any).n).toBe(0);

    const files = db.prepare('SELECT * FROM film_files').all() as any[];
    expect(files.length).toBe(2);

    const cover = db.prepare('SELECT cover_path FROM films').get() as any;
    expect(cover.cover_path).toBeNull();
  });

  it('fallback after a failed scrape creates genre, not actor', () => {
    mkdir('1-剧情/BBB-1 T');
    touch('1-剧情/BBB-1 T/a.mp4');
    const result = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(applyScanFallback(db, result.addedFilms[0])).toBe(true);
    const actors = db.prepare('SELECT COUNT(*) n FROM actors').get() as any;
    const genres = db.prepare('SELECT name FROM genres').all() as any[];
    expect(actors.n).toBe(0);
    expect(genres.map(g => g.name)).toEqual(['剧情']);
  });

  for (const mode of ['full', 'incremental'] as const) {
    it(`${mode} keeps a missing directory record instead of soft-deleting it`, () => {
      mkdir('0-J/CJOD-295-C [FHD] T');
      touch('0-J/CJOD-295-C [FHD] T/a.mp4');
      runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
      fs.rmSync(path.join(rootPath, '0-J'), { recursive: true, force: true });

      const stats = runScan(db, { mode, rootPath, defaultType: 'actor' });
      expect(stats.dir_removed).toBe(0);
      const film = db.prepare('SELECT is_deleted FROM films').get() as any;
      expect(film.is_deleted).toBe(0);
    });
  }

  for (const mode of ['full', 'incremental'] as const) {
    it(`${mode} preserves a manually soft-deleted record and never duplicates its path`, () => {
      const relDir = '0-J/CJOD-296-C T';
      const absDir = path.join(rootPath, relDir);
      mkdir(relDir);
      touch(`${relDir}/old.mp4`);
      runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
      const id = (db.prepare('SELECT id FROM films WHERE abs_path=?').get(absDir) as any).id;
      db.prepare('UPDATE films SET is_deleted=1 WHERE id=?').run(id);

      touch(`${relDir}/new.mp4`);
      const future = new Date(Date.now() + 2_000);
      fs.utimesSync(absDir, future, future);
      const stats = runScan(db, { mode, rootPath, defaultType: 'actor' });

      expect(stats.dir_added).toBe(0);
      expect(stats.dir_removed).toBe(0);
      expect((db.prepare('SELECT COUNT(*) n FROM films WHERE abs_path=?').get(absDir) as any).n).toBe(1);
      expect((db.prepare('SELECT is_deleted FROM films WHERE id=?').get(id) as any).is_deleted).toBe(1);
      expect((db.prepare('SELECT name FROM film_files WHERE film_id=? ORDER BY name').all(id) as any[]).map(r => r.name))
        .toEqual(['new.mp4', 'old.mp4']);
    });
  }

  it('does not soft-delete a sibling root that only shares a path prefix', () => {
    const siblingRoot = `${rootPath}-精品`;
    const siblingFilm = path.join(siblingRoot, 'ABC-1 Sibling Film');
    fs.mkdirSync(siblingFilm, { recursive: true });
    fs.writeFileSync(path.join(siblingFilm, 'sibling.mp4'), 'x');
    runScan(db, { mode: 'full', rootPath: siblingRoot, defaultType: 'actor' });

    mkdir('DEF-2 Main Film');
    touch('DEF-2 Main Film/main.mp4');
    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });

    expect(stats.dir_removed).toBe(0);
    const sibling = db.prepare('SELECT is_deleted FROM films WHERE abs_path=?').get(siblingFilm) as { is_deleted: number };
    expect(sibling.is_deleted).toBe(0);
    // 基线查询本身也必须只返回真正位于 root 下的路径。
    expect(listAllFilmPaths(db, rootPath).map(r => r.abs_path)).not.toContain(siblingFilm);
  });

  it('incremental skips unchanged dirs', () => {
    mkdir('0-J/CJOD-295-C [FHD] T');
    touch('0-J/CJOD-295-C [FHD] T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const stats = runScan(db, { mode: 'incremental', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(0);
    expect(stats.dir_updated).toBe(0);
  });

  for (const mode of ['full', 'incremental'] as const) {
    it(`${mode} re-scan refreshes files without overwriting curated metadata`, () => {
      const relDir = '0-DirectoryActor/AAA-1 Parsed From Directory';
      const absDir = path.join(rootPath, relDir);
      mkdir(relDir);
      touch(`${relDir}/movie.mp4`);
      touch(`${relDir}/manual-cover.jpg`, 'manual-cover');
      runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });

      const film = db.prepare('SELECT id FROM films WHERE abs_path=?').get(absDir) as { id: number };
      const now = Date.now();
      const actorId = Number(db.prepare('INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)')
        .run('Curated Actor', 'Curated Actor', now, now).lastInsertRowid);
      const genreId = Number(db.prepare('INSERT INTO genres(name, created_at) VALUES(?,?)')
        .run('Curated Genre', now).lastInsertRowid);

      db.prepare(`UPDATE films SET
        code=?, title=?, raw_dir_name=?, parent_dir_name=?, parent_type=?, locale=?,
        cover_path=?, notes=?, scan_status=?, scraped_at=?
        WHERE id=?`
      ).run(
        'CUSTOM-999', 'Curated title', 'Curated raw name', 'Curated parent', 'genre', 'U',
        'manual-cover.jpg', 'Curated notes', 'parsed', now, film.id,
      );
      db.prepare('DELETE FROM film_actors WHERE film_id=?').run(film.id);
      db.prepare('INSERT INTO film_actors(film_id, actor_id) VALUES(?,?)').run(film.id, actorId);
      db.prepare('DELETE FROM film_genres WHERE film_id=?').run(film.id);
      db.prepare('INSERT INTO film_genres(film_id, genre_id) VALUES(?,?)').run(film.id, genreId);
      db.prepare('DELETE FROM film_tags WHERE film_id=?').run(film.id);
      db.prepare('INSERT INTO film_tags(tag, film_id) VALUES(?,?)').run('Curated Tag', film.id);

      // 模拟刮削写入新封面导致目录 mtime 改变。
      touch(`${relDir}/scraped-cover.jpg`, 'new-and-larger-cover');
      const future = new Date(Date.now() + 2_000);
      fs.utimesSync(absDir, future, future);

      const stats = runScan(db, { mode, rootPath, defaultType: 'actor' });
      expect(stats.dir_updated).toBe(1);

      const updated = db.prepare(`SELECT code, title, raw_dir_name, parent_dir_name, parent_type,
        locale, cover_path, notes, scan_status, scraped_at FROM films WHERE id=?`).get(film.id) as any;
      expect(updated).toMatchObject({
        code: 'CUSTOM-999',
        title: 'Curated title',
        raw_dir_name: 'Curated raw name',
        parent_dir_name: 'Curated parent',
        parent_type: 'genre',
        locale: 'U',
        cover_path: 'manual-cover.jpg',
        notes: 'Curated notes',
        scan_status: 'parsed',
        scraped_at: now,
      });
      expect(db.prepare('SELECT actor_id FROM film_actors WHERE film_id=?').all(film.id)).toEqual([{ actor_id: actorId }]);
      expect(db.prepare('SELECT genre_id FROM film_genres WHERE film_id=?').all(film.id)).toEqual([{ genre_id: genreId }]);
      expect(db.prepare('SELECT tag FROM film_tags WHERE film_id=?').all(film.id)).toEqual([{ tag: 'Curated Tag' }]);
      const fileNames = (db.prepare('SELECT name FROM film_files WHERE film_id=? ORDER BY name').all(film.id) as { name: string }[])
        .map(f => f.name);
      expect(fileNames).toEqual(['manual-cover.jpg', 'movie.mp4', 'scraped-cover.jpg']);
    });
  }

  // Q3：两个不同目录、同样编号，扫描后 code_count 必须都是 2，列表徽标才显示。
  it('recomputeCodeCounts marks duplicates across dirs', () => {
    mkdir('0-J/SSIS-100 T1');
    touch('0-J/SSIS-100 T1/a.mp4');
    mkdir('0-M/SSIS-100 T2');
    touch('0-M/SSIS-100 T2/b.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const counts = db.prepare('SELECT code, code_count FROM films WHERE code IS NOT NULL ORDER BY abs_path').all() as { code: string; code_count: number }[];
    expect(counts.length).toBe(2);
    expect(counts.every(r => r.code_count === 2)).toBe(true);
  });

  it('treats code casing as equivalent and only fallback-initializes metadata once', () => {
    mkdir('0-J/SSIS-101-C [FHD] First Title');
    touch('0-J/SSIS-101-C [FHD] First Title/first.mp4');
    touch('0-J/SSIS-101-C [FHD] First Title/cover.jpg', 'cover');
    mkdir('0-M/ssis-101-C [UHD] Second Title');
    touch('0-M/ssis-101-C [UHD] Second Title/second.mp4');

    const result = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(result.addedFilms).toHaveLength(2);
    expect(result.addedFilms.filter(f => f.initializeMetadata)).toHaveLength(1);
    expect(applyScanFallback(db, result.addedFilms[0])).toBe(true);

    const films = db.prepare('SELECT code, title, locale, cover_path, parent_type FROM films ORDER BY abs_path').all() as any[];
    expect(films).toHaveLength(2);
    expect(films.filter(f => f.title != null)).toHaveLength(1);
    expect(films.filter(f => f.cover_path != null)).toHaveLength(1);
    expect(films.filter(f => f.locale != null)).toHaveLength(1);
    expect(films.filter(f => f.parent_type != null)).toHaveLength(1);
    expect((db.prepare('SELECT COUNT(*) n FROM film_tags').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM film_actors').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM films WHERE code_count=2').get() as any).n).toBe(2);
  });

  it('does not auto-identify a code that only exists in the recycle bin', () => {
    mkdir('0-J/REC-100-C [FHD] Original Title');
    touch('0-J/REC-100-C [FHD] Original Title/a.mp4');
    const originalScan = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(applyScanFallback(db, originalScan.addedFilms[0])).toBe(true);
    const original = db.prepare('SELECT id FROM films').get() as any;
    db.prepare('UPDATE films SET is_deleted=1 WHERE id=?').run(original.id);

    fs.rmSync(path.join(rootPath, '0-J'), { recursive: true, force: true });
    mkdir('0-M/rec-100-C [UHD] Reintroduced Copy');
    touch('0-M/rec-100-C [UHD] Reintroduced Copy/b.mp4');
    const secondScan = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(secondScan.addedFilms[0].initializeMetadata).toBe(false);
    expect(applyScanFallback(db, secondScan.addedFilms[0])).toBe(false);

    const copy = db.prepare('SELECT title, locale, parent_type, cover_path FROM films WHERE id<>?').get(original.id) as any;
    expect(copy.title).toBeNull();
    expect(copy.locale).toBeNull();
    expect(copy.parent_type).toBeNull();
    expect(copy.cover_path).toBeNull();
  });

  // Q5：同一演员的两个目录名（比如一个是别名），先扫一次会建出两个 actor；
  // 用户在 UI 把第二个名字加成第一个的 alias 后，再扫不应再新建 actor。
  it('alias resolution: second alias-named dir folds into canonical actor', () => {
    mkdir('0-Julia/AAA-1 T');
    touch('0-Julia/AAA-1 T/a.mp4');
    const first = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(applyScanFallback(db, first.addedFilms[0])).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    const juliaId = (db.prepare('SELECT id FROM actors WHERE name=?').get('Julia') as any).id;
    // 把 "Ogura" 标成 Julia 的别名——模拟用户在 UI 操作。
    expect(addActorAlias(db, juliaId, 'Ogura')).toBe(true);
    // 现在扫描出现一个名字叫 Ogura 的演员目录时，要走别名链归到 Julia 上。
    mkdir('0-Ogura/BBB-2 T');
    touch('0-Ogura/BBB-2 T/a.mp4');
    const second = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(applyScanFallback(db, second.addedFilms[0])).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    // 两部影片都关联到同一个 actor。
    const links = db.prepare('SELECT COUNT(*) n FROM film_actors WHERE actor_id=?').get(juliaId) as any;
    expect(links.n).toBe(2);
  });

  // Q1 + Q5 综合：平铺根扫描也能正常入库，并且不会建任何演员/题材。
  it('flat root scan stores films with empty parent_dir_name', () => {
    mkdir('CJOD-295-C [FHD] Flat Title');
    touch('CJOD-295-C [FHD] Flat Title/a.mp4');
    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(1);
    const film = db.prepare('SELECT parent_dir_name, parent_type FROM films WHERE id=1').get() as any;
    expect(film.parent_dir_name).toBe('');
    expect(film.parent_type).toBeNull();
    // 平铺根扫描不应创建任何演员或题材。
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM genres').get() as any).n).toBe(0);
  });

  // Q5 mergeActors：把 from 的电影搬到 to，删掉 from，确保整个流程在事务内安全。
  it('mergeActors moves films and removes source actor', () => {
    mkdir('0-J/CODE-1 T');
    touch('0-J/CODE-1 T/a.mp4');
    mkdir('0-M/CODE-2 T');
    touch('0-M/CODE-2 T/a.mp4');
    const result = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    for (const film of result.addedFilms) expect(applyScanFallback(db, film)).toBe(true);
    // 两个演员 J 和 M，各 1 部影片；把 M 合并到 J。
    const jId = (db.prepare('SELECT id FROM actors WHERE name=?').get('J') as any).id;
    const mId = (db.prepare('SELECT id FROM actors WHERE name=?').get('M') as any).id;
    mergeActors(db, mId, jId);
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM film_actors WHERE actor_id=?').get(jId) as any).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) n FROM film_actors WHERE actor_id=?').get(mId) as any).n).toBe(0);
  });

  it('mergeActors preserves favorite if either side is favorited', () => {
    mkdir('0-J/CODE-1 T');
    touch('0-J/CODE-1 T/a.mp4');
    mkdir('0-M/CODE-2 T');
    touch('0-M/CODE-2 T/a.mp4');
    const result = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    for (const film of result.addedFilms) expect(applyScanFallback(db, film)).toBe(true);
    const jId = (db.prepare('SELECT id FROM actors WHERE name=?').get('J') as any).id;
    const mId = (db.prepare('SELECT id FROM actors WHERE name=?').get('M') as any).id;
    db.prepare('UPDATE actors SET is_favorite=1 WHERE id=?').run(mId);
    mergeActors(db, mId, jId);
    const j = db.prepare('SELECT is_favorite FROM actors WHERE id=?').get(jId) as { is_favorite: number };
    expect(j.is_favorite).toBe(1);
  });
});
