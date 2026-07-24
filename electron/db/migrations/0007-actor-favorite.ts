import type Database from 'better-sqlite3';

// 0007 - 演员收藏星标：收藏的演员在演员页列表置顶。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('is_favorite')) {
    db.exec('ALTER TABLE actors ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(7);
}
