import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';
import { addActorAlias, listActorAliases, removeActorAlias, mergeActors } from '../db/queries';
import type { ActorRow } from '../util/types';

export function registerActorIpc() {
  ipcMain.handle('actors:list', () => {
    const db = getDb();
    const rows = db.prepare(`SELECT a.*, COUNT(fa.film_id) film_count FROM actors a LEFT JOIN film_actors fa ON fa.actor_id=a.id GROUP BY a.id ORDER BY a.name`).all() as ActorRow[];
    // 一次群查所有别名，按 actor_id 在 JS 端聚合，避免 N+1。
    const allAliases = db.prepare('SELECT alias, actor_id FROM actor_aliases').all() as { alias: string; actor_id: number }[];
    const byActor = new Map<number, string[]>();
    for (const a of allAliases) {
      const arr = byActor.get(a.actor_id);
      if (arr) arr.push(a.alias);
      else byActor.set(a.actor_id, [a.alias]);
    }
    for (const r of rows) r.aliases = byActor.get(r.id) ?? [];
    return rows;
  });
  ipcMain.handle('actors:create', (_e, name: string, rawDirName?: string, category?: string, notes?: string) => {
    const now = nowMs();
    const r = getDb().prepare('INSERT INTO actors(name, raw_dir_name, category, notes, created_at, updated_at) VALUES(?,?,?,?,?,?)').run(name, rawDirName ?? null, category ?? null, notes ?? null, now, now);
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('actors:update', (_e, id: number, patch: { name?: string; category?: string; notes?: string }) => {
    const sets: string[] = []; const args: any[] = [];
    if (patch.name !== undefined) { sets.push('name=?'); args.push(patch.name); }
    if (patch.category !== undefined) { sets.push('category=?'); args.push(patch.category); }
    if (patch.notes !== undefined) { sets.push('notes=?'); args.push(patch.notes); }
    if (!sets.length) return false;
    sets.push('updated_at=?'); args.push(nowMs()); args.push(id);
    getDb().prepare(`UPDATE actors SET ${sets.join(',')} WHERE id=?`).run(...args);
    return true;
  });
  ipcMain.handle('actors:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM actors WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('actors:films', (_e, actorId: number) => {
    return getDb().prepare(`SELECT f.* FROM films f JOIN film_actors fa ON fa.film_id=f.id WHERE fa.actor_id=? AND f.is_deleted=0`).all(actorId);
  });

  // 自动补全用：按 q 在 name 或 alias 上做前缀 LIKE 匹配。
  // 命中 alias 时也带回 canonical actor 的 id+name，方便前端选中后直接落 actor_id。
  // 上限 20 防止输入很短时把整个库都拉回来。
  ipcMain.handle('actors:quickFind', (_e, q: string) => {
    const term = (q ?? '').trim();
    if (!term) return [];
    const like = `%${term}%`;
    return getDb().prepare(
      `SELECT DISTINCT a.id, a.name FROM actors a
         LEFT JOIN actor_aliases al ON al.actor_id = a.id
         WHERE a.name LIKE ? OR al.alias LIKE ?
         ORDER BY a.name LIMIT 20`
    ).all(like, like) as { id: number; name: string }[];
  });

  // —— 别名 + 合并 ——
  ipcMain.handle('actors:addAlias', (_e, actorId: number, alias: string) => {
    return addActorAlias(getDb(), actorId, alias);
  });
  ipcMain.handle('actors:removeAlias', (_e, alias: string) => {
    return removeActorAlias(getDb(), alias);
  });
  ipcMain.handle('actors:listAliases', (_e, actorId: number) => {
    return listActorAliases(getDb(), actorId);
  });
  ipcMain.handle('actors:merge', (_e, fromId: number, toId: number) => {
    mergeActors(getDb(), fromId, toId);
    return true;
  });
}
