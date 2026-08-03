import type * as T from './types';

declare global {
  interface Window { mfl: MflApi; }
}

export interface MflApi {
  library: {
    list(f: T.FilmFilter): Promise<T.ListResult<T.FilmRow>>;
    get(id: number): Promise<T.FilmDetail | null>;
    create(p: any): Promise<number>;
    update(id: number, patch: any): Promise<boolean>;
    softDelete(id: number): Promise<boolean>;
    hardDelete(id: number): Promise<boolean>;
    restore(id: number): Promise<boolean>;
    setFavorite(id: number, favorite: boolean): Promise<boolean>;
  };
  actors: {
    list(): Promise<T.ActorRow[]>;
    create(name: string, raw?: string, cat?: string, notes?: string): Promise<number>;
    update(id: number, patch: Partial<Pick<T.ActorRow,
      'name' | 'category' | 'notes' | 'javbus_url' | 'avatar_url' | 'birthday' | 'age' | 'height'
      | 'cup' | 'bust' | 'waist' | 'hips' | 'measurements' | 'hobby'>>): Promise<boolean>;
    delete(id: number): Promise<boolean>;
    setFavorite(id: number, favorite: boolean): Promise<boolean>;
    films(id: number): Promise<T.FilmRow[]>;
    getJavbusData(id: number): Promise<T.ActorJavbusData | null>;
    scrapeJavbus(id: number): Promise<T.ActorJavbusData & { scrapedAt: number }>;
    openExternal(url: string): Promise<boolean>;
    quickFind(q: string): Promise<{ id: number; name: string }[]>;
    /** 内置库精确/别名候选匹配 */
    lookupBuiltin(name: string, extraCandidates?: string[]): Promise<T.ActressLookupResult | null>;
    searchBuiltin(term: string, limit?: number): Promise<T.ActressLookupResult[]>;
    /** 对已有演员静默补全空主页/头像，返回是否写库 */
    fillFromBuiltin(id: number): Promise<boolean>;
    listAliases(id: number): Promise<string[]>;
    addAlias(id: number, alias: string): Promise<boolean>;
    removeAlias(alias: string): Promise<boolean>;
    merge(fromId: number, toId: number): Promise<boolean>;
    /** 演员 → 标签：把演员名加到其全部影片作为标签，再删除演员条目；返回受影响影片数 */
    convertToTag(id: number): Promise<number>;
    /** 演员 → 厂商：把演员名写入其全部影片的 studio/label（单值列，会覆盖），再删除演员；返回受影响影片数 */
    convertToStudio(id: number, role: 'studio' | 'label'): Promise<number>;
  };
  genres: {
    list(): Promise<T.GenreRow[]>;
    create(name: string): Promise<number>;
    delete(id: number): Promise<boolean>;
    allTags(): Promise<{ tag: string; count: number }[]>;
  };
  tags: {
    films(tag: string): Promise<T.FilmRow[]>;
    rename(from: string, to: string): Promise<boolean>;
    merge(from: string, to: string): Promise<boolean>;
    remove(tag: string): Promise<boolean>;
  };
  studios: {
    list(): Promise<T.StudioAggRow[]>;
    films(name: string, role: 'studio' | 'label' | 'any'): Promise<T.FilmRow[]>;
    rename(from: string, to: string, role: 'studio' | 'label'): Promise<boolean>;
    remove(name: string, role: 'studio' | 'label'): Promise<boolean>;
  };
  scanner: {
    listRoots(): Promise<T.ScanRootRow[]>;
    addRoot(path: string, label?: string): Promise<{ ok: boolean; id?: number; error?: string }>;
    removeRoot(id: number): Promise<boolean>;
    runFull(id: number): Promise<{ ok: boolean; stats?: any; error?: string }>;
    runIncremental(id: number): Promise<{ ok: boolean; stats?: any; error?: string }>;
    listRuns(limit?: number): Promise<T.ScanRunRow[]>;
    clearHistory(): Promise<boolean>;
    onProgress(cb: (p: T.ScanProgressEvent) => void): () => void;
  };
  files: {
    listByFilm(id: number): Promise<T.FilmFileRow[]>;
    pathStatus(id: number): Promise<T.FilmPathStatus>;
    openInFolder(id: number): Promise<boolean>;
    restat(id: number): Promise<boolean>;
    renameFilmDir(id: number, newName: string): Promise<T.FileOpResult>;
    renameParentDir(id: number, newName: string): Promise<T.FileOpResult>;
    deleteFile(filmId: number, fileId: number): Promise<T.FileOpResult>;
  };
  cover: {
    getCover(id: number, opts?: { display?: boolean; rel_path?: string }): Promise<T.CoverResult | null>;
    listImages(id: number): Promise<{ images: { rel_path: string; name: string }[]; cover_path: string | null }>;
    upload(id: number, fileName: string, base64: string): Promise<number>;
    clear(id: number): Promise<boolean>;
  };
  export: {
    csv(filter: { include_deleted?: boolean }): Promise<{ ok: boolean; path?: string }>;
    json(filter: { include_deleted?: boolean }): Promise<{ ok: boolean; path?: string }>;
    sqlite(): Promise<{ ok: boolean; path?: string }>;
    importSqlite(): Promise<{ ok: boolean; backupPath?: string }>;
  };
  settings: {
    get(): Promise<Record<string, string>>;
    set(key: string, value: string): Promise<boolean>;
  };
  scrape: {
    javbus(filmId: number): Promise<T.ScrapeResult>;
    javbusBatch(filmIds: number[], concurrency?: number): Promise<T.BatchScrapeProgress>;
    cancelBatch(): Promise<{ ok: boolean; message?: string }>;
    getBatchStatus(): Promise<T.BatchScrapeProgress>;
    openLogDir(): Promise<{ ok: boolean; path?: string; error?: string; currentFile?: string | null }>;
    getLogPath(): Promise<{ dir: string | null; file: string | null }>;
    onProgress(cb: (p: T.ScrapeProgressEvent) => void): () => void;
    onBatchProgress(cb: (p: T.BatchScrapeProgress) => void): () => void;
  };
}

export const api: MflApi = (typeof window !== 'undefined' && (window as any).mfl) ? (window as any).mfl : (undefined as any as MflApi);
export default api;
