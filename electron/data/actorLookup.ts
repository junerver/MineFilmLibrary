/**
 * 内置演员库查询（actresses_raw.json，约 5 万条）。
 *
 * - 开发：项目根 actresses/actresses_raw.json
 * - 打包：extraResources → resources/actresses/actresses_raw.json
 * - 惰性加载 + Map 索引；不阻塞 UI（调用方用 setImmediate / 异步调度）
 * - 不在顶层 import electron，避免 vitest 加载失败
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ActressLookupResult {
  url: string;
  avatar: string;
  name: string;
}

interface ActressEntry {
  url: string;
  avatar: string;
  name: string;
}

let _list: ActressEntry[] | null = null;
/** lower(name) → 首条命中（同名取第一条） */
let _byLowerName: Map<string, ActressLookupResult> | null = null;

function getDataPath(): string {
  // Lazy require：测试环境没有 electron 宿主
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let isPackaged = false;
  try {
    const electron = require('electron');
    isPackaged = !!electron?.app?.isPackaged;
  } catch {
    isPackaged = false;
  }

  if (isPackaged) {
    return path.join(process.resourcesPath, 'actresses', 'actresses_raw.json');
  }
  // dist-electron/data → 项目根
  return path.resolve(__dirname, '..', '..', 'actresses', 'actresses_raw.json');
}

function ensureLoaded(): Map<string, ActressLookupResult> {
  if (_byLowerName) return _byLowerName;

  _byLowerName = new Map();
  _list = [];
  try {
    const raw = fs.readFileSync(getDataPath(), 'utf-8');
    const data = JSON.parse(raw) as ActressEntry[];
    if (!Array.isArray(data)) return _byLowerName;
    _list = data;
    for (const entry of data) {
      const name = String(entry?.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      // 同名保留第一条，避免覆盖
      if (_byLowerName.has(key)) continue;
      _byLowerName.set(key, {
        name,
        url: String(entry.url ?? '').trim(),
        avatar: String(entry.avatar ?? '').trim(),
      });
    }
  } catch (err) {
    // 缺文件或解析失败：空库，不抛给 UI
    console.warn('[actorLookup] 内置演员库加载失败:', (err as Error)?.message ?? err);
  }
  return _byLowerName;
}

/**
 * 按名称精确匹配（trim + 大小写不敏感）。
 */
export function lookupActress(name: string): ActressLookupResult | null {
  const q = (name ?? '').trim();
  if (!q) return null;
  return ensureLoaded().get(q.toLowerCase()) ?? null;
}

/**
 * 按多个候选名依次匹配（正式名 + 别名）。
 * 任一候选在 JSON 中命中即返回。
 */
export function lookupActressByCandidates(candidates: string[]): ActressLookupResult | null {
  const map = ensureLoaded();
  const seen = new Set<string>();
  for (const c of candidates) {
    const q = (c ?? '').trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = map.get(key);
    if (hit) return hit;
  }
  return null;
}

/**
 * 子串模糊搜索，最多 limit 条（自动补全用）。
 */
export function searchActress(term: string, limit = 10): ActressLookupResult[] {
  const q = (term ?? '').trim().toLowerCase();
  if (!q || limit <= 0) return [];
  ensureLoaded();
  const list = _list ?? [];
  const out: ActressLookupResult[] = [];
  for (const entry of list) {
    const name = String(entry?.name ?? '').trim();
    if (!name || !name.toLowerCase().includes(q)) continue;
    out.push({
      name,
      url: String(entry.url ?? '').trim(),
      avatar: String(entry.avatar ?? '').trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 测试用：清空缓存。 */
export function clearActressLookupCache() {
  _list = null;
  _byLowerName = null;
}
