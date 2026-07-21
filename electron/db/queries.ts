import type Database from 'better-sqlite3';
import { nowMs } from './dao';

export function upsertActorByName(db: Database.Database, name: string, rawDirName: string): number {
  const now = nowMs();
  const existing = db.prepare('SELECT id FROM actors WHERE name=?').get(name) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE actors SET raw_dir_name=?, updated_at=? WHERE id=?').run(rawDirName, now, existing.id);
    return existing.id;
  }
  const r = db.prepare('INSERT INTO actors(name, raw_dir_name, created_at, updated_at) VALUES(?,?,?,?)').run(name, rawDirName, now, now);
  return Number(r.lastInsertRowid);
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

export function listAllFilmPaths(db: Database.Database, rootLike: string): { id: number; abs_path: string; fs_mtime_ms: number }[] {
  const rows = db.prepare("SELECT id, abs_path, fs_mtime_ms FROM films WHERE abs_path LIKE ? AND is_deleted=0").all(`${rootLike}%`) as any[];
  return rows;
}

export function markSoftDeleted(db: Database.Database, ids: number[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE films SET is_deleted=1, updated_at=? WHERE id IN (${placeholders})`).run(nowMs(), ...ids);
}
