import fs from 'node:fs';
import { ipcMain, shell } from 'electron';
import { getDb } from '../db';
import { listFilmFiles } from '../scanner/walker';
import { replaceFilmFiles } from '../db/queries';
import { nowMs, tx } from '../db/dao';

export function registerFileIpc() {
  ipcMain.handle('files:listByFilm', (_e, filmId: number) => {
    return getDb().prepare('SELECT * FROM film_files WHERE film_id=? ORDER BY name').all(filmId);
  });

  ipcMain.handle('files:pathStatus', async (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return { valid: false, reason: 'film_not_found' as const };
    try {
      const stat = await fs.promises.stat(film.abs_path);
      return stat.isDirectory()
        ? { valid: true, reason: 'ok' as const }
        : { valid: false, reason: 'not_directory' as const };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return {
        valid: false,
        reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' as const : 'unreadable' as const,
      };
    }
  });

  ipcMain.handle('files:openInFolder', async (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const result = await shell.openPath(film.abs_path);
    return result === '';
  });

  ipcMain.handle('files:restat', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const files = listFilmFiles(film.abs_path);
    tx(getDb(), () => replaceFilmFiles(getDb(), filmId, files));
    return true;
  });
}
