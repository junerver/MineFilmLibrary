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
  };
  actors: {
    list(): Promise<T.ActorRow[]>;
    create(name: string, raw?: string, cat?: string): Promise<number>;
    update(id: number, patch: { name?: string; category?: string }): Promise<boolean>;
    delete(id: number): Promise<boolean>;
    films(id: number): Promise<T.FilmRow[]>;
  };
  genres: {
    list(): Promise<T.GenreRow[]>;
    create(name: string): Promise<number>;
    delete(id: number): Promise<boolean>;
    allTags(): Promise<{ tag: string; count: number }[]>;
  };
  scanner: {
    listRoots(): Promise<T.ScanRootRow[]>;
    addRoot(path: string, label?: string): Promise<{ ok: boolean; id?: number; error?: string }>;
    removeRoot(id: number): Promise<boolean>;
    runFull(id: number): Promise<{ ok: boolean; stats?: any; error?: string }>;
    runIncremental(id: number): Promise<{ ok: boolean; stats?: any; error?: string }>;
    listRuns(limit?: number): Promise<T.ScanRunRow[]>;
    onProgress(cb: (p: any) => void): () => void;
  };
  files: {
    listByFilm(id: number): Promise<T.FilmFileRow[]>;
    openInFolder(id: number): Promise<boolean>;
    restat(id: number): Promise<boolean>;
  };
  cover: {
    getCover(id: number, opts?: { display?: boolean }): Promise<T.CoverResult | null>;
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
}

export const api: MflApi = (typeof window !== 'undefined' && (window as any).mfl) ? (window as any).mfl : (undefined as any as MflApi);
export default api;
