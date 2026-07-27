export type Locale = 'C' | 'U' | null;
export type ParentType = 'actor' | 'genre' | null;
export type ScanStatus = 'parsed' | 'partial' | 'unknown';
export type ScanMode = 'full' | 'incremental';
export type ScanRunStatus = 'running' | 'done' | 'error';

export interface FilmRow {
  id: number;
  code: string | null;
  title: string | null;
  raw_dir_name: string;
  abs_path: string;
  parent_dir_name: string;
  parent_type: ParentType;
  locale: Locale;
  cover_path: string | null;
  cover_blob_id: number | null;
  notes: string | null;
  scan_status: ScanStatus;
  fs_mtime_ms: number;
  is_deleted: number;
  code_count: number;
  /** 1 = 已收藏，0 = 普通 */
  is_favorite: number;
  /** 最近一次成功刮削时间戳（ms），null/undefined 表示未刮削 */
  scraped_at?: number | null;
  // 列表场景下附带：本片所有演员的名字，已用"、"拼好。详情页走 FilmDetail 自带 actors 数组。
  actors_names?: string;
  created_at: number;
  updated_at: number;
}

export interface ActorRow {
  id: number;
  name: string;
  raw_dir_name: string;
  category: string | null;
  notes: string | null;
  birthday: string | null;
  age: string | null;
  height: string | null;
  cup: string | null;
  bust: string | null;
  waist: string | null;
  hips: string | null;
  measurements: string | null;
  hobby: string | null;
  javbus_url: string | null;
  javbus_data_json: string | null;
  javbus_scraped_at: number | null;
  /** 1 = 收藏置顶，0 = 普通 */
  is_favorite: number;
  created_at: number;
  updated_at: number;
  aliases?: string[];
}
export interface GenreRow { id: number; name: string; created_at: number; }
export interface FilmFileRow { id: number; film_id: number; rel_path: string; abs_path: string; name: string; ext: string; size: number; is_video: number; is_image: number; mtime_ms: number; created_at: number; }
export interface ScanRootRow { id: number; path: string; label: string | null; last_full_scan_at: number | null; last_incremental_scan_at: number | null; enabled: number; }
export interface ScanRunRow { id: number; root_id: number; mode: ScanMode; started_at: number; finished_at: number | null; dir_seen: number; dir_added: number; dir_updated: number; dir_removed: number; status: ScanRunStatus; error_message: string | null; }

export interface ParsedDir {
  code: string | null;
  locale: Locale;
  tags: string[];
  title: string | null;
  scan_status: ScanStatus;
}

export interface ParsedParent {
  parent_type: ParentType;
  name: string | null;
}

export interface FilmFilter {
  q?: string;
  actors?: number[];
  genres?: number[];
  tags?: string[];
  locales?: string[];
  statuses?: ScanStatus[];
  root_ids?: number[];
  include_deleted?: boolean;
  duplicate_codes_only?: boolean;
  /** 仅显示已收藏影片 */
  favorites_only?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: 'code' | 'title' | 'updated_at' | 'fs_mtime_ms' | 'actors' | 'scraped_at';
  sort_dir?: 'asc' | 'desc';
}

export interface ListResult<T> { items: T[]; total: number; page: number; page_size: number; }
