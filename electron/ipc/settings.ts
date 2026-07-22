import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSettingsIpc() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);

  ipcMain.handle('settings:get', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    out.default_parent_type ??= 'actor';
    out.javbus_base_url ??= '';
    // 批量刮削并发：影片级 / 预览图级；默认比早期 3 更高，可在设置中调。
    out.scrape_film_concurrency ??= '6';
    out.scrape_sample_concurrency ??= '6';
    out.scrape_image_timeout_ms ??= '10000';
    return out;
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb().prepare('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    return true;
  });
}
