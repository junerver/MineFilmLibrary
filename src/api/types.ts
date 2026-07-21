export type Locale = 'C' | 'U' | null;
export type ParentType = 'actor' | 'genre' | null;
export type ScanStatus = 'parsed' | 'partial' | 'unknown';

export interface FilmRow {
  id: number; code: string | null; title: string | null; raw_dir_name: string; abs_path: string;
  parent_dir_name: string; parent_type: ParentType; locale: Locale; cover_path: string | null;
  cover_blob_id: number | null; notes: string | null; scan_status: ScanStatus;
  fs_mtime_ms: number; is_deleted: number; created_at: number; updated_at: number;
}
export interface FilmDetail extends FilmRow { actors: { id: number; name: string }[]; genres: { id: number; name: string }[]; tags: string[]; }
export interface ActorRow { id: number; name: string; raw_dir_name: string; category: string | null; film_count: number; created_at: number; updated_at: number; }
export interface FilmFilter {
  q?: string; actors?: number[]; genres?: number[]; tags?: string[]; locales?: string[];
  statuses?: ScanStatus[]; root_ids?: number[]; include_deleted?: boolean;
  page?: number; page_size?: number;
  sort_by?: 'code' | 'title' | 'updated_at' | 'fs_mtime_ms';
  sort_dir?: 'asc' | 'desc';
}
export interface ListResult<T> { items: T[]; total: number; page: number; page_size: number; }
export interface GenreRow { id: number; name: string; created_at: number; }
export interface FilmFileRow { id: number; film_id: number; rel_path: string; abs_path: string; name: string; ext: string; size: number; is_video: number; is_image: number; mtime_ms: number; created_at: number; }
export interface ScanRootRow { id: number; path: string; label: string | null; last_full_scan_at: number | null; last_incremental_scan_at: number | null; enabled: number; }
export interface ScanRunRow { id: number; root_id: number; mode: 'full'|'incremental'; started_at: number; finished_at: number|null; dir_seen: number; dir_added: number; dir_updated: number; dir_removed: number; status: 'running'|'done'|'error'; error_message: string|null; }
export interface CoverResult { kind: 'blob' | 'file'; mime: string; base64: string; }
