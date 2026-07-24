import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { up as migration0001 } from './migrations/0001-init';
import { up as migration0002 } from './migrations/0002-aliases-and-codecount';
import { up as migration0003 } from './migrations/0003-actor-notes';
import { up as migration0004 } from './migrations/0004-scraped-at';
import { up as migration0005 } from './migrations/0005-actor-javbus';
import { up as migration0006 } from './migrations/0006-actor-profile';
import { up as migration0007 } from './migrations/0007-actor-favorite';

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
  } catch (err: unknown) {
    // Only swallow the 'no such table' error expected on a brand-new DB.
    // Other errors (corruption, I/O) must propagate.
    const msg = String((err as { message?: string })?.message ?? err);
    if (!/no such table/i.test(msg)) throw err;
    current = undefined;
  }
  if (!current || current.version < 1) migration0001(instance);
  if (!current || current.version < 2) migration0002(instance);
  if (!current || current.version < 3) migration0003(instance);
  if (!current || current.version < 4) migration0004(instance);
  if (!current || current.version < 5) migration0005(instance);
  if (!current || current.version < 6) migration0006(instance);
  if (!current || current.version < 7) migration0007(instance);
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
  migration0002(instance);
  migration0003(instance);
  migration0004(instance);
  migration0005(instance);
  migration0006(instance);
  migration0007(instance);
  return instance;
}
