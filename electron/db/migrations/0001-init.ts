import type Database from 'better-sqlite3';

// Runtime DDL — inlined here so packaged builds don't need schema.sql on disk.
// The reference copy at electron/db/schema.sql is for documentation/dev only.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  raw_dir_name TEXT,
  category TEXT,
  birthday TEXT,
  age TEXT,
  height TEXT,
  cup TEXT,
  bust TEXT,
  waist TEXT,
  hips TEXT,
  measurements TEXT,
  hobby TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS films (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  title TEXT,
  raw_dir_name TEXT NOT NULL,
  abs_path TEXT UNIQUE NOT NULL,
  parent_dir_name TEXT NOT NULL,
  parent_type TEXT,
  locale TEXT,
  cover_path TEXT,
  cover_blob_id INTEGER,
  notes TEXT,
  scan_status TEXT NOT NULL,
  fs_mtime_ms INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (cover_blob_id) REFERENCES cover_blobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS film_actors (
  film_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  PRIMARY KEY (film_id, actor_id),
  FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS film_genres (
  film_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  PRIMARY KEY (film_id, genre_id),
  FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS film_tags (
  tag TEXT NOT NULL,
  film_id INTEGER NOT NULL,
  PRIMARY KEY (tag, film_id),
  FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS film_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  abs_path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT,
  size INTEGER NOT NULL,
  is_video INTEGER NOT NULL,
  is_image INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cover_blobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  label TEXT,
  last_full_scan_at INTEGER,
  last_incremental_scan_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  dir_seen INTEGER NOT NULL DEFAULT 0,
  dir_added INTEGER NOT NULL DEFAULT 0,
  dir_updated INTEGER NOT NULL DEFAULT 0,
  dir_removed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  FOREIGN KEY (root_id) REFERENCES scan_roots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_films_code ON films(code);
CREATE INDEX IF NOT EXISTS idx_films_parent ON films(parent_dir_name);
CREATE INDEX IF NOT EXISTS idx_films_status ON films(scan_status);
CREATE INDEX IF NOT EXISTS idx_films_deleted ON films(is_deleted);
CREATE INDEX IF NOT EXISTS idx_files_film ON film_files(film_id);
CREATE INDEX IF NOT EXISTS idx_fa_actor ON film_actors(actor_id);
CREATE INDEX IF NOT EXISTS idx_fg_genre ON film_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_ft_tag ON film_tags(tag);
`;

export function up(db: Database.Database) {
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(1);
}
