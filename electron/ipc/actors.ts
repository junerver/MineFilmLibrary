import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';

export function registerActorIpc() {
  ipcMain.handle('actors:list', () => {
    return getDb().prepare(`SELECT a.*, COUNT(fa.film_id) film_count FROM actors a LEFT JOIN film_actors fa ON fa.actor_id=a.id GROUP BY a.id ORDER BY a.name`).all();
  });
  ipcMain.handle('actors:create', (_e, name: string, rawDirName?: string, category?: string) => {
    const now = nowMs();
    const r = getDb().prepare('INSERT INTO actors(name, raw_dir_name, category, created_at, updated_at) VALUES(?,?,?,?,?)').run(name, rawDirName ?? null, category ?? null, now, now);
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('actors:update', (_e, id: number, patch: { name?: string; category?: string }) => {
    const sets: string[] = []; const args: any[] = [];
    if (patch.name !== undefined) { sets.push('name=?'); args.push(patch.name); }
    if (patch.category !== undefined) { sets.push('category=?'); args.push(patch.category); }
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
}
