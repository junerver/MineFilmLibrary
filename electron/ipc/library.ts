import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import type { FilmFilter, ListResult, FilmRow } from '../util/types';

const PAGE_SIZE_DEFAULT = 50;

export function registerLibraryIpc() {
  ipcMain.handle('library:list', (_e, filter: FilmFilter) => {
    const db = getDb();
    const page = filter.page ?? 1;
    const pageSize = filter.page_size ?? PAGE_SIZE_DEFAULT;
    const sortCol = filter.sort_by ?? 'updated_at';
    const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const where: string[] = [];
    const args: any[] = [];
    if (!filter.include_deleted) where.push('is_deleted=0');
    if (filter.q) {
      where.push('(code LIKE ? OR title LIKE ?)');
      const q = `%${filter.q}%`;
      args.push(q, q);
    }
    if (filter.locales?.length) {
      where.push(`locale IN (${filter.locales.map(() => '?').join(',')})`);
      args.push(...filter.locales);
    }
    if (filter.statuses?.length) {
      where.push(`scan_status IN (${filter.statuses.map(() => '?').join(',')})`);
      args.push(...filter.statuses);
    }
    if (filter.actors?.length) {
      where.push(`id IN (SELECT film_id FROM film_actors WHERE actor_id IN (${filter.actors.map(() => '?').join(',')}))`);
      args.push(...filter.actors);
    }
    if (filter.genres?.length) {
      where.push(`id IN (SELECT film_id FROM film_genres WHERE genre_id IN (${filter.genres.map(() => '?').join(',')}))`);
      args.push(...filter.genres);
    }
    if (filter.tags?.length) {
      where.push(`id IN (SELECT film_id FROM film_tags WHERE tag IN (${filter.tags.map(() => '?').join(',')}))`);
      args.push(...filter.tags);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (db.prepare(`SELECT COUNT(*) n FROM films ${whereSql}`).get(...args) as any).n;
    const items = db.prepare(`SELECT * FROM films ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as FilmRow[];
    return { items, total, page, page_size: pageSize } as ListResult<FilmRow>;
  });

  ipcMain.handle('library:get', (_e, id: number) => {
    const db = getDb();
    const film = db.prepare('SELECT * FROM films WHERE id=?').get(id) as FilmRow | undefined;
    if (!film) return null;
    const actors = db.prepare('SELECT a.id, a.name FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=?').all(id) as { id: number; name: string }[];
    const genres = db.prepare('SELECT g.id, g.name FROM film_genres fg JOIN genres g ON g.id=fg.genre_id WHERE fg.film_id=?').all(id) as { id: number; name: string }[];
    const tags = db.prepare('SELECT tag FROM film_tags WHERE film_id=?').all(id) as { tag: string }[];
    return { ...film, actors, genres, tags: tags.map(t => t.tag) };
  });

  ipcMain.handle('library:create', (_e, payload: Partial<FilmRow> & { tags?: string[]; actor_ids?: number[]; genre_ids?: number[] }) => {
    const db = getDb();
    const now = nowMs();
    return tx(db, () => {
      const r = db.prepare(`INSERT INTO films(code, title, raw_dir_name, abs_path, parent_dir_name, parent_type, locale, scan_status, fs_mtime_ms, is_deleted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`)
        .run(payload.code ?? null, payload.title ?? null, payload.raw_dir_name ?? payload.abs_path ?? '', payload.abs_path ?? '', payload.parent_dir_name ?? '', payload.parent_type ?? null, payload.locale ?? null, 'parsed', now, now, now);
      const id = Number(r.lastInsertRowid);
      if (payload.actor_ids?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
        for (const a of payload.actor_ids) ins.run(id, a);
      }
      if (payload.genre_ids?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_genres(film_id, genre_id) VALUES(?,?)');
        for (const g of payload.genre_ids) ins.run(id, g);
      }
      if (payload.tags?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_tags(tag, film_id) VALUES(?,?)');
        for (const t of payload.tags) ins.run(t, id);
      }
      return id;
    });
  });

  ipcMain.handle('library:update', (_e, id: number, patch: Partial<FilmRow> & { tags?: string[]; actor_ids?: number[]; genre_ids?: number[] }) => {
    const db = getDb();
    return tx(db, () => {
      const sets: string[] = [];
      const args: any[] = [];
      for (const k of ['code', 'title', 'locale', 'parent_type', 'parent_dir_name', 'cover_path', 'notes', 'scan_status'] as const) {
        if (k in patch) { sets.push(`${k}=?`); args.push((patch as any)[k]); }
      }
      sets.push('updated_at=?'); args.push(nowMs());
      args.push(id);
      db.prepare(`UPDATE films SET ${sets.join(',')} WHERE id=?`).run(...args);
      if (patch.tags) {
        db.prepare('DELETE FROM film_tags WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_tags(tag, film_id) VALUES(?,?)');
        for (const t of patch.tags) ins.run(t, id);
      }
      if (patch.actor_ids) {
        db.prepare('DELETE FROM film_actors WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
        for (const a of patch.actor_ids) ins.run(id, a);
      }
      if (patch.genre_ids) {
        db.prepare('DELETE FROM film_genres WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_genres(film_id, genre_id) VALUES(?,?)');
        for (const g of patch.genre_ids) ins.run(id, g);
      }
      return true;
    });
  });

  ipcMain.handle('library:softDelete', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=1, updated_at=? WHERE id=?').run(nowMs(), id);
    return true;
  });
  ipcMain.handle('library:hardDelete', (_e, id: number) => {
    getDb().prepare('DELETE FROM films WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('library:restore', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=0, updated_at=? WHERE id=?').run(nowMs(), id);
    return true;
  });
}
