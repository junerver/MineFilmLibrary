import type Database from 'better-sqlite3';

// 0003 — 演员备注。
// actors 表原本只有 name/raw_dir_name/category；用户需要在演员页编辑演员元数据，
// 缺一个 notes 字段存放自由备注（例如"本名 / 出道年代 / 偏好题材"等）。
// ADD COLUMN DEFAULT NULL 不重写现有行，老库升级同样安全。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'notes')) {
    db.exec('ALTER TABLE actors ADD COLUMN notes TEXT');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(3);
}
