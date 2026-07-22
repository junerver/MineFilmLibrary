import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';

export function registerGenreIpc() {
  ipcMain.handle('genres:list', () => getDb().prepare('SELECT * FROM genres ORDER BY name').all());
  ipcMain.handle('genres:create', (_e, name: string) => {
    const r = getDb().prepare('INSERT INTO genres(name, created_at) VALUES(?,?)').run(name, nowMs());
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('genres:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM genres WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('genres:allTags', () => getDb().prepare('SELECT tag, COUNT(*) count FROM film_tags GROUP BY tag ORDER BY tag').all());
}
