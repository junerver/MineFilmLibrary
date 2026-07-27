import type Database from 'better-sqlite3';

// 0008 - 影片收藏星标：可在影片库筛选「已收藏」。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('is_favorite')) {
    db.exec('ALTER TABLE films ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(8);
}
