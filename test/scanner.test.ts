import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { runScan } from '../electron/scanner/index';
import { addActorAlias, mergeActors } from '../electron/db/queries';

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

  // Q5：同一演员的两个目录名（比如一个是别名），先扫一次会建出两个 actor；
  // 用户在 UI 把第二个名字加成第一个的 alias 后，再扫不应再新建 actor。
  it('alias resolution: second alias-named dir folds into canonical actor', () => {
    mkdir('0-Julia/AAA-1 T');
    touch('0-Julia/AAA-1 T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    const juliaId = (db.prepare('SELECT id FROM actors WHERE name=?').get('Julia') as any).id;
    // 把 "Ogura" 标成 Julia 的别名——模拟用户在 UI 操作。
    expect(addActorAlias(db, juliaId, 'Ogura')).toBe(true);
    // 现在扫描出现一个名字叫 Ogura 的演员目录时，要走别名链归到 Julia 上。
    mkdir('0-Ogura/BBB-2 T');
    touch('0-Ogura/BBB-2 T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
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
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    // 两个演员 J 和 M，各 1 部影片；把 M 合并到 J。
    const jId = (db.prepare('SELECT id FROM actors WHERE name=?').get('J') as any).id;
    const mId = (db.prepare('SELECT id FROM actors WHERE name=?').get('M') as any).id;
    mergeActors(db, mId, jId);
    expect((db.prepare('SELECT COUNT(*) n FROM actors').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM film_actors WHERE actor_id=?').get(jId) as any).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) n FROM film_actors WHERE actor_id=?').get(mId) as any).n).toBe(0);
  });
});
