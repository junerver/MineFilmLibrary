import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import fs from 'node:fs';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

export function registerCoverIpc() {
  ipcMain.handle('cover:getCover', (_e, filmId: number, opts?: { display?: boolean }) => {
    if (!opts?.display) return null;
    const film = getDb().prepare('SELECT cover_path, cover_blob_id, abs_path FROM films WHERE id=?').get(filmId) as any;
    if (!film) return null;
    if (film.cover_blob_id) {
      const blob = getDb().prepare('SELECT mime, data FROM cover_blobs WHERE id=?').get(film.cover_blob_id) as any;
      if (blob) return { kind: 'blob', mime: blob.mime, base64: blob.data.toString('base64') };
    }
    if (film.cover_path) {
      const abs = path.join(film.abs_path, film.cover_path);
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      try {
        const buf = fs.readFileSync(abs);
        return { kind: 'file', mime, base64: buf.toString('base64') };
      } catch {
        return null;
      }
    }
    return null;
  });

  ipcMain.handle('cover:upload', async (_e, filmId: number, fileName: string, base64: string) => {
    const ext = path.extname(fileName).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const buf = Buffer.from(base64, 'base64');
    return tx(getDb(), () => {
      const r = getDb().prepare('INSERT INTO cover_blobs(mime, data, created_at) VALUES(?,?,?)').run(mime, buf, nowMs());
      const id = Number(r.lastInsertRowid);
      getDb().prepare('UPDATE films SET cover_blob_id=?, cover_path=NULL, updated_at=? WHERE id=?').run(id, nowMs(), filmId);
      return id;
    });
  });

  ipcMain.handle('cover:clear', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT cover_blob_id FROM films WHERE id=?').get(filmId) as any;
    if (film?.cover_blob_id) getDb().prepare('DELETE FROM cover_blobs WHERE id=?').run(film.cover_blob_id);
    getDb().prepare('UPDATE films SET cover_blob_id=NULL, cover_path=NULL, updated_at=? WHERE id=?').run(nowMs(), filmId);
    return true;
  });
}
