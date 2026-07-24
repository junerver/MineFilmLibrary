// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FilmFilter, FilmRow, ListResult } from '../electron/util/types';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
  getDb: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../electron/db', async () => {
  const actual = await vi.importActual<typeof import('../electron/db')>('../electron/db');
  return { ...actual, getDb: mocks.getDb };
});

import { openDbForTest } from '../electron/db';
import { recomputeCodeCounts } from '../electron/db/queries';
import { registerLibraryIpc } from '../electron/ipc/library';

let tmp = '';
let db: Database.Database;

function rmSyncRetry(target: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  throw lastError;
}

function addFilm(code: string, isDeleted = 0) {
  const now = Date.now();
  const suffix = `${code}-${Math.random()}`;
  db.prepare(`INSERT INTO films(
    code, title, raw_dir_name, abs_path, parent_dir_name, scan_status,
    fs_mtime_ms, is_deleted, created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    code,
    code,
    suffix,
    path.join(tmp, suffix),
    '',
    'parsed',
    now,
    isDeleted,
    now,
    now,
  );
}

beforeAll(() => {
  registerLibraryIpc();
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-library-ipc-'));
  db = openDbForTest(path.join(tmp, 'test.sqlite'));
  mocks.getDb.mockReturnValue(db);
});

afterEach(() => {
  db.close();
  mocks.getDb.mockReset();
  rmSyncRetry(tmp);
});

describe('library:list duplicate code filter', () => {
  it('returns only active films whose case-insensitive code occurs more than once', () => {
    addFilm('ABC-001');
    addFilm('abc-001');
    addFilm('UNIQUE-002');
    addFilm('DELETED-003');
    addFilm('deleted-003', 1);
    recomputeCodeCounts(db);

    const list = mocks.handlers.get('library:list');
    expect(list).toBeDefined();
    const result = list?.({}, {
      duplicate_codes_only: true,
      page: 1,
      page_size: 50,
      sort_by: 'code',
      sort_dir: 'asc',
    } satisfies FilmFilter) as ListResult<FilmRow>;

    expect(result.total).toBe(2);
    expect(result.items.map(film => film.code?.toLowerCase())).toEqual(['abc-001', 'abc-001']);
  });
});
