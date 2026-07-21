import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSettingsIpc() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);

  ipcMain.handle('settings:get', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    out.default_parent_type ??= 'actor';
    return out;
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb().prepare('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    return true;
  });
}
