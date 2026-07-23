import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSettingsIpc() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);

  ipcMain.handle('settings:get', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    out.default_parent_type ??= 'actor';
    out.scan_max_depth ??= '3';
    out.javbus_base_url ??= '';
    // 批量刮削并发：影片级 / 预览图级；默认比早期 3 更高，可在设置中调。
    out.scrape_film_concurrency ??= '6';
    out.scrape_sample_concurrency ??= '6';
    out.scrape_image_timeout_ms ??= '10000';
    // 隐私：总开关 privacy_mode；子项仅总开关开启时生效。
    // privacy_cover：封面默认隐藏（默认开）
    // privacy_text：非编号文字模糊，按住查看（默认关）
    out.privacy_mode ??= '1';
    out.privacy_cover ??= '1';
    out.privacy_text ??= '0';
    // 刮削范围：标题 / 元数据(演员题材备注) / 封面 / 样图。样图默认关（DMM 常超时）。
    out.scrape_enable_title ??= '1';
    out.scrape_enable_meta ??= '1';
    out.scrape_enable_cover ??= '1';
    out.scrape_enable_samples ??= '0';
    return out;
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb().prepare('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    return true;
  });
}
