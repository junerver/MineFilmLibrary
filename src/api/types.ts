export type Locale = 'C' | 'U' | null;
export type ParentType = 'actor' | 'genre' | null;
export type ScanStatus = 'parsed' | 'partial' | 'unknown';

export interface FilmRow {
  id: number; code: string | null; title: string | null; raw_dir_name: string; abs_path: string;
  parent_dir_name: string; parent_type: ParentType; locale: Locale; cover_path: string | null;
  cover_blob_id: number | null; notes: string | null; scan_status: ScanStatus;
  fs_mtime_ms: number; is_deleted: number; code_count: number;
  // 列表场景：演员名用"、"拼接。详情页用 FilmDetail.actors。
  actors_names?: string;
  created_at: number; updated_at: number;
}
export interface SameCodeFilm { id: number; abs_path: string; parent_dir_name: string; scan_status: ScanStatus; }
export interface FilmDetail extends FilmRow { actors: { id: number; name: string }[]; genres: { id: number; name: string }[]; tags: string[]; same_code_films: SameCodeFilm[]; }
export interface ActorRow { id: number; name: string; raw_dir_name: string; category: string | null; notes: string | null; film_count: number; aliases: string[]; created_at: number; updated_at: number; }
export interface FilmFilter {
  q?: string; actors?: number[]; genres?: number[]; tags?: string[]; locales?: string[];
  statuses?: ScanStatus[]; root_ids?: number[]; include_deleted?: boolean;
  page?: number; page_size?: number;
  sort_by?: 'code' | 'title' | 'updated_at' | 'fs_mtime_ms' | 'actors';
  sort_dir?: 'asc' | 'desc';
}
export interface ListResult<T> { items: T[]; total: number; page: number; page_size: number; }
export interface GenreRow { id: number; name: string; created_at: number; }
export interface FilmFileRow { id: number; film_id: number; rel_path: string; abs_path: string; name: string; ext: string; size: number; is_video: number; is_image: number; mtime_ms: number; created_at: number; }
export interface ScanRootRow { id: number; path: string; label: string | null; last_full_scan_at: number | null; last_incremental_scan_at: number | null; enabled: number; }
export interface ScanRunRow { id: number; root_id: number; mode: 'full'|'incremental'; started_at: number; finished_at: number|null; dir_seen: number; dir_added: number; dir_updated: number; dir_removed: number; status: 'running'|'done'|'error'; error_message: string|null; }
export interface CoverResult { kind: 'blob' | 'file'; mime: string; base64: string; }

// 扫描进度事件。stage='scan' 表示进行中；'done' / 'error' 是终止事件，前端据此清掉进度条。
// runId 用于把事件绑定到当前扫描任务（前端目前不区分，留着供后续多任务场景用）。
export interface ScanProgressEvent {
  runId?: number;
  stage: 'scan' | 'done' | 'error';
  current: number;
  total: number;
  currentPath: string;
  errorMessage?: string;
}

export interface ScrapeResult {
  ok: boolean;
  title: string;
  code: string;
  pageUrl: string;
  actresses: string[];
  genres: string[];
  samplesFound: number;
  samplesOk?: number;
  samplesFail?: number;
  samplesSkip?: number;
  filesWritten: string[];
  coverPath: string | null;
  dirExists: boolean;
  releaseDate?: string | null;
  studio?: string | null;
  logFile?: string | null;
}

/** 刮削进度事件（主进程 scrape:progress）。 */
export interface ScrapeProgressEvent {
  filmId: number;
  stage: 'start' | 'page' | 'cover' | 'samples' | 'meta' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

/** 批量刮削进度（主进程持有；切页面不丢）。 */
export interface BatchScrapeProgress {
  running: boolean;
  done: number;
  total: number;
  ok: number;
  fail: number;
  skip: number;
  active: string[];
  message: string;
  finished?: boolean;
  cancelled?: boolean;
}
