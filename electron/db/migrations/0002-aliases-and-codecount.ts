import type Database from 'better-sqlite3';

// 0002 — 演员别名表 + 影片编号重复计数字段。
// - actor_aliases(alias -> actor_id)：让同一演员的多个目录名归并到同一行。
//   alias 作 PK 以保证唯一；actor 外键级联删除（演员被删时别名一起消失）。
// - films.code_count：每次扫描后由 recomputeCodeCounts 重算，'library:list' 直接带出供列表显示徽标。
//   用 ALTER TABLE ADD COLUMN DEFAULT 不重写行；老库同样适用。
export function up(db: Database.Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS actor_aliases (
  alias TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  FOREIGN KEY(actor_id) REFERENCES actors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_actor_aliases_actor ON actor_aliases(actor_id);
`);
  // ALTER TABLE ADD COLUMN 在列已存在时直接抛错；这里手动探测，让迁移可重入。
  const cols = db.prepare('PRAGMA table_info(films)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'code_count')) {
    db.exec('ALTER TABLE films ADD COLUMN code_count INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(2);
}
