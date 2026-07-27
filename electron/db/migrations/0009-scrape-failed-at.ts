import type Database from 'better-sqlite3';

// 0009 — 刮削失败标记：批量刮削失败的影片记录时间戳，后续自动刮削跳过。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'scrape_failed_at')) {
    db.exec('ALTER TABLE films ADD COLUMN scrape_failed_at INTEGER');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(9);
}