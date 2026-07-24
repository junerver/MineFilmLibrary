import type Database from 'better-sqlite3';
import path from 'node:path';
import { nowMs, tx } from './dao';

/**
 * 解析演员名 → canonical actor_id（不新建）。
 * 命中顺序：
 *   1) actor_aliases 精确匹配（trim 后）
 *   2) actor_aliases 大小写不敏感（ASCII 别名）
 *   3) actors.name 精确
 *   4) actors.name 大小写不敏感
 * 刮削到别名 B 时应归到配置了别名 B 的演员 A，而不是再插一条 B。
 */
export function resolveActorIdByName(db: Database.Database, rawName: string): number | null {
  const name = (rawName ?? '').trim();
  if (!name) return null;

  const aliasExact = db.prepare('SELECT actor_id FROM actor_aliases WHERE alias=?').get(name) as { actor_id: number } | undefined;
  if (aliasExact) return aliasExact.actor_id;

  const aliasCi = db.prepare('SELECT actor_id FROM actor_aliases WHERE lower(alias)=lower(?)').get(name) as { actor_id: number } | undefined;
  if (aliasCi) return aliasCi.actor_id;

  const byName = db.prepare('SELECT id FROM actors WHERE name=?').get(name) as { id: number } | undefined;
  if (byName) return byName.id;

  const byNameCi = db.prepare('SELECT id FROM actors WHERE lower(name)=lower(?)').get(name) as { id: number } | undefined;
  if (byNameCi) return byNameCi.id;

  return null;
}

/**
 * 通过演员名 upsert，并把 alias 表纳入解析链：
 *   1) resolveActorIdByName（别名 / 正式名）→ 返回 canonical id，不新建。
 *   2) 否则 INSERT 新演员。
 * 不主动把 rawDirName 写入 aliases——别名只能由用户在 UI 显式添加。
 * 命中别名时不覆盖 canonical 的 raw_dir_name（避免别名字符串污染目录字段）。
 */
export function upsertActorByName(db: Database.Database, name: string, rawDirName: string): number {
  const now = nowMs();
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('演员名为空');

  const resolved = resolveActorIdByName(db, trimmed);
  if (resolved != null) {
    // 仅当 rawDirName 与正式名一致时才更新 raw_dir_name（扫描目录场景）；
    // 刮削传入的别名字符串不要写进 raw_dir_name。
    const actor = db.prepare('SELECT name FROM actors WHERE id=?').get(resolved) as { name: string } | undefined;
    if (actor && rawDirName && (rawDirName === actor.name || rawDirName === trimmed)) {
      db.prepare('UPDATE actors SET updated_at=? WHERE id=?').run(now, resolved);
    } else {
      db.prepare('UPDATE actors SET updated_at=? WHERE id=?').run(now, resolved);
    }
    return resolved;
  }

  const r = db.prepare('INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)')
    .run(trimmed, rawDirName || trimmed, now, now);
  return Number(r.lastInsertRowid);
}

/** 添加别名；若 alias 已被占用（指向别人或自己），返回 false。 */
export function addActorAlias(db: Database.Database, actorId: number, alias: string): boolean {
  const trimmed = alias.trim();
  if (!trimmed) return false;
  // actor_aliases.alias 作 PK，INSERT OR IGNORE 在冲突时静默不插；用 changes 判定是否成功。
  const info = db.prepare('INSERT OR IGNORE INTO actor_aliases(alias, actor_id) VALUES(?,?)').run(trimmed, actorId);
  return info.changes > 0;
}

export function listActorAliases(db: Database.Database, actorId: number): string[] {
  const rows = db.prepare('SELECT alias FROM actor_aliases WHERE actor_id=? ORDER BY alias').all(actorId) as { alias: string }[];
  return rows.map(r => r.alias);
}

export function removeActorAlias(db: Database.Database, alias: string): boolean {
  const info = db.prepare('DELETE FROM actor_aliases WHERE alias=?').run(alias);
  return info.changes > 0;
}

/**
 * 把 fromId 这个演员合并到 toId：
 *  - film_actors：fromId → toId（INSERT OR IGNORE 避免和现有 PK 冲突；剩下的 from 旧引用会随 actors 删除级联消失）。
 *  - actor_aliases：alias 也切到 toId；违反 PK 时跳过。
 *  - 最后 DELETE actors WHERE id=fromId（其残余的 film_actors 行随级联删除消失）。
 * 整个在事务内，from==to 时直接返回。
 */
/**
 * 合并演员：from → to。
 * - 影片关联迁到 to
 * - from 的别名迁到 to
 * - **from 的 name 本身也记为 to 的别名**（中文名 / 假名 / 英文名互并时，扫描与刮削才能继续命中）
 * - 删除 from 行
 */
export function mergeActors(db: Database.Database, fromId: number, toId: number): void {
  if (fromId === toId) return;
  tx(db, () => {
    const from = db.prepare('SELECT id, name, raw_dir_name, is_favorite FROM actors WHERE id=?').get(fromId) as
      { id: number; name: string; raw_dir_name: string | null; is_favorite: number } | undefined;
    const to = db.prepare('SELECT id, name, is_favorite FROM actors WHERE id=?').get(toId) as
      { id: number; name: string; is_favorite: number } | undefined;
    if (!from || !to) throw new Error('演员不存在，无法合并');

    // 把 fromId 的影片搬到 toId；已存在的对儿忽略。
    const fromFilms = db.prepare('SELECT film_id FROM film_actors WHERE actor_id=?').all(fromId) as { film_id: number }[];
    const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
    for (const f of fromFilms) ins.run(f.film_id, toId);

    const moveAlias = db.prepare('INSERT OR IGNORE INTO actor_aliases(alias, actor_id) VALUES(?,?)');
    // from 的正式名 → 成为 to 的别名（同名则跳过）
    if (from.name && from.name !== to.name) {
      moveAlias.run(from.name, toId);
    }
    // raw_dir_name 若与 name 不同也记一笔（目录名变体）
    if (from.raw_dir_name) {
      const raw = from.raw_dir_name.replace(/^\d+-/, '').trim();
      if (raw && raw !== to.name && raw !== from.name) moveAlias.run(raw, toId);
    }

    // 别名也搬过去；alias 是 PK，冲突则跳过。
    const aliases = db.prepare('SELECT alias FROM actor_aliases WHERE actor_id=?').all(fromId) as { alias: string }[];
    for (const a of aliases) {
      if (a.alias === to.name) {
        db.prepare('DELETE FROM actor_aliases WHERE alias=? AND actor_id=?').run(a.alias, fromId);
        continue;
      }
      const info = moveAlias.run(a.alias, toId);
      if (info.changes > 0) db.prepare('DELETE FROM actor_aliases WHERE alias=? AND actor_id=?').run(a.alias, fromId);
    }

    // 任一收藏则目标保留收藏。
    const fav = Math.max(from.is_favorite ? 1 : 0, to.is_favorite ? 1 : 0);
    if (fav !== (to.is_favorite ? 1 : 0)) {
      db.prepare('UPDATE actors SET is_favorite=?, updated_at=? WHERE id=?').run(fav, nowMs(), toId);
    }

    // 删除 from；残余 film_actors / actor_aliases 随 ON DELETE CASCADE 清理。
    db.prepare('DELETE FROM actors WHERE id=?').run(fromId);
  });
}

/**
 * 重算每部未删除影片的 code_count（同 code 而且未删除的影片数量）。
 * 必须在扫描结束后调用一次，保证列表徽标反映最新重复情况。
 * code 为 NULL 的影片不计入（COUNT(*) 自动排除 NULL 分组即为 0）。
 */
export function recomputeCodeCounts(db: Database.Database): void {
  db.exec(`UPDATE films SET code_count = (
    SELECT COUNT(*) FROM films f2
    WHERE f2.code = films.code COLLATE NOCASE
      AND f2.is_deleted = 0
      AND f2.code IS NOT NULL
  )`);
}

/** 全库（包含回收站）是否已经存在同编号影片。编号按大小写不敏感比较。 */
export function filmCodeExists(db: Database.Database, code: string | null): boolean {
  if (!code) return false;
  return db.prepare('SELECT 1 FROM films WHERE code = ? COLLATE NOCASE LIMIT 1').get(code) != null;
}

export function upsertGenreByName(db: Database.Database, name: string): number {
  const now = nowMs();
  const existing = db.prepare('SELECT id FROM genres WHERE name=?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO genres(name, created_at) VALUES(?,?)').run(name, now);
  return Number(r.lastInsertRowid);
}

export function replaceFilmActors(db: Database.Database, filmId: number, actorIds: number[]) {
  db.prepare('DELETE FROM film_actors WHERE film_id=?').run(filmId);
  const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
  for (const a of actorIds) ins.run(filmId, a);
}

export function replaceFilmGenres(db: Database.Database, filmId: number, genreIds: number[]) {
  db.prepare('DELETE FROM film_genres WHERE film_id=?').run(filmId);
  const ins = db.prepare('INSERT OR IGNORE INTO film_genres(film_id, genre_id) VALUES(?,?)');
  for (const g of genreIds) ins.run(filmId, g);
}

export function replaceFilmTags(db: Database.Database, filmId: number, tags: string[]) {
  db.prepare('DELETE FROM film_tags WHERE film_id=?').run(filmId);
  const ins = db.prepare('INSERT OR IGNORE INTO film_tags(tag, film_id) VALUES(?,?)');
  for (const t of tags) ins.run(t, filmId);
}

export function replaceFilmFiles(db: Database.Database, filmId: number, files: { rel_path: string; abs_path: string; name: string; ext: string; size: number; is_video: number; is_image: number; mtime_ms: number }[]) {
  db.prepare('DELETE FROM film_files WHERE film_id=?').run(filmId);
  const ins = db.prepare(`INSERT INTO film_files(film_id, rel_path, abs_path, name, ext, size, is_video, is_image, mtime_ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const now = nowMs();
  for (const f of files) ins.run(filmId, f.rel_path, f.abs_path, f.name, f.ext, f.size, f.is_video, f.is_image, f.mtime_ms, now);
}

export function listActorsOfFilm(db: Database.Database, filmId: number): number[] {
  const rows = db.prepare('SELECT actor_id FROM film_actors WHERE film_id=?').all(filmId) as { actor_id: number }[];
  return rows.map(r => r.actor_id);
}

interface StoredFilmPath {
  id: number;
  abs_path: string;
  fs_mtime_ms: number;
  is_deleted: number;
  code: string | null;
  scraped_at: number | null;
  scan_status: string;
}

function rootPathQuery(rootLike: string) {
  // 只匹配根目录本身及其真正的子路径。单纯使用 `${rootLike}%` 会把
  // `D:\\media\\other` 的兄弟目录 `D:\\media\\other精品` 也纳入基线，
  // 随后在扫描 `other` 时被误判为缺失并软删除。
  const root = path.resolve(rootLike);
  const separator = path.sep;
  const descendantPrefix = root.endsWith(separator) ? root : `${root}${separator}`;
  // 使用独立的 ESCAPE 字符，避免根路径中的 `%` / `_` 被当成 LIKE 通配符。
  const escapeLike = (value: string) => value.replace(/[!%_]/g, ch => `!${ch}`);
  return { root, descendantPattern: `${escapeLike(descendantPrefix)}%` };
}

export function listAllFilmPaths(db: Database.Database, rootLike: string): StoredFilmPath[] {
  const { root, descendantPattern } = rootPathQuery(rootLike);
  const rows = db.prepare(`
    SELECT id, abs_path, fs_mtime_ms, is_deleted, code, scraped_at, scan_status
    FROM films
    WHERE abs_path = ? COLLATE NOCASE OR abs_path LIKE ? ESCAPE '!'
  `).all(root, descendantPattern) as StoredFilmPath[];
  return rows;
}

/**
 * 返回扫描根下可自动刮削的 canonical 影片。
 * 同编号只取全库最早入库的一条，与首次扫描的 initializeMetadata 语义一致。
 */
export function listPendingFilmScrapes(
  db: Database.Database,
  rootLike: string,
): { id: number; code: string; abs_path: string }[] {
  const { root, descendantPattern } = rootPathQuery(rootLike);
  return db.prepare(`
    SELECT f.id, f.code, f.abs_path
    FROM films f
    WHERE (f.abs_path = ? COLLATE NOCASE OR f.abs_path LIKE ? ESCAPE '!')
      AND f.is_deleted = 0
      AND f.scraped_at IS NULL
      AND f.code IS NOT NULL
      AND TRIM(f.code) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM films earlier
        WHERE earlier.id < f.id
          AND earlier.code = f.code COLLATE NOCASE
      )
    ORDER BY f.id
  `).all(root, descendantPattern) as { id: number; code: string; abs_path: string }[];
}

export function markSoftDeleted(db: Database.Database, ids: number[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE films SET is_deleted=1, updated_at=? WHERE id IN (${placeholders})`).run(nowMs(), ...ids);
}
