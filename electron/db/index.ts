import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { up as migration0001 } from './migrations/0001-init';

let db: Database.Database | null = null;

function getAppUserDataPath(): string {
  // Lazy require to avoid requiring the `electron` module at load time.
  // Under vitest (a plain Node context, not the Electron runtime),
  // a top-level `import { app } from 'electron'` would throw because
  // the electron module only resolves inside the Electron host process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron');
  return electron.app.getPath('userData');
}

export function getDbPath(): string {
  const dir = getAppUserDataPath();
  return path.join(dir, 'minefilm.sqlite');
}

export function openDb(dbPath?: string): Database.Database {
  const target = dbPath ?? getDbPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instance = new Database(target);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  let current: { version: number } | undefined;
  try {
    current = instance.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
  } catch {
    current = undefined; // brand-new db, schema_version table doesn't exist yet
  }
  if (!current || current.version < 1) migration0001(instance);
  return instance;
}

export function getDb(): Database.Database {
  if (!db) db = openDb();
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

/** 测试用：在任意路径打开临时 DB。 */
export function openDbForTest(target: string): Database.Database {
  const instance = new Database(target);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migration0001(instance);
  return instance;
}
