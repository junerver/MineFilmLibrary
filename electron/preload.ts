import { contextBridge, ipcRenderer } from 'electron';

const invoke = <T>(channel: string, ...args: any[]): Promise<T> => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mfl', {
  library: {
    list: (f: any) => invoke('library:list', f),
    get: (id: number) => invoke('library:get', id),
    create: (p: any) => invoke('library:create', p),
    update: (id: number, patch: any) => invoke('library:update', id, patch),
    softDelete: (id: number) => invoke('library:softDelete', id),
    hardDelete: (id: number) => invoke('library:hardDelete', id),
    restore: (id: number) => invoke('library:restore', id),
  },
  actors: {
    list: () => invoke('actors:list'),
    create: (name: string, raw?: string, cat?: string) => invoke('actors:create', name, raw, cat),
    update: (id: number, patch: any) => invoke('actors:update', id, patch),
    delete: (id: number) => invoke('actors:delete', id),
    films: (id: number) => invoke('actors:films', id),
  },
  genres: {
    list: () => invoke('genres:list'),
    create: (name: string) => invoke('genres:create', name),
    delete: (id: number) => invoke('genres:delete', id),
    allTags: () => invoke('genres:allTags'),
  },
  scanner: {
    listRoots: () => invoke('scanner:listRoots'),
    addRoot: (p: string, label?: string) => invoke('scanner:addRoot', p, label),
    removeRoot: (id: number) => invoke('scanner:removeRoot', id),
    runFull: (id: number) => invoke('scanner:runFull', id),
    runIncremental: (id: number) => invoke('scanner:runIncremental', id),
    listRuns: (limit = 50) => invoke('scanner:listRuns', limit),
    onProgress: (cb: (p: any) => void) => {
      const h = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('scanner:progress', h);
      return () => ipcRenderer.removeListener('scanner:progress', h);
    },
  },
  files: {
    listByFilm: (id: number) => invoke('files:listByFilm', id),
    openInFolder: (id: number) => invoke('files:openInFolder', id),
    restat: (id: number) => invoke('files:restat', id),
  },
  cover: {
    getCover: (id: number, opts: any) => invoke('cover:getCover', id, opts),
    upload: (id: number, fileName: string, base64: string) => invoke('cover:upload', id, fileName, base64),
    clear: (id: number) => invoke('cover:clear', id),
  },
  export: {
    csv: (filter: any) => invoke('export:csv', filter),
    json: (filter: any) => invoke('export:json', filter),
    sqlite: () => invoke('export:sqlite'),
    importSqlite: () => invoke('import:sqlite'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (k: string, v: string) => invoke('settings:set', k, v),
  },
});
