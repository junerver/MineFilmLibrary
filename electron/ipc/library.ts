import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import { recomputeCodeCounts } from '../db/queries';
import { toTraditional } from '../util/zhConvert';
import type { FilmFilter, ListResult, FilmRow } from '../util/types';

const PAGE_SIZE_DEFAULT = 50;

export function registerLibraryIpc() {
  ipcMain.handle('library:list', (_e, filter: FilmFilter) => {
    const db = getDb();
    const page = filter.page ?? 1;
    const pageSize = filter.page_size ?? PAGE_SIZE_DEFAULT;
    const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';
    // 拼 ORDER BY 的列要白名单，避免任何来自前端的字符串直接进 SQL。
    // actors 是 computed 列（actors_names），由下面的子查询带出；空 actors 的影片
    // 在 ASC 时排最前 → 用「actors_names 为空 → 1（排前）」的组合表达式。
    // 这是业务规则：未挂演员信息的影片在按演员排序时浮到顶部，方便用户优先处理。
    const ALLOWED_SORT: Record<string, string> = {
      code: 'code',
      title: 'title',
      updated_at: 'updated_at',
      fs_mtime_ms: 'fs_mtime_ms',
      actors: "CASE WHEN actors_names = '' THEN 0 ELSE 1 END, actors_names",
      // 未刮削 (NULL) 在 ASC 时靠前，便于优先处理
      scraped_at: 'CASE WHEN scraped_at IS NULL THEN 0 ELSE 1 END, scraped_at',
    };
    const sortColRaw = filter.sort_by ?? 'updated_at';
    const sortCol = ALLOWED_SORT[sortColRaw] ?? 'updated_at';
    const where: string[] = [];
    const args: any[] = [];
    if (!filter.include_deleted) where.push('is_deleted=0');
    if (filter.duplicate_codes_only) where.push('code_count > 1');
    if (filter.favorites_only) where.push('is_favorite=1');
    if (filter.q) {
      where.push('(code LIKE ? OR title LIKE ? OR studio LIKE ? OR label LIKE ? OR id IN (SELECT film_id FROM film_tags WHERE tag LIKE ?) OR id IN (SELECT film_id FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE a.name LIKE ?))');
      // 简体输入转繁体再 LIKE，与库中 javbus 抓来的繁体内容互通。
      const q = `%${toTraditional(filter.q)}%`;
      args.push(q, q, q, q, q, q);
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
    // SELECT * 拿 films 行；附带的 actors_names 用相关子查询 GROUP_CONCAT 拼好——
    // 让前端列表行能直接显示演员名（多个用"、"分隔），无需为每行再发一次 IPC。
    // 子查询里按 film_actors JOIN actors 取 name；演员按 a.id 排序保证多演员顺序稳定。
    const items = db.prepare(`SELECT films.*,
        COALESCE((SELECT GROUP_CONCAT(a.name, '、') FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=films.id), '') AS actors_names
        FROM films ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`)
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
    // 同编号兄弟影片（用于详情页"多路径"提示）。code 为 NULL 时返回空数组。
    const same_code_films = film.code
      ? db.prepare('SELECT id, abs_path, parent_dir_name, scan_status FROM films WHERE code=? COLLATE NOCASE AND id<>? AND is_deleted=0 ORDER BY abs_path').all(film.code, id) as { id: number; abs_path: string; parent_dir_name: string; scan_status: string }[]
      : [];
    return { ...film, actors, genres, tags: tags.map(t => t.tag), same_code_films };
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
      // 手工新建影片也会影响同编号重复统计，立刻重算一次（小型库可忽略）。
      recomputeCodeCounts(db);
      return id;
    });
  });

  ipcMain.handle('library:update', (_e, id: number, patch: Partial<FilmRow> & { tags?: string[]; actor_ids?: number[]; genre_ids?: number[] }) => {
    const db = getDb();
    return tx(db, () => {
      const sets: string[] = [];
      const args: any[] = [];
      for (const k of ['code', 'title', 'locale', 'parent_type', 'parent_dir_name', 'cover_path', 'notes', 'scan_status', 'scraped_at', 'studio', 'label'] as const) {
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
      // 改了 code 必然影响重复统计；统一重算一次（小型库可接受）。
      if ('code' in patch) recomputeCodeCounts(db);
      return true;
    });
  });

  ipcMain.handle('library:softDelete', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=1, updated_at=? WHERE id=?').run(nowMs(), id);
    recomputeCodeCounts(getDb());
    return true;
  });
  ipcMain.handle('library:hardDelete', (_e, id: number) => {
    getDb().prepare('DELETE FROM films WHERE id=?').run(id);
    recomputeCodeCounts(getDb());
    return true;
  });
  ipcMain.handle('library:restore', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=0, updated_at=? WHERE id=?').run(nowMs(), id);
    recomputeCodeCounts(getDb());
    return true;
  });

  // 切换收藏星标。favorite 为真 → 1，假 → 0。
  ipcMain.handle('library:setFavorite', (_e, id: number, favorite: boolean) => {
    const flag = favorite ? 1 : 0;
    const info = getDb().prepare('UPDATE films SET is_favorite=?, updated_at=? WHERE id=?')
      .run(flag, nowMs(), id);
    return info.changes > 0;
  });
}
