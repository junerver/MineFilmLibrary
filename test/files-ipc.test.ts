// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => {
  const trashItem = vi.fn(async (_p?: string) => {});
  return {
    handlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
    getDb: vi.fn(),
    trashItem,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  shell: {
    openPath: vi.fn(async () => ''),
    trashItem: (p: string) => (mocks.trashItem as any)(p),
  },
}));

vi.mock('../electron/db', async () => {
  const actual = await vi.importActual<typeof import('../electron/db')>('../electron/db');
  return { ...actual, getDb: mocks.getDb };
});

import { openDbForTest } from '../electron/db';
import { registerFileIpc } from '../electron/ipc/files';

let tmp = '';
let db: Database.Database;
let mediaRoot = '';

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

function invoke<T>(channel: string, ...args: any[]): Promise<T> {
  const h = mocks.handlers.get(channel);
  if (!h) throw new Error(`no handler ${channel}`);
  return Promise.resolve(h({}, ...args) as T);
}

function insertFilm(absPath: string, parentDirName: string, rawDirName: string) {
  const now = Date.now();
  const r = db.prepare(`INSERT INTO films(
    code, title, raw_dir_name, abs_path, parent_dir_name, scan_status,
    fs_mtime_ms, is_deleted, created_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    'AAA-1',
    'Title',
    rawDirName,
    absPath,
    parentDirName,
    'parsed',
    now,
    0,
    now,
    now,
  );
  return Number(r.lastInsertRowid);
}

function insertFile(filmId: number, absPath: string, name: string) {
  const now = Date.now();
  const r = db.prepare(`INSERT INTO film_files(
    film_id, rel_path, abs_path, name, ext, size, is_video, is_image, mtime_ms, created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    filmId,
    name,
    absPath,
    name,
    path.extname(name),
    10,
    name.endsWith('.mp4') ? 1 : 0,
    name.endsWith('.jpg') ? 1 : 0,
    now,
    now,
  );
  return Number(r.lastInsertRowid);
}

beforeAll(() => {
  registerFileIpc();
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-files-ipc-'));
  mediaRoot = path.join(tmp, 'media');
  fs.mkdirSync(mediaRoot, { recursive: true });
  db = openDbForTest(path.join(tmp, 'test.sqlite'));
  mocks.getDb.mockReturnValue(db);
  mocks.trashItem.mockClear();
});

afterEach(() => {
  db.close();
  mocks.getDb.mockReset();
  rmSyncRetry(tmp);
});

describe('files:renameFilmDir', () => {
  it('renames film directory on disk and rewrites film/file paths', async () => {
    const parent = path.join(mediaRoot, '0-Actor');
    const filmDir = path.join(parent, 'AAA-1 Old');
    fs.mkdirSync(filmDir, { recursive: true });
    const cover = path.join(filmDir, 'cover.jpg');
    fs.writeFileSync(cover, 'x');

    const filmId = insertFilm(filmDir, '0-Actor', 'AAA-1 Old');
    insertFile(filmId, cover, 'cover.jpg');

    const result = await invoke<{ ok: boolean; filmAbsPath?: string; error?: string }>(
      'files:renameFilmDir',
      filmId,
      'AAA-1 New',
    );
    expect(result.ok).toBe(true);

    const nextFilm = path.join(parent, 'AAA-1 New');
    expect(fs.existsSync(nextFilm)).toBe(true);
    expect(fs.existsSync(filmDir)).toBe(false);

    const row = db.prepare('SELECT abs_path, raw_dir_name, parent_dir_name FROM films WHERE id=?').get(filmId) as any;
    expect(row.abs_path).toBe(nextFilm);
    expect(row.raw_dir_name).toBe('AAA-1 New');
    expect(row.parent_dir_name).toBe('0-Actor');

    const file = db.prepare('SELECT abs_path FROM film_files WHERE film_id=?').get(filmId) as any;
    expect(file.abs_path).toBe(path.join(nextFilm, 'cover.jpg'));
  });
});

describe('files:renameParentDir', () => {
  it('renames parent and rewrites all sibling film paths under that parent', async () => {
    const parent = path.join(mediaRoot, '0-Actor');
    const filmA = path.join(parent, 'AAA-1');
    const filmB = path.join(parent, 'BBB-2');
    fs.mkdirSync(filmA, { recursive: true });
    fs.mkdirSync(filmB, { recursive: true });
    const coverA = path.join(filmA, 'a.jpg');
    fs.writeFileSync(coverA, 'a');

    // 无关父目录，不应被改
    const other = path.join(mediaRoot, '1-Other', 'CCC-3');
    fs.mkdirSync(other, { recursive: true });

    const idA = insertFilm(filmA, '0-Actor', 'AAA-1');
    const idB = insertFilm(filmB, '0-Actor', 'BBB-2');
    const idC = insertFilm(other, '1-Other', 'CCC-3');
    insertFile(idA, coverA, 'a.jpg');

    const result = await invoke<{ ok: boolean; updatedFilms?: number; error?: string }>(
      'files:renameParentDir',
      idA,
      '0-Actor-Renamed',
    );
    expect(result.ok).toBe(true);
    expect(result.updatedFilms).toBe(2);

    const newParent = path.join(mediaRoot, '0-Actor-Renamed');
    expect(fs.existsSync(newParent)).toBe(true);
    expect(fs.existsSync(parent)).toBe(false);

    const a = db.prepare('SELECT abs_path, parent_dir_name FROM films WHERE id=?').get(idA) as any;
    const b = db.prepare('SELECT abs_path, parent_dir_name FROM films WHERE id=?').get(idB) as any;
    const c = db.prepare('SELECT abs_path, parent_dir_name FROM films WHERE id=?').get(idC) as any;
    expect(a.parent_dir_name).toBe('0-Actor-Renamed');
    expect(b.parent_dir_name).toBe('0-Actor-Renamed');
    expect(a.abs_path).toBe(path.join(newParent, 'AAA-1'));
    expect(b.abs_path).toBe(path.join(newParent, 'BBB-2'));
    expect(c.abs_path).toBe(other);
    expect(c.parent_dir_name).toBe('1-Other');

    const file = db.prepare('SELECT abs_path FROM film_files WHERE film_id=?').get(idA) as any;
    expect(file.abs_path).toBe(path.join(newParent, 'AAA-1', 'a.jpg'));
  });
});

describe('files:deleteFile', () => {
  it('trashes file and removes film_files row', async () => {
    const filmDir = path.join(mediaRoot, 'flat', 'AAA-1');
    fs.mkdirSync(filmDir, { recursive: true });
    const video = path.join(filmDir, 'clip.mp4');
    fs.writeFileSync(video, 'v');

    const filmId = insertFilm(filmDir, 'flat', 'AAA-1');
    const fileId = insertFile(filmId, video, 'clip.mp4');

    mocks.trashItem.mockImplementation(async (p?: string): Promise<void> => {
      if (p) fs.rmSync(p, { force: true });
    });

    const result = await invoke<{ ok: boolean; error?: string }>('files:deleteFile', filmId, fileId);
    expect(result.ok).toBe(true);
    expect(mocks.trashItem).toHaveBeenCalledWith(path.resolve(video));
    expect(fs.existsSync(video)).toBe(false);
    const n = (db.prepare('SELECT COUNT(*) n FROM film_files WHERE id=?').get(fileId) as any).n;
    expect(n).toBe(0);
  });

  it('rejects files outside film directory', async () => {
    const filmDir = path.join(mediaRoot, 'flat', 'AAA-1');
    fs.mkdirSync(filmDir, { recursive: true });
    const outside = path.join(mediaRoot, 'secret.txt');
    fs.writeFileSync(outside, 'x');

    const filmId = insertFilm(filmDir, 'flat', 'AAA-1');
    const fileId = insertFile(filmId, outside, 'secret.txt');

    const result = await invoke<{ ok: boolean; error?: string }>('files:deleteFile', filmId, fileId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/影片目录内/);
    expect(mocks.trashItem).not.toHaveBeenCalled();
    expect(fs.existsSync(outside)).toBe(true);
  });
});
