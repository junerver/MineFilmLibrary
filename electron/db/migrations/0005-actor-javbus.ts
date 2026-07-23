import type Database from 'better-sqlite3';

// 0005 - 每位演员的 JavBus 主页、最近一次主页刮削结果与时间。
// JSON 只保存文字资料和作品链接，不缓存或展示远程头像/封面。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('javbus_url')) db.exec('ALTER TABLE actors ADD COLUMN javbus_url TEXT');
  if (!names.has('javbus_data_json')) db.exec('ALTER TABLE actors ADD COLUMN javbus_data_json TEXT');
  if (!names.has('javbus_scraped_at')) db.exec('ALTER TABLE actors ADD COLUMN javbus_scraped_at INTEGER');
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(5);
}
