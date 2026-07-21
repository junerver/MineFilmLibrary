import type Database from 'better-sqlite3';

export function tx<T>(db: Database.Database, fn: () => T): T {
  const t = db.transaction(fn);
  return t();
}

export function nowMs(): number { return Date.now(); }
