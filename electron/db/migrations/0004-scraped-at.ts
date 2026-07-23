import type Database from 'better-sqlite3';

// 0004 — 刮削标记：记录最近一次成功 JavBus 刮削时间，用于列表/详情展示与批量跳过。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'scraped_at')) {
    db.exec('ALTER TABLE films ADD COLUMN scraped_at INTEGER');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(4);
}
