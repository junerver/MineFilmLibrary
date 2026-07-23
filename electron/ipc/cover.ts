import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import fs from 'node:fs';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function readImageFile(abs: string): { kind: 'file'; mime: string; base64: string } | null {
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  try {
    const buf = fs.readFileSync(abs);
    return { kind: 'file', mime, base64: buf.toString('base64') };
  } catch {
    return null;
  }
}

export function registerCoverIpc() {
  // 影片目录内图片列表（详情封面左右切换）。不读文件内容。
  ipcMain.handle('cover:listImages', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path, cover_path FROM films WHERE id=?').get(filmId) as
      { abs_path: string; cover_path: string | null } | undefined;
    if (!film?.abs_path || !fs.existsSync(film.abs_path)) {
      return { images: [] as { rel_path: string; name: string }[], cover_path: null as string | null };
    }

    let images = getDb().prepare(
      `SELECT rel_path, name FROM film_files WHERE film_id=? AND is_image=1 ORDER BY name`
    ).all(filmId) as { rel_path: string; name: string }[];

    if (!images.length) {
      try {
        images = fs.readdirSync(film.abs_path)
          .filter(n => IMAGE_EXT.has(path.extname(n).toLowerCase()))
          .sort((a, b) => a.localeCompare(b))
          .map(n => ({ rel_path: n, name: n }));
      } catch {
        images = [];
      }
    }

    // cover_path 排最前
    if (film.cover_path) {
      const i = images.findIndex(x => x.rel_path === film.cover_path || x.name === film.cover_path);
      if (i > 0) {
        const [c] = images.splice(i, 1);
        images.unshift(c);
      } else if (i < 0) {
        images.unshift({ rel_path: film.cover_path, name: path.basename(film.cover_path) });
      }
    }
    return { images, cover_path: film.cover_path };
  });

  ipcMain.handle('cover:getCover', (_e, filmId: number, opts?: { display?: boolean; rel_path?: string }) => {
    // 安全门：未显式 display 时一律不返回图片数据。
    if (!opts?.display) return null;
    const film = getDb().prepare('SELECT cover_path, cover_blob_id, abs_path FROM films WHERE id=?').get(filmId) as any;
    if (!film) return null;

    // 指定目录相对路径（封面切换浏览）
    if (opts.rel_path) {
      const rel = String(opts.rel_path).replace(/\\/g, '/');
      if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
      const abs = path.join(film.abs_path, rel);
      const root = path.resolve(film.abs_path) + path.sep;
      if (!(path.resolve(abs) + path.sep).startsWith(root) && path.resolve(abs) !== path.resolve(film.abs_path)) {
        // 允许文件在 root 下
        if (!path.resolve(abs).startsWith(path.resolve(film.abs_path))) return null;
      }
      return readImageFile(abs);
    }

    if (film.cover_blob_id) {
      const blob = getDb().prepare('SELECT mime, data FROM cover_blobs WHERE id=?').get(film.cover_blob_id) as any;
      if (blob) return { kind: 'blob', mime: blob.mime, base64: blob.data.toString('base64') };
    }
    if (film.cover_path) {
      return readImageFile(path.join(film.abs_path, film.cover_path));
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
