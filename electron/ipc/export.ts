import { ipcMain, dialog } from 'electron';
import { getDb } from '../db';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function filmCsvRow(f: any): string {
  const escape = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ['id', 'code', 'title', 'locale', 'parent_type', 'parent_dir_name', 'raw_dir_name', 'abs_path', 'scan_status', 'fs_mtime_ms', 'updated_at']
    .map(k => escape(f[k])).join(',');
}

export function registerExportIpc() {
  ipcMain.handle('export:csv', async (_e, filter: { include_deleted?: boolean }) => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    const where = filter.include_deleted ? '' : 'WHERE is_deleted=0';
    const films = getDb().prepare(`SELECT * FROM films ${where} ORDER BY id`).all() as any[];
    const header = 'id,code,title,locale,parent_type,parent_dir_name,raw_dir_name,abs_path,scan_status,fs_mtime_ms,updated_at\n';
    fs.writeFileSync(res.filePath, header + films.map(filmCsvRow).join('\n'), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('export:json', async (_e, filter: { include_deleted?: boolean }) => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    const where = filter.include_deleted ? '' : 'WHERE is_deleted=0';
    const films = getDb().prepare(`SELECT * FROM films ${where} ORDER BY id`).all() as any[];
    const enriched = films.map(f => ({
      ...f,
      actors: getDb().prepare('SELECT a.id, a.name FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=?').all(f.id),
      genres: getDb().prepare('SELECT g.id, g.name FROM film_genres fg JOIN genres g ON g.id=fg.genre_id WHERE fg.film_id=?').all(f.id),
      tags: (getDb().prepare('SELECT tag FROM film_tags WHERE film_id=?').all(f.id) as { tag: string }[]).map(t => t.tag),
      files: getDb().prepare('SELECT * FROM film_files WHERE film_id=? ORDER BY name').all(f.id),
    }));
    fs.writeFileSync(res.filePath, JSON.stringify({ exported_at: Date.now(), films: enriched }, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('export:sqlite', async () => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm-backup.sqlite', filters: [{ name: 'SQLite', extensions: ['sqlite'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    await getDb().backup(res.filePath);
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('import:sqlite', async () => {
    const res = await dialog.showOpenDialog({ filters: [{ name: 'SQLite', extensions: ['sqlite'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    const src = res.filePaths[0];
    const db = getDb();
    const backupPath = db.name + '.preimport.bak';
    await db.backup(backupPath);
    const srcDb = new Database(src, { readonly: true });
    try {
      db.prepare('DELETE FROM film_files').run();
      db.prepare('DELETE FROM film_tags').run();
      db.prepare('DELETE FROM film_genres').run();
      db.prepare('DELETE FROM film_actors').run();
      db.prepare('DELETE FROM films').run();
      db.prepare('DELETE FROM actors').run();
      db.prepare('DELETE FROM genres').run();
      db.prepare('DELETE FROM cover_blobs').run();
      db.prepare('DELETE FROM scan_roots').run();
      db.prepare('DELETE FROM scan_runs').run();
      for (const t of ['actors', 'genres', 'films', 'film_actors', 'film_genres', 'film_tags', 'film_files', 'cover_blobs', 'scan_roots', 'scan_runs']) {
        const rows = srcDb.prepare(`SELECT * FROM ${t}`).all() as any[];
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(',');
        const ins = db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${placeholders})`);
        for (const r of rows) ins.run(...cols.map(c => r[c]));
      }
    } finally {
      srcDb.close();
    }
    return { ok: true, backupPath };
  });
}
