import type Database from 'better-sqlite3';

// 0006 - 将 JavBus 演员主页的常用资料提升为可查询的演员元数据字段。
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  const names = new Set(cols.map(c => c.name));
  const additions: [string, string][] = [
    ['birthday', 'TEXT'],
    ['age', 'TEXT'],
    ['height', 'TEXT'],
    ['cup', 'TEXT'],
    ['bust', 'TEXT'],
    ['waist', 'TEXT'],
    ['hips', 'TEXT'],
    ['measurements', 'TEXT'],
    ['hobby', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!names.has(name)) db.exec(`ALTER TABLE actors ADD COLUMN ${name} ${type}`);
  }
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(6);
}
