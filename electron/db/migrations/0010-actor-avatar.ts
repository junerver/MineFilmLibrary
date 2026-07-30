import type Database from 'better-sqlite3';

/**
 * 0010 - 为 actors 表添加 avatar_url 列,用于存储从内置演员库中匹配到的头像地址。
 */
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  if (!names.has('avatar_url')) db.exec('ALTER TABLE actors ADD COLUMN avatar_url TEXT');
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(10);
}