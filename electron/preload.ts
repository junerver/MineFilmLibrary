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
    setFavorite: (id: number, favorite: boolean) => invoke('library:setFavorite', id, favorite),
    hasCodes: (codes: string[]) => invoke('library:hasCodes', codes),
  },
  actors: {
    list: () => invoke('actors:list'),
    create: (name: string, raw?: string, cat?: string, notes?: string) => invoke('actors:create', name, raw, cat, notes),
    update: (id: number, patch: any) => invoke('actors:update', id, patch),
    delete: (id: number) => invoke('actors:delete', id),
    setFavorite: (id: number, favorite: boolean) => invoke('actors:setFavorite', id, favorite),
    films: (id: number) => invoke('actors:films', id),
    getJavbusData: (id: number) => invoke('actors:getJavbusData', id),
    scrapeJavbus: (id: number) => invoke('actors:scrapeJavbus', id),
    scrapeMoreWorks: (id: number) => invoke('actors:scrapeMoreWorks', id),
    openExternal: (url: string) => invoke('actors:openExternal', url),
    quickFind: (q: string) => invoke('actors:quickFind', q),
    lookupBuiltin: (name: string, extra?: string[]) => invoke('actors:lookupBuiltin', name, extra),
    searchBuiltin: (term: string, limit?: number) => invoke('actors:searchBuiltin', term, limit),
    fillFromBuiltin: (id: number) => invoke('actors:fillFromBuiltin', id),
    listAliases: (id: number) => invoke('actors:listAliases', id),
    addAlias: (id: number, alias: string) => invoke('actors:addAlias', id, alias),
    removeAlias: (alias: string) => invoke('actors:removeAlias', alias),
    merge: (fromId: number, toId: number) => invoke('actors:merge', fromId, toId),
    convertToTag: (id: number) => invoke('actors:convertToTag', id),
    convertToStudio: (id: number, role: 'studio' | 'label') => invoke('actors:convertToStudio', id, role),
  },
  genres: {
    list: () => invoke('genres:list'),
    create: (name: string) => invoke('genres:create', name),
    delete: (id: number) => invoke('genres:delete', id),
    allTags: () => invoke('genres:allTags'),
  },
  tags: {
    films: (tag: string) => invoke('tags:films', tag),
    rename: (from: string, to: string) => invoke('tags:rename', from, to),
    merge: (from: string, to: string) => invoke('tags:merge', from, to),
    remove: (tag: string) => invoke('tags:delete', tag),
  },
  studios: {
    list: () => invoke('studios:list'),
    films: (name: string, role: 'studio' | 'label' | 'any') => invoke('studios:films', name, role),
    rename: (from: string, to: string, role: 'studio' | 'label') => invoke('studios:rename', from, to, role),
    remove: (name: string, role: 'studio' | 'label') => invoke('studios:delete', name, role),
  },
  scanner: {
    listRoots: () => invoke('scanner:listRoots'),
    addRoot: (p: string, label?: string) => invoke('scanner:addRoot', p, label),
    removeRoot: (id: number) => invoke('scanner:removeRoot', id),
    runFull: (id: number) => invoke('scanner:runFull', id),
    runIncremental: (id: number) => invoke('scanner:runIncremental', id),
    listRuns: (limit = 50) => invoke('scanner:listRuns', limit),
    clearHistory: () => invoke('scanner:clearHistory'),
    onProgress: (cb: (p: any) => void) => {
      const h = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('scanner:progress', h);
      return () => ipcRenderer.removeListener('scanner:progress', h);
    },
  },
  files: {
    listByFilm: (id: number) => invoke('files:listByFilm', id),
    pathStatus: (id: number) => invoke('files:pathStatus', id),
    openInFolder: (id: number) => invoke('files:openInFolder', id),
    restat: (id: number) => invoke('files:restat', id),
    renameFilmDir: (id: number, newName: string) => invoke('files:renameFilmDir', id, newName),
    renameParentDir: (id: number, newName: string) => invoke('files:renameParentDir', id, newName),
    deleteFile: (filmId: number, fileId: number) => invoke('files:deleteFile', filmId, fileId),
  },
  cover: {
    getCover: (id: number, opts: any) => invoke('cover:getCover', id, opts),
    listImages: (id: number) => invoke('cover:listImages', id),
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
  scrape: {
    javbus: (filmId: number) => invoke('scrape:javbus', filmId),
    javbusBatch: (filmIds: number[], concurrency?: number) => invoke('scrape:javbusBatch', filmIds, concurrency),
    cancelBatch: () => invoke('scrape:cancelBatch'),
    getBatchStatus: () => invoke('scrape:getBatchStatus'),
    openLogDir: () => invoke('scrape:openLogDir'),
    getLogPath: () => invoke('scrape:getLogPath'),
    workResources: (url: string) => invoke('scrape:workResources', url),
    onProgress: (cb: (p: any) => void) => {
      const h = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('scrape:progress', h);
      return () => ipcRenderer.removeListener('scrape:progress', h);
    },
    onBatchProgress: (cb: (p: any) => void) => {
      const h = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('scrape:batchProgress', h);
      return () => ipcRenderer.removeListener('scrape:batchProgress', h);
    },
  },
});
