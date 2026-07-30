// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import {
  upsertActorByName,
  addActorAlias,
  applyBuiltinActressToActor,
  listActorAliases,
} from '../electron/db/queries';
import {
  lookupActress,
  lookupActressByCandidates,
  clearActressLookupCache,
} from '../electron/data/actorLookup';

let tmp = '';
let dbPath = '';
const opened: import('better-sqlite3').Database[] = [];

function openTracked(target: string) {
  const db = openDbForTest(target);
  opened.push(db);
  return db;
}

function rmSyncRetry(target: string) {
  let lastErr: unknown;
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  throw lastErr;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-lookup-'));
  dbPath = path.join(tmp, 't.sqlite');
  opened.length = 0;
  clearActressLookupCache();
});

afterEach(() => {
  for (const db of opened) {
    try { db.close(); } catch { /* ignore */ }
  }
  opened.length = 0;
  clearActressLookupCache();
  if (fs.existsSync(tmp)) rmSyncRetry(tmp);
});

describe('builtin actress lookup', () => {
  it('loads actresses_raw.json and finds by exact name', () => {
    // 文件很大，只验证能加载并命中一条已知样例（若文件缺失则跳过）
    const hit = lookupActress('織田真子');
    if (!hit) {
      // 开发机若未放 raw 文件则跳过，不 fail CI 路径以外场景
      console.warn('actresses_raw.json 未命中样例，跳过精确匹配断言');
      return;
    }
    expect(hit.url).toMatch(/\/star\//);
    expect(hit.avatar).toMatch(/actress/);
  });

  it('lookupActressByCandidates matches alias candidate', () => {
    const hit = lookupActressByCandidates(['不存在的名字XYZ', '織田真子']);
    if (!hit) {
      console.warn('actresses_raw.json 未命中样例，跳过 candidates 断言');
      return;
    }
    expect(hit.name).toBe('織田真子');
  });
});

describe('applyBuiltinActressToActor', () => {
  it('fills empty javbus_url/avatar_url from builtin via name', () => {
    const db = openTracked(dbPath);
    const sample = lookupActress('織田真子');
    if (!sample) {
      console.warn('无内置样例，跳过 applyBuiltin 断言');
      return;
    }
    const now = Date.now();
    const r = db.prepare(
      'INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)',
    ).run('織田真子', '0-織田真子', now, now);
    const id = Number(r.lastInsertRowid);
    expect(applyBuiltinActressToActor(db, id)).toBe(true);
    const row = db.prepare('SELECT javbus_url, avatar_url FROM actors WHERE id=?').get(id) as {
      javbus_url: string | null; avatar_url: string | null;
    };
    expect(row.javbus_url).toBe(sample.url);
    expect(row.avatar_url).toBe(sample.avatar);
    // 再次调用不覆盖、不重复写
    expect(applyBuiltinActressToActor(db, id)).toBe(false);
  });

  it('matches via alias when canonical name is not in builtin', () => {
    const sample = lookupActress('織田真子');
    if (!sample) {
      console.warn('无内置样例，跳过 alias 匹配断言');
      return;
    }
    const db = openTracked(dbPath);
    const now = Date.now();
    // 正式名用本地中文，别名用 JSON 里的日文名
    const r = db.prepare(
      'INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)',
    ).run('织田真子-本地', '0-本地', now, now);
    const id = Number(r.lastInsertRowid);
    expect(addActorAlias(db, id, '織田真子')).toBe(true);
    // addAlias 会 schedule 异步 fill；这里同步再跑一次验证别名路径
    expect(applyBuiltinActressToActor(db, id)).toBe(true);
    const row = db.prepare('SELECT javbus_url, avatar_url FROM actors WHERE id=?').get(id) as {
      javbus_url: string | null; avatar_url: string | null;
    };
    expect(row.javbus_url).toBe(sample.url);
    expect(listActorAliases(db, id)).toContain('織田真子');
  });

  it('does not overwrite existing javbus_url', () => {
    const sample = lookupActress('織田真子');
    if (!sample) return;
    const db = openTracked(dbPath);
    const now = Date.now();
    const r = db.prepare(
      'INSERT INTO actors(name, raw_dir_name, javbus_url, created_at, updated_at) VALUES(?,?,?,?,?)',
    ).run('織田真子', '0-x', 'https://example.com/custom', now, now);
    const id = Number(r.lastInsertRowid);
    applyBuiltinActressToActor(db, id);
    const row = db.prepare('SELECT javbus_url, avatar_url FROM actors WHERE id=?').get(id) as {
      javbus_url: string | null; avatar_url: string | null;
    };
    expect(row.javbus_url).toBe('https://example.com/custom');
    // 头像仍可补
    expect(row.avatar_url).toBe(sample.avatar);
  });

  it('upsertActorByName schedules fill without blocking insert', () => {
    const db = openTracked(dbPath);
    const id = upsertActorByName(db, '某新演员-不在库', '0-某新演员');
    expect(id).toBeGreaterThan(0);
    const row = db.prepare('SELECT name FROM actors WHERE id=?').get(id) as { name: string };
    expect(row.name).toBe('某新演员-不在库');
  });
});
