import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

function findSchemaPath(): string {
  // vitest: __dirname = electron/db/migrations/ (source)  -> ../schema.sql works
  // tsc-out: __dirname = dist-electron/db/migrations/      -> need relative to project root
  const candidates = [
    path.join(__dirname, '..', 'schema.sql'),          // source relative
    path.join(__dirname, '..', '..', '..', 'electron', 'db', 'schema.sql'),  // dist-electron/db/migrations -> project root/electron/db/schema.sql
    path.join(process.cwd(), 'electron', 'db', 'schema.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('schema.sql not found in any candidate location');
}

export function up(db: Database.Database) {
  const sql = fs.readFileSync(findSchemaPath(), 'utf8');
  db.exec(sql);
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(1);
}
