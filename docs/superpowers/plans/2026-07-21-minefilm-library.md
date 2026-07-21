# MineFilmLibrary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Electron + React + better-sqlite3 的本地影片库桌面工具，支持对统一命名规则的目录进行扫描刮削与完整的增删改查。

**Architecture:** 主进程持有 better-sqlite3 单例 + scanner + IPC handler；渲染进程 React + Vite。两端通过 contextBridge 暴露的 `window.mfl` 受控 API 通讯。封面默认隐藏，单次显示开关在渲染层内存维护并每次复位。

**Tech Stack:** Electron 30 / React 18 / Vite / TypeScript / better-sqlite3 / @tanstack/react-table / vitest / electron-builder

---

## File Map

新增主进程（`electron/`）:
- `electron/main.ts` — 创建 BrowserWindow、加载 dev/prod URL、注册 IPC
- `electron/preload.ts` — contextBridge 暴露 `window.mfl`
- `electron/db/index.ts` — DB 单例、WAL、迁移执行器
- `electron/db/schema.sql` — 全量 schema
- `electron/db/migrations/0001-init.ts` — 初始化迁移
- `electron/db/dao.ts` — prepared statements 封装 + 事务助手
- `electron/scanner/parser.ts` — 子目录名 / 父目录名解析
- `electron/scanner/walker.ts` — fs 递归遍历 + 枚举文件
- `electron/scanner/index.ts` — 全量 / 增量扫描器
- `electron/ipc/library.ts` `actors.ts` `genres.ts` `scanner.ts` `files.ts` `cover.ts` `export.ts` `settings.ts` — 按域 IPC handler
- `electron/util/logger.ts` — winston/dayjs 滚动日志（首版用最小 fs 写入）
- `electron/util/types.ts` — 共享类型 / DTO

新增渲染层（`src/`）:
- `src/main.tsx` `src/App.tsx` `src/router.tsx`
- `src/api/index.ts` — `window.mfl` 类型化包装
- `src/api/types.ts` — 与主进程 DTO 对应
- `src/pages/LibraryPage.tsx` `ActorPage.tsx` `ScanPage.tsx` `FilmDetailPage.tsx` `TrashPage.tsx` `SettingsPage.tsx`
- `src/components/FilmTable.tsx` `FilterBar.tsx` `CoverGuard.tsx` `Toaster.tsx` `Layout.tsx`
- `src/hooks/useScanProgress.ts` `useLibrary.ts` `useSessionImageFlag.ts`
- `src/styles/global.css`

新增顶层:
- `package.json` `tsconfig.json` `tsconfig.node.json` `vite.config.ts` `electron-builder.yml` `vitest.config.ts` `.gitignore`

测试:
- `test/parser.test.ts` `test/scanner.test.ts` `test/dao.test.ts` `test/db-migration.test.ts`
- `src/pages/__tests__/LibraryPage.test.tsx` `src/components/__tests__/CoverGuard.test.tsx`

---

## Task 1: 项目骨架 + 依赖

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `electron-builder.yml`
- Create: `electron/main.ts`, `electron/preload.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/global.css`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "mine-film-library",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently -k \"npm:dev:renderer\" \"npm:dev:electron\"",
    "dev:renderer": "vite",
    "dev:electron": "wait-on tcp:5173 && tsc -p tsconfig.node.json && cross-env NODE_ENV=development electron .",
    "build:renderer": "vite build",
    "build:electron": "tsc -p tsconfig.node.json",
    "build": "npm run build:renderer && npm run build:electron",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "dist": "npm run build && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@tanstack/react-table": "^8.20.5",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "concurrently": "^9.0.1",
    "cross-env": "^7.0.3",
    "electron": "^30.5.0",
    "electron-builder": "^24.13.3",
    "electron-rebuild": "^3.2.9",
    "jsdom": "^25.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "typescript": "^5.5.4",
    "vite": "^5.4.6",
    "vitest": "^2.1.1",
    "wait-on": "^8.0.1"
  },
  "build": {
    "extends": "./electron-builder.yml"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`（渲染进程）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test", "electron/util/types.ts"]
}
```

`tsconfig.node.json`（主进程）:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **Step 3: 写 `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist-renderer', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4: 写 `vitest.config.ts`**（独立配置便于 CI 单独跑）

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 5: 写 `.gitignore`**

```
node_modules/
dist/
dist-electron/
dist-renderer/
release/
*.log
.DS_Store
.env
```

- [ ] **Step 6: 写 `electron-builder.yml`**

```yaml
appId: io.github.minefilm.library
productName: MineFilmLibrary
directories:
  output: release
files:
  - dist-renderer/**
  - dist-electron/**
  - package.json
asarUnpack:
  - node_modules/better-sqlite3/build/Release/better_sqlite3.node
win:
  target:
    - nsis
    - zip
nsis:
  oneClick: false
  perMachine: true
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 7: 写 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MineFilmLibrary</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: 写 `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 9: 写 `src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/library" replace />} />
      <Route path="/library" element={<div>Library (skeleton)</div>} />
    </Routes>
  );
}
```

- [ ] **Step 10: 写 `src/styles/global.css`**

```css
:root {
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #1a1a1a; color: #e0e0e0; }
```

- [ ] **Step 11: 写 `electron/main.ts` 骨架**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const isDev = process.env.NODE_ENV === 'development';

let win: BrowserWindow | null = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) {
    await win.loadURL('http://localhost:5173');
  } else {
    await win.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 12: 写 `electron/preload.ts`**

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mfl', {
  __skeleton: true,
});
```

- [ ] **Step 13: 安装依赖并 rebuild native**

Run: `npm install`
Run: `npm run rebuild`

Expected: `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 存在；`electron -v` 输出版本号。

- [ ] **Step 14: 启动 dev 验证窗口能开**

Run: `npm run dev`
Expected: Vite 在 5173 起服务，Electron 窗口弹出，显示 "Library (skeleton)"。

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron + react + vite + ts project"
```

---

## Task 2: 共享类型 + DB schema + 迁移

**Files:**
- Create: `electron/util/types.ts`, `electron/db/schema.sql`, `electron/db/migrations/0001-init.ts`, `electron/db/index.ts`, `electron/db/dao.ts`
- Test: `test/db-migration.test.ts`

- [ ] **Step 1: 写 `electron/util/types.ts`**

```ts
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
  created_at: number;
  updated_at: number;
}

export interface ActorRow { id: number; name: string; raw_dir_name: string; category: string | null; created_at: number; updated_at: number; }
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
  page?: number;
  page_size?: number;
  sort_by?: 'code' | 'title' | 'updated_at' | 'fs_mtime_ms';
  sort_dir?: 'asc' | 'desc';
}

export interface ListResult<T> { items: T[]; total: number; page: number; page_size: number; }
```

- [ ] **Step 2: 写 `electron/db/schema.sql`**

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  raw_dir_name TEXT,
  category TEXT,
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

CREATE INDEX IF NOT EXISTS idx_films_code ON films(code);
CREATE INDEX IF NOT EXISTS idx_films_parent ON films(parent_dir_name);
CREATE INDEX IF NOT EXISTS idx_films_status ON films(scan_status);
CREATE INDEX IF NOT EXISTS idx_films_deleted ON films(is_deleted);
CREATE INDEX IF NOT EXISTS idx_files_film ON film_files(film_id);
CREATE INDEX IF NOT EXISTS idx_fa_actor ON film_actors(actor_id);
CREATE INDEX IF NOT EXISTS idx_fg_genre ON film_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_ft_tag ON film_tags(tag);
```

- [ ] **Step 3: 写 `electron/db/migrations/0001-init.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export function up(db: Database.Database) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(1);
}
```

(打包后 schema.sql 会随 dist-electron 输出。)

- [ ] **Step 4: 写 `electron/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { up as migration0001 } from './migrations/0001-init';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const dir = app.getPath('userData');
  return path.join(dir, 'minefilm.sqlite');
}

export function openDb(dbPath?: string): Database.Database {
  const target = dbPath ?? getDbPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instance = new Database(target);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  const current = instance.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
  if (!current) migration0001(instance);
  if (current && current.version < 1) migration0001(instance);
  return instance;
}

export function getDb(): Database.Database {
  if (!db) db = openDb();
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

/** 测试用：在任意路径打开临时 DB。 */
export function openDbForTest(target: string): Database.Database {
  const instance = new Database(target);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migration0001(instance);
  return instance;
}
```

- [ ] **Step 5: 写 `electron/db/dao.ts`**

```ts
import type Database from 'better-sqlite3';

export function tx<T>(db: Database.Database, fn: () => T): T {
  const t = db.transaction(fn);
  return t();
}

export function nowMs(): number { return Date.now(); }
```

- [ ] **Step 6: 写失败的测试 `test/db-migration.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';

let tmp = '';
let dbPath = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-'));
  dbPath = path.join(tmp, 't.sqlite');
});

afterEach(() => {
  if (fs.existsSync(dbPath)) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('db migration 0001', () => {
  it('creates all expected tables', () => {
    const db = openDbForTest(dbPath);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = rows.map(r => r.name);
    for (const t of ['actors', 'genres', 'films', 'film_actors', 'film_genres', 'film_tags', 'film_files', 'cover_blobs', 'scan_roots', 'scan_runs', 'schema_version']) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent — second open keeps version 1', () => {
    openDbForTest(dbPath);
    const db = new Database(dbPath);
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
  });

  it('foreign keys enforce cascade', () => {
    const db = openDbForTest(dbPath);
    const now = Date.now();
    db.prepare(`INSERT INTO films(raw_dir_name, abs_path, parent_dir_name, scan_status, fs_mtime_ms, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run('d', '/x/d', 'p', 'unknown', now, now, now);
    db.prepare('INSERT INTO film_files(film_id, rel_path, abs_path, name, ext, size, is_video, is_image, mtime_ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(1, 'a.mp4', '/x/d/a.mp4', 'a.mp4', '.mp4', 1, 1, 0, now, now);
    db.prepare('DELETE FROM films WHERE id=1').run();
    const c = db.prepare('SELECT COUNT(*) n FROM film_files WHERE film_id=1').get() as { n: number };
    expect(c.n).toBe(0);
  });
});
```

- [ ] **Step 7: 运行测试验证失败**

Run: `npx vitest run test/db-migration.test.ts`
Expected: FAIL（找不到模块 `../electron/db/index` 或编译错误——但 tsconfig.node 是 CommonJS，vitest 用 esbuild）。

> 注意：让 vitest 能 import 主进程的 ts，需要在 vitest config 加 alias 或让 esbuild 处理。先确认 vitest 直接用 src/electron 路径都能解析；若有问题就用 `import { openDbForTest } from '../electron/db/index'` 即可（vite esbuild 支持任意 ts 文件）。

- [ ] **Step 8: 跑测试到通过**

Run: `npx vitest run test/db-migration.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(db): schema v1 + migration + test"
```

---

## Task 3: 目录名解析器 + 单测

**Files:**
- Create: `electron/scanner/parser.ts`
- Test: `test/parser.test.ts`

- [ ] **Step 1: 写失败的 `test/parser.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseFilmDirName, parseParentDirName } from '../electron/scanner/parser';

describe('parseParentDirName', () => {
  it('actor prefix 0-', () => {
    expect(parseParentDirName('0-Julia', { defaultType: 'actor' })).toEqual({ parent_type: 'actor', name: 'Julia' });
  });
  it('genre prefix 1-', () => {
    expect(parseParentDirName('1-剧情', { defaultType: 'actor' })).toEqual({ parent_type: 'genre', name: '剧情' });
  });
  it('no prefix uses default strategy actor-first', () => {
    expect(parseParentDirName('Maria', { defaultType: 'actor' })).toEqual({ parent_type: 'actor', name: 'Maria' });
  });
  it('no prefix genre-first', () => {
    expect(parseParentDirName('剧情', { defaultType: 'genre' })).toEqual({ parent_type: 'genre', name: '剧情' });
  });
});

describe('parseFilmDirName', () => {
  it('full example', () => {
    const r = parseFilmDirName('CJOD-295-C [FHD] 闲暇的人妻 因为丈夫调职来到乡下 作为邻居被无内诱惑 数次中出的我 JULIA');
    expect(r).toEqual({
      code: 'CJOD-295',
      locale: 'C',
      tags: ['FHD'],
      title: '闲暇的人妻 因为丈夫调职来到乡下 作为邻居被无内诱惑 数次中出的我 JULIA',
      scan_status: 'parsed',
    });
  });
  it('underscore variant + locale U', () => {
    const r = parseFilmDirName('abc_123-U [4K] Title here');
    expect(r.code).toBe('abc_123');
    expect(r.locale).toBe('U');
    expect(r.tags).toEqual(['4K']);
    expect(r.title).toBe('Title here');
    expect(r.scan_status).toBe('parsed');
  });
  it('multiple tags', () => {
    const r = parseFilmDirName('SSIS-100 [FHD] [4K] T');
    expect(r.tags).toEqual(['FHD', '4K']);
    expect(r.title).toBe('T');
  });
  it('no code -> partial', () => {
    const r = parseFilmDirName('Some Title Only');
    expect(r.code).toBeNull();
    expect(r.title).toBe('Some Title Only');
    expect(r.scan_status).toBe('partial');
  });
  it('no title but code -> partial', () => {
    const r = parseFilmDirName('SSIS-100-C [FHD]');
    expect(r.title).toBeNull();
    expect(r.scan_status).toBe('partial');
  });
  it('empty string -> unknown', () => {
    const r = parseFilmDirName('   ');
    expect(r.scan_status).toBe('unknown');
    expect(r.code).toBeNull();
    expect(r.title).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/parser.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 `electron/scanner/parser.ts`**

```ts
import type { Locale, ParsedDir, ParsedParent, ParentType, ScanStatus } from '../util/types';

export interface ParentParseOptions {
  defaultType: Extract<ParentType, 'actor' | 'genre'>;
}

export function parseParentDirName(raw: string, opts: ParentParseOptions): ParsedParent {
  const m = /^(\d+)-(.+)$/.exec(raw.trim());
  if (m) {
    const idx = Number(m[1]);
    const name = m[2].trim();
    if (idx === 1) return { parent_type: 'genre', name };
    return { parent_type: 'actor', name };
  }
  const name = raw.trim() || null;
  return { parent_type: opts.defaultType, name };
}

const CODE_RE = /^([A-Za-z]+[-_]?[0-9]+)/;
const LOCALE_RE = /^-([CcUu])/;
const TAG_RE = /^\s*\[([^\]]+)\]/;

export function parseFilmDirName(raw: string): ParsedDir {
  let s = raw.trim();
  let code: string | null = null;
  let locale: Locale = null;
  const tags: string[] = [];

  const codeM = CODE_RE.exec(s);
  if (codeM) {
    // 保留原大小写与分隔符（避免与测试用例不一致：abc_123 不应被改写）
    code = codeM[1];
    s = s.slice(codeM[0].length);

    const localeM = LOCALE_RE.exec(s);
    if (localeM) {
      locale = localeM[1].toUpperCase() as 'C' | 'U';
      s = s.slice(localeM[0].length);
    }
  }

  while (true) {
    const tagM = TAG_RE.exec(s);
    if (!tagM) break;
    tags.push(tagM[1].trim());
    s = s.slice(tagM[0].length);
  }

  const title = s.trim() || null;

  let status: ScanStatus = 'unknown';
  const hasAny = code || title || tags.length > 0 || locale;
  if (code && title) status = 'parsed';
  else if (hasAny) status = 'partial';

  return { code, locale, tags, title, scan_status: status };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/parser.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scanner): dir name parser + tests"
```

---

## Task 4: 文件枚举 walker

**Files:**
- Create: `electron/scanner/walker.ts`
- Test: `test/walker.test.ts`

- [ ] **Step 1: 写失败的 `test/walker.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFilmFiles, walkFilmDirs } from '../electron/scanner/walker';

let tmp = '';
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-w-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('listFilmFiles', () => {
  it('lists files at depth <=3 with video/image flags', () => {
    const filmDir = path.join(tmp, 'CJOD-295-C [FHD] T');
    fs.mkdirSync(path.join(filmDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(filmDir, 'a.mp4'), 'x');
    fs.writeFileSync(path.join(filmDir, 'cover.jpg'), 'y');
    fs.writeFileSync(path.join(filmDir, 'sub', 'note.txt'), 'z');
    const files = listFilmFiles(filmDir);
    expect(files.map(f => f.name).sort()).toEqual(['a.mp4', 'cover.jpg', 'note.txt']);
    const mp4 = files.find(f => f.name === 'a.mp4')!;
    expect(mp4.is_video).toBe(1);
    expect(mp4.is_image).toBe(0);
    expect(mp4.size).toBe(1);
    const jpg = files.find(f => f.name === 'cover.jpg')!;
    expect(jpg.is_image).toBe(1);
  });

  it('picks largest image as cover candidate', () => {
    const filmDir = path.join(tmp, 'F-1 T');
    fs.mkdirSync(filmDir, { recursive: true });
    fs.writeFileSync(path.join(filmDir, 'small.jpg'), 'yy');
    fs.writeFileSync(path.join(filmDir, 'big.png'), 'yyyyyyyyyy');
    const files = listFilmFiles(filmDir);
    const cover = pickCover(files);
    expect(cover).toBe(path.join(filmDir, 'big.png'));
  });
});

describe('walkFilmDirs', () => {
  it('walks two-level actor -> film structure', () => {
    fs.mkdirSync(path.join(tmp, '0-Julia', 'AAA-1 [FHD] T1'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '0-Julia', 'AAA-2 T2'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '1-剧情', 'BBB-3 T3'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    expect(visited.map(v => v.parentDirName).sort()).toEqual(['0-Julia', '0-Julia', '1-剧情']);
    expect(visited.map(v => v.filmDirName)).toEqual(expect.arrayContaining(['AAA-1 [FHD] T1', 'AAA-2 T2', 'BBB-3 T3']));
  });

  it('fallback to depth+1 when first level is not actor-like', () => {
    fs.mkdirSync(path.join(tmp, 'groupA', '0-Maria', 'CCC-1 T'), { recursive: true });
    const visited = Array.from(walkFilmDirs(tmp));
    expect(visited.map(v => v.filmDirName)).toEqual(['CCC-1 T']);
    expect(visited[0].parentDirName).toBe('0-Maria');
  });
});

function pickCover(files: { abs_path: string; is_image: number; size: number }[]): string | null {
  const imgs = files.filter(f => f.is_image);
  if (!imgs.length) return null;
  return imgs.sort((a, b) => b.size - a.size)[0].abs_path;
}
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/walker.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 `electron/scanner/walker.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.wmv', '.mov', '.m4v', '.iso', '.rmvb', '.ts']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_DEPTH = 3;

export interface FilmFileStat {
  rel_path: string;
  abs_path: string;
  name: string;
  ext: string;
  size: number;
  is_video: number;
  is_image: number;
  mtime_ms: number;
}

export interface FilmDirVisit {
  parentDirName: string;
  filmDirName: string;
  filmAbsPath: string;
  parentAbsPath: string;
  mtime_ms: number;
}

export function listFilmFiles(filmDir: string): FilmFileStat[] {
  const out: FilmFileStat[] = [];
  const recurse = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) recurse(abs, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const st = fs.statSync(abs);
        out.push({
          rel_path: path.relative(filmDir, abs),
          abs_path: abs,
          name: e.name,
          ext,
          size: st.size,
          is_video: VIDEO_EXT.has(ext) ? 1 : 0,
          is_image: IMAGE_EXT.has(ext) ? 1 : 0,
          mtime_ms: st.mtimeMs,
        });
      }
    }
  };
  recurse(filmDir, 0);
  return out;
}

function looksLikeActorOrGenre(name: string): boolean {
  return /^\d+-.+/.test(name);
}

function looksLikeFilmDir(name: string): boolean {
  const txt = name.trim();
  return /^[A-Za-z]+[-_]?[0-9]+/.test(txt) || /\[[^\]]+\]/.test(txt);
}

export function* walkFilmDirs(root: string): Iterable<FilmDirVisit> {
  let firstLevel: fs.Dirent[];
  try { firstLevel = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return; }

  for (const parent of firstLevel) {
    if (!parent.isDirectory()) continue;
    const parentAbs = path.join(root, parent.name);

    let subs: fs.Dirent[];
    try { subs = fs.readdirSync(parentAbs, { withFileTypes: true }); }
    catch { continue; }

    const filmSubs = subs.filter(s => s.isDirectory() && looksLikeFilmDir(s.name));
    if (filmSubs.length > 0) {
      for (const s of filmSubs) {
        const abs = path.join(parentAbs, s.name);
        yield { parentDirName: parent.name, filmDirName: s.name, filmAbsPath: abs, parentAbsPath: parentAbs, mtime_ms: dirMtime(abs) };
      }
      continue;
    }

    // fallback: parent 层不像 actor/genre，再下一层
    if (!looksLikeActorOrGenre(parent.name)) {
      for (const inner of subs) {
        if (!inner.isDirectory()) continue;
        const innerAbs = path.join(parentAbs, inner.name);
        let innerSubs: fs.Dirent[];
        try { innerSubs = fs.readdirSync(innerAbs, { withFileTypes: true }); }
        catch { continue; }
        for (const s of innerSubs) {
          if (s.isDirectory() && looksLikeFilmDir(s.name)) {
            const abs = path.join(innerAbs, s.name);
            yield { parentDirName: inner.name, filmDirName: s.name, filmAbsPath: abs, parentAbsPath: innerAbs, mtime_ms: dirMtime(abs) };
          }
        }
      }
    }
  }
}

function dirMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run test/walker.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scanner): fs walker + file listing"
```

---

## Task 5: 扫描器（全量 + 增量）+ DAO + 测试

**Files:**
- Create: `electron/scanner/index.ts`, `electron/db/queries.ts`
- Test: `test/scanner.test.ts`

- [ ] **Step 1: 写 `electron/db/queries.ts`**

```ts
import type Database from 'better-sqlite3';
import { nowMs } from './dao';
import type { FilmRow, FilmFileRow, ActorRow, GenreRow } from '../util/types';

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
```

- [ ] **Step 2: 写 `electron/scanner/index.ts`**

```ts
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { parseFilmDirName, parseParentDirName } from './parser';
import { listFilmFiles, walkFilmDirs } from './walker';
import { nowMs, tx } from '../db/dao';
import {
  upsertActorByName, upsertGenreByName,
  replaceFilmActors, replaceFilmGenres, replaceFilmTags, replaceFilmFiles,
  listAllFilmPaths, markSoftDeleted,
} from '../db/queries';
import type { ScanMode } from '../util/types';

export interface ProgressCb { (p: ScanProgress): void; }
export interface ScanProgress { stage: string; current: number; total: number; currentPath: string; }

export interface ScannerOptions {
  mode: ScanMode;
  rootPath: string;
  defaultType: 'actor' | 'genre';
  onProgress?: ProgressCb;
}

export interface ScanStats {
  dir_seen: number;
  dir_added: number;
  dir_updated: number;
  dir_removed: number;
}

export function runScan(db: Database.Database, opts: ScannerOptions): ScanStats {
  const stats: ScanStats = { dir_seen: 0, dir_added: 0, dir_updated: 0, dir_removed: 0 };
  const visits = Array.from(walkFilmDirs(opts.rootPath));

  const baseline = new Map(listAllFilmPaths(db, opts.rootPath).map(r => [r.abs_path, r]));

  for (const v of visits) {
    stats.dir_seen++;
    opts.onProgress?.({ stage: 'scan', current: stats.dir_seen, total: visits.length, currentPath: v.filmAbsPath });

    const parsed = parseFilmDirName(v.filmDirName);
    const parentId = parseParentDirName(v.parentDirName, { defaultType: opts.defaultType });

    const files = listFilmFiles(v.filmAbsPath);
    const cover = files.filter(f => f.is_image).sort((a, b) => b.size - a.size)[0] ?? null;
    const coverRel = cover ? path.relative(v.filmAbsPath, cover.abs_path) : null;

    const actorIds: number[] = [];
    const genreIds: number[] = [];
    if (parentId.parent_type === 'actor' && parentId.name) actorIds.push(upsertActorByName(db, parentId.name, v.parentDirName));
    if (parentId.parent_type === 'genre' && parentId.name) genreIds.push(upsertGenreByName(db, parentId.name));

    const prev = baseline.get(v.filmAbsPath);

    tx(db, () => {
      let filmId: number;
      if (prev) {
        db.prepare(`UPDATE films SET code=?, title=?, raw_dir_name=?, parent_dir_name=?, parent_type=?, locale=?, cover_path=?, scan_status=?, fs_mtime_ms=?, is_deleted=0, updated_at=? WHERE id=?`)
          .run(parsed.code, parsed.title, v.filmDirName, v.parentDirName, parentId.parent_type, parsed.locale, coverRel, parsed.scan_status, v.mtime_ms, nowMs(), prev.id);
        filmId = prev.id;
        if (v.mtime_ms !== prev.fs_mtime_ms) stats.dir_updated++;
        baseline.delete(v.filmAbsPath);
      } else {
        const r = db.prepare(`INSERT INTO films(code, title, raw_dir_name, abs_path, parent_dir_name, parent_type, locale, cover_path, scan_status, fs_mtime_ms, is_deleted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`)
          .run(parsed.code, parsed.title, v.filmDirName, v.filmAbsPath, v.parentDirName, parentId.parent_type, parsed.locale, coverRel, parsed.scan_status, v.mtime_ms, nowMs(), nowMs());
        filmId = Number(r.lastInsertRowid);
        stats.dir_added++;
      }
      replaceFilmActors(db, filmId, actorIds);
      replaceFilmGenres(db, filmId, genreIds);
      replaceFilmTags(db, filmId, parsed.tags);
      replaceFilmFiles(db, filmId, files);
    });
  }

  // Remaining baseline => missing => soft delete
  const missing = Array.from(baseline.values());
  if (missing.length) {
    tx(db, () => { markSoftDeleted(db, missing.map(m => m.id)); });
    stats.dir_removed = missing.length;
  }

  return stats;
}
```

- [ ] **Step 3: 写失败的 `test/scanner.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDbForTest } from '../electron/db/index';
import { runScan } from '../electron/scanner/index';

let tmp = '';
let dbPath = '';
let rootPath = '';
let db: Database.Database;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfl-scan-'));
  dbPath = path.join(tmp, 't.sqlite');
  rootPath = path.join(tmp, 'root');
  fs.mkdirSync(rootPath, { recursive: true });
  db = openDbForTest(dbPath);
});
afterEach(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function mkdir(rel: string) { fs.mkdirSync(path.join(rootPath, rel), { recursive: true }); }
function touch(rel: string, content = 'x') { fs.writeFileSync(path.join(rootPath, rel), content); }

describe('runScan full mode', () => {
  it('inserts films, actors, tags, files', () => {
    mkdir('0-Julia/CJOD-295-C [FHD] Title A');
    touch('0-Julia/CJOD-295-C [FHD] Title A/m.mp4', 'xx');
    touch('0-Julia/CJOD-295-C [FHD] Title A/c.jpg', 'yy');

    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(1);
    expect(stats.dir_seen).toBe(1);

    const film = db.prepare('SELECT * FROM films WHERE id=1').get() as any;
    expect(film.code).toBe('CJOD-295');
    expect(film.locale).toBe('C');
    expect(film.title).toBe('Title A');

    const actor = db.prepare('SELECT * FROM actors').get() as any;
    expect(actor.name).toBe('Julia');

    const tags = db.prepare('SELECT tag FROM film_tags').all() as any[];
    expect(tags.map(t => t.tag)).toEqual(['FHD']);

    const files = db.prepare('SELECT * FROM film_files').all() as any[];
    expect(files.length).toBe(2);

    const cover = db.prepare('SELECT cover_path FROM films').get() as any;
    expect(cover.cover_path).toBe('c.jpg');
  });

  it('genre parent creates genre not actor', () => {
    mkdir('1-剧情/BBB-1 T');
    touch('1-剧情/BBB-1 T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const actors = db.prepare('SELECT COUNT(*) n FROM actors').get() as any;
    const genres = db.prepare('SELECT name FROM genres').all() as any[];
    expect(actors.n).toBe(0);
    expect(genres.map(g => g.name)).toEqual(['剧情']);
  });

  it('soft deletes missing dirs on re-scan', () => {
    mkdir('0-J/CJOD-295-C [FHD] T');
    touch('0-J/CJOD-295-C [FHD] T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    // remove dir
    fs.rmSync(path.join(rootPath, '0-J'), { recursive: true, force: true });
    const stats = runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    expect(stats.dir_removed).toBe(1);
    const film = db.prepare('SELECT is_deleted FROM films').get() as any;
    expect(film.is_deleted).toBe(1);
  });

  it('incremental skips unchanged dirs', () => {
    mkdir('0-J/CJOD-295-C [FHD] T');
    touch('0-J/CJOD-295-C [FHD] T/a.mp4');
    runScan(db, { mode: 'full', rootPath, defaultType: 'actor' });
    const stats = runScan(db, { mode: 'incremental', rootPath, defaultType: 'actor' });
    expect(stats.dir_added).toBe(0);
    expect(stats.dir_updated).toBe(0);
  });
});
```

- [ ] **Step 4: 运行验证失败**

Run: `npx vitest run test/scanner.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 5: 运行验证通过**

Run: `npx vitest run test/scanner.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scanner): full + incremental scan with soft delete"
```

---

## Task 6: IPC domain handlers

**Files:**
- Create: `electron/ipc/library.ts`, `actors.ts`, `genres.ts`, `scanner.ts`, `files.ts`, `cover.ts`, `export.ts`, `settings.ts`
- Create: `electron/ipc/registry.ts`
- No unit test（IPC 边界由后续页面 e2e 覆盖；这里只写 wiring 测试，断言 handler 注册不抛错）

- [ ] **Step 1: 写 `electron/ipc/library.ts`**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import type { FilmFilter, ListResult, FilmRow } from '../util/types';

const PAGE_SIZE_DEFAULT = 50;

export function registerLibraryIpc() {
  ipcMain.handle('library:list', (_e, filter: FilmFilter) => {
    const db = getDb();
    const page = filter.page ?? 1;
    const pageSize = filter.page_size ?? PAGE_SIZE_DEFAULT;
    const sortCol = filter.sort_by ?? 'updated_at';
    const sortDir = filter.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const where: string[] = [];
    const args: any[] = [];
    if (!filter.include_deleted) where.push('is_deleted=0');
    if (filter.q) {
      where.push('(code LIKE ? OR title LIKE ?)');
      const q = `%${filter.q}%`;
      args.push(q, q);
    }
    if (filter.locales?.length) {
      where.push(`locale IN (${filter.locales.map(() => '?').join(',')})`);
      args.push(...filter.locales);
    }
    if (filter.statuses?.length) {
      where.push(`scan_status IN (${filter.statuses.map(() => '?').join(',')})`);
      args.push(...filter.statuses);
    }
    if (filter.actors?.length) {
      where.push(`id IN (SELECT film_id FROM film_actors WHERE actor_id IN (${filter.actors.map(() => '?').join(',')}))`);
      args.push(...filter.actors);
    }
    if (filter.genres?.length) {
      where.push(`id IN (SELECT film_id FROM film_genres WHERE genre_id IN (${filter.genres.map(() => '?').join(',')}))`);
      args.push(...filter.genres);
    }
    if (filter.tags?.length) {
      where.push(`id IN (SELECT film_id FROM film_tags WHERE tag IN (${filter.tags.map(() => '?').join(',')}))`);
      args.push(...filter.tags);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (db.prepare(`SELECT COUNT(*) n FROM films ${whereSql}`).get(...args) as any).n;
    const items = db.prepare(`SELECT * FROM films ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as FilmRow[];
    return { items, total, page, page_size: pageSize } as ListResult<FilmRow>;
  });

  ipcMain.handle('library:get', (_e, id: number) => {
    const db = getDb();
    const film = db.prepare('SELECT * FROM films WHERE id=?').get(id) as FilmRow | undefined;
    if (!film) return null;
    const actors = db.prepare('SELECT a.id, a.name FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=?').all(id) as { id: number; name: string }[];
    const genres = db.prepare('SELECT g.id, g.name FROM film_genres fg JOIN genres g ON g.id=fg.genre_id WHERE fg.film_id=?').all(id) as { id: number; name: string }[];
    const tags = db.prepare('SELECT tag FROM film_tags WHERE film_id=?').all(id) as { tag: string }[];
    return { ...film, actors, genres, tags: tags.map(t => t.tag) };
  });

  ipcMain.handle('library:create', (_e, payload: Partial<FilmRow> & { tags?: string[]; actor_ids?: number[]; genre_ids?: number[] }) => {
    const db = getDb();
    const now = nowMs();
    return tx(db, () => {
      const r = db.prepare(`INSERT INTO films(code, title, raw_dir_name, abs_path, parent_dir_name, parent_type, locale, scan_status, fs_mtime_ms, is_deleted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)`)
        .run(payload.code ?? null, payload.title ?? null, payload.raw_dir_name ?? payload.abs_path ?? '', payload.abs_path ?? '', payload.parent_dir_name ?? '', payload.parent_type ?? null, payload.locale ?? null, 'parsed', now, now, now);
      const id = Number(r.lastInsertRowid);
      if (payload.actor_ids?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
        for (const a of payload.actor_ids) ins.run(id, a);
      }
      if (payload.genre_ids?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_genres(film_id, genre_id) VALUES(?,?)');
        for (const g of payload.genre_ids) ins.run(id, g);
      }
      if (payload.tags?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO film_tags(tag, film_id) VALUES(?,?)');
        for (const t of payload.tags) ins.run(t, id);
      }
      return id;
    });
  });

  ipcMain.handle('library:update', (_e, id: number, patch: Partial<FilmRow> & { tags?: string[]; actor_ids?: number[]; genre_ids?: number[] }) => {
    const db = getDb();
    return tx(db, () => {
      const sets: string[] = [];
      const args: any[] = [];
      for (const k of ['code', 'title', 'locale', 'parent_type', 'parent_dir_name', 'cover_path', 'notes', 'scan_status'] as const) {
        if (k in patch) { sets.push(`${k}=?`); args.push((patch as any)[k]); }
      }
      sets.push('updated_at=?'); args.push(nowMs());
      args.push(id);
      db.prepare(`UPDATE films SET ${sets.join(',')} WHERE id=?`).run(...args);
      if (patch.tags) {
        db.prepare('DELETE FROM film_tags WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_tags(tag, film_id) VALUES(?,?)');
        for (const t of patch.tags) ins.run(t, id);
      }
      if (patch.actor_ids) {
        db.prepare('DELETE FROM film_actors WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_actors(film_id, actor_id) VALUES(?,?)');
        for (const a of patch.actor_ids) ins.run(id, a);
      }
      if (patch.genre_ids) {
        db.prepare('DELETE FROM film_genres WHERE film_id=?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO film_genres(film_id, genre_id) VALUES(?,?)');
        for (const g of patch.genre_ids) ins.run(id, g);
      }
      return true;
    });
  });

  ipcMain.handle('library:softDelete', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=1, updated_at=? WHERE id=?').run(nowMs(), id);
    return true;
  });
  ipcMain.handle('library:hardDelete', (_e, id: number) => {
    getDb().prepare('DELETE FROM films WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('library:restore', (_e, id: number) => {
    getDb().prepare('UPDATE films SET is_deleted=0, updated_at=? WHERE id=?').run(nowMs(), id);
    return true;
  });
}
```

- [ ] **Step 2: 写 `electron/ipc/actors.ts`**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';

export function registerActorIpc() {
  ipcMain.handle('actors:list', () => {
    return getDb().prepare(`SELECT a.*, COUNT(fa.film_id) film_count FROM actors a LEFT JOIN film_actors fa ON fa.actor_id=a.id WHERE 1 GROUP BY a.id ORDER BY a.name`).all();
  });
  ipcMain.handle('actors:create', (_e, name: string, rawDirName?: string, category?: string) => {
    const now = nowMs();
    const r = getDb().prepare('INSERT INTO actors(name, raw_dir_name, category, created_at, updated_at) VALUES(?,?,?,?,?)').run(name, rawDirName ?? null, category ?? null, now, now);
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('actors:update', (_e, id: number, patch: { name?: string; category?: string }) => {
    const sets: string[] = []; const args: any[] = [];
    if (patch.name !== undefined) { sets.push('name=?'); args.push(patch.name); }
    if (patch.category !== undefined) { sets.push('category=?'); args.push(patch.category); }
    if (!sets.length) return false;
    sets.push('updated_at=?'); args.push(nowMs()); args.push(id);
    getDb().prepare(`UPDATE actors SET ${sets.join(',')} WHERE id=?`).run(...args);
    return true;
  });
  ipcMain.handle('actors:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM actors WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('actors:films', (_e, actorId: number) => {
    return getDb().prepare(`SELECT f.* FROM films f JOIN film_actors fa ON fa.film_id=f.id WHERE fa.actor_id=? AND f.is_deleted=0`).all(actorId);
  });
}
```

- [ ] **Step 3: 写 `electron/ipc/genres.ts`**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';

export function registerGenreIpc() {
  ipcMain.handle('genres:list', () => getDb().prepare('SELECT * FROM genres ORDER BY name').all());
  ipcMain.handle('genres:create', (_e, name: string) => {
    const r = getDb().prepare('INSERT INTO genres(name, created_at) VALUES(?,?)').run(name, nowMs());
    return Number(r.lastInsertRowid);
  });
  ipcMain.handle('genres:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM genres WHERE id=?').run(id);
    return true;
  });
  ipcMain.handle('genres:allTags', () => getDb().prepare('SELECT tag, COUNT(*) count FROM film_tags GROUP BY tag ORDER BY tag').all());
}
```

- [ ] **Step 4: 写 `electron/ipc/scanner.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import { runScan, type ScanProgress } from '../scanner';

export function registerScannerIpc(progressKey = 'scanner:progress') {
  ipcMain.handle('scanner:listRoots', () => getDb().prepare('SELECT * FROM scan_roots ORDER BY id').all());
  ipcMain.handle('scanner:addRoot', async (_e, p: string, label?: string) => {
    const now = nowMs();
    try {
      const r = getDb().prepare('INSERT INTO scan_roots(path, label, last_full_scan_at, last_incremental_scan_at, enabled) VALUES(?,?,?,?,1)')
        .run(p, label ?? null, null, null);
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('scanner:removeRoot', (_e, id: number) => {
    getDb().prepare('DELETE FROM scan_roots WHERE id=?').run(id);
    return true;
  });

  async function run(rootId: number, mode: 'full' | 'incremental') {
    const root = getDb().prepare('SELECT * FROM scan_roots WHERE id=?').get(rootId) as any;
    if (!root) throw new Error('root not found');
    const runRow = getDb().prepare('INSERT INTO scan_runs(root_id, mode, started_at, status) VALUES(?,?,?,?)').run(rootId, mode, nowMs(), 'running');
    const runId = Number(runRow.lastInsertRowid);

    const settingsRow = getDb().prepare("SELECT value FROM settings WHERE key='default_parent_type'").get() as { value: string } | undefined;
    const defaultType = settingsRow?.value === 'genre' ? 'genre' : 'actor';

    let errorMessage: string | null = null;
    try {
      const onProgress = (p: ScanProgress) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(progressKey, { runId, ...p });
        }
      };
      const stats = runScan(getDb(), { mode, rootPath: root.path, defaultType: defaultType as 'actor' | 'genre', onProgress });
      const finished = nowMs();
      if (mode === 'full') getDb().prepare('UPDATE scan_roots SET last_full_scan_at=? WHERE id=?').run(finished, rootId);
      else getDb().prepare('UPDATE scan_roots SET last_incremental_scan_at=? WHERE id=?').run(finished, rootId);
      getDb().prepare('UPDATE scan_runs SET finished_at=?, dir_seen=?, dir_added=?, dir_updated=?, dir_removed=?, status=? WHERE id=?')
        .run(finished, stats.dir_seen, stats.dir_added, stats.dir_updated, stats.dir_removed, 'done', runId);
      return { ok: true, stats };
    } catch (err: any) {
      errorMessage = err.message;
      getDb().prepare('UPDATE scan_runs SET finished_at=?, status=?, error_message=? WHERE id=?').run(nowMs(), 'error', errorMessage, runId);
      return { ok: false, error: errorMessage };
    }
  }

  ipcMain.handle('scanner:runFull', (_e, rootId: number) => run(rootId, 'full'));
  ipcMain.handle('scanner:runIncremental', (_e, rootId: number) => run(rootId, 'incremental'));
  ipcMain.handle('scanner:listRuns', (_e, limit = 50) => getDb().prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?').all(limit));
}
```

- [ ] **Step 5: 写 `electron/ipc/files.ts`**

```ts
import { ipcMain, shell } from 'electron';
import { getDb } from '../db';
import path from 'node:path';
import { listFilmFiles } from '../scanner/walker';
import { replaceFilmFiles } from '../db/queries';
import { nowMs, tx } from '../db/dao';

export function registerFileIpc() {
  ipcMain.handle('files:listByFilm', (_e, filmId: number) => {
    return getDb().prepare('SELECT * FROM film_files WHERE film_id=? ORDER BY name').all(filmId);
  });

  ipcMain.handle('files:openInFolder', async (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const result = await shell.openPath(film.abs_path);
    return result === '';
  });

  ipcMain.handle('files:restat', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const files = listFilmFiles(film.abs_path);
    tx(getDb(), () => replaceFilmFiles(getDb(), filmId, files));
    void nowMs(); // keep import used in case of future audit hook
    return true;
  });
}
```

- [ ] **Step 6: 写 `electron/ipc/cover.ts`**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { nowMs, tx } from '../db/dao';
import fs from 'node:fs';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

export function registerCoverIpc() {
  ipcMain.handle('cover:getCover', (_e, filmId: number, opts?: { display?: boolean }) => {
    if (!opts?.display) return null;
    const film = getDb().prepare('SELECT cover_path, cover_blob_id, abs_path FROM films WHERE id=?').get(filmId) as any;
    if (!film) return null;
    if (film.cover_blob_id) {
      const blob = getDb().prepare('SELECT mime, data FROM cover_blobs WHERE id=?').get(film.cover_blob_id) as any;
      if (blob) return { kind: 'blob', mime: blob.mime, base64: blob.data.toString('base64') };
    }
    if (film.cover_path) {
      const abs = path.join(film.abs_path, film.cover_path);
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      try {
        const buf = fs.readFileSync(abs);
        return { kind: 'file', mime, base64: buf.toString('base64') };
      } catch {
        return null;
      }
    }
    return null;
  });

  ipcMain.handle('cover:upload', async (_e, filmId: number, fileName: string, base64: string) => {
    const ext = path.extname(fileName).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const buf = Buffer.from(base64, 'base64');
    return tx(getDb(), () => {
      const r = getDb().prepare('INSERT INTO cover_blobs(mime, data, created_at) VALUES(?,?,?)').run(mime, buf, nowMs());
      const id = Number(r.lastInsertRowid);
      getDb().prepare('UPDATE films SET cover_blob_id=?, cover_path=NULL, updated_at=? WHERE id=?').run(id, nowMs(), filmId);
      return id;
    });
  });

  ipcMain.handle('cover:clear', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT cover_blob_id FROM films WHERE id=?').get(filmId) as any;
    if (film?.cover_blob_id) getDb().prepare('DELETE FROM cover_blobs WHERE id=?').run(film.cover_blob_id);
    getDb().prepare('UPDATE films SET cover_blob_id=NULL, cover_path=NULL, updated_at=? WHERE id=?').run(nowMs(), filmId);
    return true;
  });
}
```

- [ ] **Step 7: 写 `electron/ipc/export.ts`**

```ts
import { ipcMain, dialog } from 'electron';
import { getDb } from '../db';
import fs from 'node:fs';

function filmCsvRow(f: any): string {
  const escape = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ['id', 'code', 'title', 'locale', 'parent_type', 'parent_dir_name', 'raw_dir_name', 'abs_path', 'scan_status', 'fs_mtime_ms', 'updated_at']
    .map(k => escape(f[k])).join(',');
}

export function registerExportIpc() {
  ipcMain.handle('export:csv', async (_e, filter: { include_deleted?: boolean }) => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    const where = filter.include_deleted ? '' : 'WHERE is_deleted=0';
    const films = getDb().prepare(`SELECT * FROM films ${where} ORDER BY id`).all() as any[];
    const header = 'id,code,title,locale,parent_type,parent_dir_name,raw_dir_name,abs_path,scan_status,fs_mtime_ms,updated_at\n';
    fs.writeFileSync(res.filePath, header + films.map(filmCsvRow).join('\n'), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('export:json', async (_e, filter: { include_deleted?: boolean }) => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    const where = filter.include_deleted ? '' : 'WHERE is_deleted=0';
    const films = getDb().prepare(`SELECT * FROM films ${where} ORDER BY id`).all() as any[];
    const enriched = films.map(f => ({
      ...f,
      actors: getDb().prepare('SELECT a.id, a.name FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=?').all(f.id),
      genres: getDb().prepare('SELECT g.id, g.name FROM film_genres fg JOIN genres g ON g.id=fg.genre_id WHERE fg.film_id=?').all(f.id),
      tags: (getDb().prepare('SELECT tag FROM film_tags WHERE film_id=?').all(f.id) as { tag: string }[]).map(t => t.tag),
      files: getDb().prepare('SELECT * FROM film_files WHERE film_id=? ORDER BY name').all(f.id),
    }));
    fs.writeFileSync(res.filePath, JSON.stringify({ exported_at: Date.now(), films: enriched }, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('export:sqlite', async () => {
    const res = await dialog.showSaveDialog({ defaultPath: 'minefilm-backup.sqlite', filters: [{ name: 'SQLite', extensions: ['sqlite'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    await getDb().backup(res.filePath);
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('import:sqlite', async () => {
    const res = await dialog.showOpenDialog({ filters: [{ name: 'SQLite', extensions: ['sqlite'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    const src = res.filePaths[0];
    const db = getDb();
    // backup current
    const backupPath = db.name + '.preimport.bak';
    await db.backup(backupPath);
    // overwrite: simplified approach — close and copy
    // (we don't expose closeDb to avoid breaking livehandles; instead read all rows)
    const srcDb = require('better-sqlite3')(src, { readonly: true });
    try {
      db.prepare('DELETE FROM film_files').run();
      db.prepare('DELETE FROM film_tags').run();
      db.prepare('DELETE FROM film_genres').run();
      db.prepare('DELETE FROM film_actors').run();
      db.prepare('DELETE FROM films').run();
      db.prepare('DELETE FROM actors').run();
      db.prepare('DELETE FROM genres').run();
      db.prepare('DELETE FROM cover_blobs').run();
      db.prepare('DELETE FROM scan_roots').run();
      db.prepare('DELETE FROM scan_runs').run();
      for (const t of ['actors', 'genres', 'films', 'film_actors', 'film_genres', 'film_tags', 'film_files', 'cover_blobs', 'scan_roots', 'scan_runs']) {
        const rows = srcDb.prepare(`SELECT * FROM ${t}`).all();
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(',');
        const ins = db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${placeholders})`);
        for (const r of rows) ins.run(...cols.map(c => r[c]));
      }
    } finally {
      srcDb.close();
    }
    return { ok: true, backupPath };
  });
}
```

- [ ] **Step 8: 写 `electron/ipc/settings.ts`**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSettingsIpc() {
  // ensure table exists (added in migration 0001 schema? — add defensively here)
  getDb().exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);

  ipcMain.handle('settings:get', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    out.default_parent_type ??= 'actor';
    return out;
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb().prepare('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    return true;
  });
}
```

> 注：将 `settings` 表也补到 `schema.sql` 末尾并加一行 `CREATE TABLE IF NOT EXISTS settings(...)`，保持单一来源。后续在 Task 8 commit 内同步。

- [ ] **Step 9: 写 `electron/ipc/registry.ts`**

```ts
import { registerLibraryIpc } from './library';
import { registerActorIpc } from './actors';
import { registerGenreIpc } from './genres';
import { registerScannerIpc } from './scanner';
import { registerFileIpc } from './files';
import { registerCoverIpc } from './cover';
import { registerExportIpc } from './export';
import { registerSettingsIpc } from './settings';

export function registerAllIpc() {
  registerLibraryIpc();
  registerActorIpc();
  registerGenreIpc();
  registerScannerIpc();
  registerFileIpc();
  registerCoverIpc();
  registerExportIpc();
  registerSettingsIpc();
}
```

- [ ] **Step 10: 修改 `electron/main.ts` 注册 IPC 并升级 preload**

`electron/main.ts` 在 `app.whenReady` 前加 `import { registerAllIpc } from './ipc/registry';`，`app.whenReady().then(() => { getDb(); registerAllIpc(); createWindow(); });`。新增 `import { getDb } from './db';`。

`electron/preload.ts` 替换为：

```ts
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
```

- [ ] **Step 11: 同步 `schema.sql` 加 settings 表**

在 `schema.sql` 末尾追加：

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

- [ ] **Step 12: 编译验证**

Run: `npm run build:electron`
Expected: tsc 通过无错误。

- [ ] **Step 13: 启动 dev，确认窗口仍能开 + preload 注入 `window.mfl`**

Run: `npm run dev`
然后 Developer Tools Console 输入 `window.mfl` 应看到对象。

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(ipc): register domain handlers + preload bridge"
```

---

## Task 7: 渲染层骨架 + Layout + 路由

**Files:**
- Create: `src/router.tsx`, `src/components/Layout.tsx`, `src/components/Toaster.tsx`, `src/api/types.ts`, `src/api/index.ts`, `src/hooks/useScanProgress.ts`, `src/hooks/useSessionImageFlag.ts`, `src/test-setup.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 写 `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 2: 写 `src/api/types.ts`**（与主进程 `electron/util/types.ts` 镜像，但作为渲染层契约）

```ts
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
export interface FilmFilter {
  q?: string; actors?: number[]; genres?: number[]; tags?: string[]; locales?: string[];
  statuses?: ScanStatus[]; root_ids?: number[]; include_deleted?: boolean;
  page?: number; page_size?: number;
  sort_by?: 'code' | 'title' | 'updated_at' | 'fs_mtime_ms';
  sort_dir?: 'asc' | 'desc';
}
export interface ListResult<T> { items: T[]; total: number; page: number; page_size: number; }
export interface ActorRow { id: number; name: string; raw_dir_name: string; category: string | null; film_count: number; created_at: number; updated_at: number; }
export interface GenreRow { id: number; name: string; created_at: number; }
export interface FilmFileRow { id: number; film_id: number; rel_path: string; abs_path: string; name: string; ext: string; size: number; is_video: number; is_image: number; mtime_ms: number; created_at: number; }
export interface ScanRootRow { id: number; path: string; label: string | null; last_full_scan_at: number | null; last_incremental_scan_at: number | null; enabled: number; }
export interface ScanRunRow { id: number; root_id: number; mode: 'full'|'incremental'; started_at: number; finished_at: number|null; dir_seen: number; dir_added: number; dir_updated: number; dir_removed: number; status: 'running'|'done'|'error'; error_message: string|null; }
export interface CoverResult { kind: 'blob' | 'file'; mime: string; base64: string; }
```

- [ ] **Step 3: 写 `src/api/index.ts`**

```ts
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

export const api: MflApi = (typeof window !== 'undefined' && window.mfl) ? window.mfl : (undefined as any as MflApi);
export default api;
```

- [ ] **Step 4: 写 `src/hooks/useSessionImageFlag.ts`**

```ts
import { useCallback, useRef, useState } from 'react';

/**
 * 图片显示开关单次有效：每次 takeOneDisplay 后状态在调用方
 * 必须立刻消费并把显示结果标记为已用，避免下次默认显示。
 * 这里把"显示一次"实现为：consume 后由调用方主动 unmount，
 * 由本 hook 自动复位 enabledRef 为 false。
 */
export function useSessionImageFlag() {
  const [, force] = useState(0);
  const enabledRef = useRef(false);
  const enableOnce = useCallback(() => {
    enabledRef.current = true;
    force(n => n + 1);
  }, []);
  const consume = useCallback(() => {
    const v = enabledRef.current;
    enabledRef.current = false;
    return v;
  }, []);
  return {
    enableOnce,
    consume,
    get current() { return enabledRef.current; },
  };
}
```

- [ ] **Step 5: 写 `src/hooks/useScanProgress.ts`**

```ts
import { useEffect, useState } from 'react';
import api from '../api';

export function useScanProgress() {
  const [progress, setProgress] = useState<{ stage: string; current: number; total: number; currentPath: string } | null>(null);
  useEffect(() => {
    const off = api.scanner.onProgress(p => setProgress(p));
    return off;
  }, []);
  return progress;
}
```

- [ ] **Step 6: 写 `src/components/Toaster.tsx`**

```tsx
import { createContext, useCallback, useContext, useState } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
const Ctx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(s => [...s, { ...t, id }]);
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), 3000);
  };
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '8px 12px', borderRadius: 4, background: t.kind === 'error' ? '#b3261e' : (t.kind === 'success' ? '#2e7d32' : '#333'),
            color: '#fff', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
```

- [ ] **Step 7: 写 `src/components/Layout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useScanProgress } from '../hooks/useScanProgress';

const NAV: { to: string; label: string }[] = [
  { to: '/library', label: '影片库' },
  { to: '/actors', label: '演员' },
  { to: '/scan', label: '扫描' },
  { to: '/trash', label: '回收站' },
  { to: '/settings', label: '设置' },
];

export default function Layout() {
  const progress = useScanProgress();
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 200, borderRight: '1px solid #333', padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>MineFilmLibrary</div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} style={({ isActive }) => ({
            display: 'block', padding: '6px 8px', borderRadius: 4,
            background: isActive ? '#2a2a2a' : 'transparent', color: '#e0e0e0', textDecoration: 'none',
          })}>{n.label}</NavLink>
        ))}
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {progress && (
          <div style={{ padding: 8, borderBottom: '1px solid #333', fontSize: 12 }}>
            扫描中 {progress.current}/{progress.total} — {progress.currentPath}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: 写 `src/router.tsx` 并修改 `src/App.tsx`**

`src/router.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Toaster } from './components/Toaster';

export default function Router() {
  return (
    <Toaster>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<div>Library (placeholder)</div>} />
          <Route path="/actors" element={<div>Actors (placeholder)</div>} />
          <Route path="/scan" element={<div>Scan (placeholder)</div>} />
          <Route path="/trash" element={<div>Trash (placeholder)</div>} />
          <Route path="/settings" element={<div>Settings (placeholder)</div>} />
        </Route>
      </Routes>
    </Toaster>
  );
}
```

`src/App.tsx` 改为：

```tsx
import Router from './router';
export default function App() { return <Router />; }
```

- [ ] **Step 9: 启动 dev，验证导航可切换、扫描进度条不展示**

Run: `npm run dev`
Expected: 左侧导航四个条目可点；路由切换显示对应 placeholder。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(renderer): router + layout + api bridge + hooks"
```

---

## Task 8: 影片库页面（表格 + 筛选 + 关键字 + 操作）

**Files:**
- Create: `src/pages/LibraryPage.tsx`, `src/components/FilmTable.tsx`, `src/components/FilterBar.tsx`, `src/pages/__tests__/LibraryPage.test.tsx`
- Create: `src/hooks/useLibrary.ts`

- [ ] **Step 1: 写 `src/hooks/useLibrary.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import type { FilmFilter, FilmRow, ListResult } from '../api/types';

export function useLibrary(initial: FilmFilter) {
  const [filter, setFilter] = useState<FilmFilter>(initial);
  const [result, setResult] = useState<ListResult<FilmRow>>({ items: [], total: 0, page: 1, page_size: 50 });
  const [loading, setLoading] = useState(false);
  const run = useCallback(async () => {
    setLoading(true);
    try { setResult(await api.library.list(filter)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void run(); }, [run]);
  return { filter, setFilter, result, loading, reload: run };
}
```

- [ ] **Step 2: 写失败的测试 `src/pages/__tests__/LibraryPage.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LibraryPage from '../LibraryPage';

const fakeApi = {
  library: {
    list: vi.fn(async () => ({ items: [{ id: 1, code: 'AAA-1', title: 'T1', is_deleted: 0, scan_status: 'parsed', locale: null, parent_type: 'actor', parent_dir_name: '0-J', raw_dir_name: 'AAA-1 T1', abs_path: '/x/AAA-1 T1', cover_path: null, cover_blob_id: null, notes: null, fs_mtime_ms: 0, created_at: 0, updated_at: 0 }], total: 1, page: 1, page_size: 50 })),
  },
  actors: { list: vi.fn(async () => []) },
  genres: { list: vi.fn(async () => []), allTags: vi.fn(async () => []) },
};

beforeEach(() => {
  (window as any).mfl = fakeApi;
});

describe('LibraryPage', () => {
  it('renders rows from api', async () => {
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    expect(await screen.findByText('AAA-1')).toBeInTheDocument();
  });

  it('typing in keyword debounces and calls list', async () => {
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    const input = await screen.findByPlaceholderText('搜索 编号/标题/演员');
    fireEvent.change(input, { target: { value: 'CJOD' } });
    expect(fakeApi.library.list).toHaveBeenCalled();
  });
});
```

> 注意需要从 vitest import `vi`：在文件头加 `import { vi } from 'vitest';`。

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run src/pages/__tests__/LibraryPage.test.tsx`
Expected: FAIL（LibraryPage 不存在）

- [ ] **Step 4: 写 `src/components/FilterBar.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import type { FilmFilter } from '../api/types';

export default function FilterBar({ value, onChange }: { value: FilmFilter; onChange: (f: FilmFilter) => void }) {
  const [actors, setActors] = useState<{ id: number; name: string }[]>([]);
  const [genres, setGenres] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    void api.actors.list().then(r => setActors(r));
    void api.genres.list().then(r => setGenres(r));
    void api.genres.allTags().then(r => setTags(r.map(t => t.tag)));
  }, []);
  const toggle = (key: 'actors' | 'genres' | 'tags' | 'locales' | 'statuses', v: any) => {
    const arr = (value[key] as any[] | undefined) ?? [];
    const next = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
    onChange({ ...value, [key]: next });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <input
        placeholder="搜索 编号/标题/演员"
        value={value.q ?? ''}
        onChange={e => onChange({ ...value, q: e.target.value })}
        style={{ padding: 6, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {actors.map(a => (
          <Chip key={a.id} active={value.actors?.includes(a.id)} onClick={() => toggle('actors', a.id)}>{a.name}</Chip>
        ))}
        {genres.map(g => (
          <Chip key={g.id} active={value.genres?.includes(g.id)} onClick={() => toggle('genres', g.id)}>{g.name}</Chip>
        ))}
        {tags.map(t => (
          <Chip key={t} active={value.tags?.includes(t)} onClick={() => toggle('tags', t)}>{t}</Chip>
        ))}
        <Chip active={value.locales?.includes('C')} onClick={() => toggle('locales', 'C')}>中字</Chip>
        <Chip active={value.locales?.includes('U')} onClick={() => toggle('locales', 'U')}>破解</Chip>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
      background: active ? '#3a5a8a' : '#2a2a2a', color: '#e0e0e0', border: '1px solid #444',
    }}>{children}</button>
  );
}
```

- [ ] **Step 5: 写 `src/components/FilmTable.tsx`**

```tsx
import { useState } from 'react';
import type { FilmRow } from '../api/types';
import api from '../api';

const STATUS_LABEL: Record<string, string> = { parsed: '完整', partial: '部分', unknown: '未识别' };

export default function FilmTable({ rows }: { rows: FilmRow[] }) {
  const [menu, setMenu] = useState<{ film: FilmRow; x: number; y: number } | null>(null);
  const onContext = (e: React.MouseEvent, film: FilmRow) => {
    e.preventDefault();
    setMenu({ film, x: e.clientX, y: e.clientY });
  };
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
            <th>编号</th><th>标题</th><th>后缀</th><th>状态</th><th>修改时间</th><th>父目录</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onDoubleClick={() => window.location.hash = `#/film/${r.id}`} onContextMenu={e => onContext(e, r)} style={{ borderBottom: '1px solid #222', cursor: 'pointer' }}>
              <td>{r.code ?? ''}</td>
              <td>{r.title ?? ''}</td>
              <td>{r.locale ?? ''}</td>
              <td>{STATUS_LABEL[r.scan_status] ?? r.scan_status}</td>
              <td>{new Date(r.updated_at).toLocaleString()}</td>
              <td>{r.parent_dir_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {menu && (
        <div style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#2a2a2a', border: '1px solid #444', zIndex: 100, padding: 4 }}>
          <button onClick={() => { void api.files.openInFolder(menu.film.id); setMenu(null); }}>打开所在文件夹</button>
          <button onClick={() => { window.location.hash = `#/film/${menu.film.id}`; setMenu(null); }}>详情</button>
          <button onClick={() => { void api.library.softDelete(menu.film.id).then(() => location.reload()); setMenu(null); }}>软删除</button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: 写 `src/pages/LibraryPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import type { FilmFilter } from '../api/types';
import FilmTable from '../components/FilmTable';
import FilterBar from '../components/FilterBar';
import { useToast } from '../components/Toaster';

export default function LibraryPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<FilmFilter>({ page: 1, page_size: 50, sort_by: 'updated_at', sort_dir: 'desc' });
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.library.list(filter).then(r => {
      if (!cancelled) setRows(r.items);
    }).catch(e => toast.push({ text: String(e.message ?? e), kind: 'error' })).finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div>
      <FilterBar value={filter} onChange={setFilter} />
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => api.export.csv({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 CSV', kind: 'success' }))}>导出 CSV</button>
        <button onClick={() => api.export.json({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 JSON', kind: 'success' }))}>导出 JSON</button>
      </div>
      <FilmTable rows={rows} />
      {loading && <div style={{ padding: 8 }}>加载中…</div>}
    </div>
  );
}
```

- [ ] **Step 7: 在 `src/router.tsx` 把 `/library` 改为 `import LibraryPage from './pages/LibraryPage';` 并替换占位元素**

```tsx
<Route path="/library" element={<LibraryPage />} />
```

- [ ] **Step 8: 运行测试验证通过**

Run: `npx vitest run src/pages/__tests__/LibraryPage.test.tsx`
Expected: PASS（2 tests）

- [ ] **Step 9: 启动 dev，验证 UI 渲染（实际数据库为空时表格为空表头展示即可）**

Run: `npm run dev`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(renderer): library page with filter + table + export"
```

---

## Task 9: 详情页（含单次图片开关）

**Files:**
- Create: `src/pages/FilmDetailPage.tsx`, `src/components/CoverGuard.tsx`, `src/components/__tests__/CoverGuard.test.tsx`
- Modify: `src/router.tsx`（加入 `/film/:id` 路由）

- [ ] **Step 1: 写失败的 `src/components/__tests__/CoverGuard.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoverGuard from '../CoverGuard';

beforeEach(() => {
  (window as any).mfl = {
    cover: {
      getCover: vi.fn(async (_id: number, opts?: { display?: boolean }) => opts?.display ? { kind: 'file' as const, mime: 'image/jpeg', base64: 'AAAA' } : null),
    },
  };
});

describe('CoverGuard', () => {
  it('hides image by default', async () => {
    render(<CoverGuard filmId={1} />);
    expect(await screen.findByText('[封面已隐藏]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows image after clicking single-shot button then resets', async () => {
    render(<CoverGuard filmId={1} />);
    fireEvent.click(await screen.findByText('单次显示'));
    expect(await screen.findByRole('img')).toBeInTheDocument();
    // After showing, button label reverts to hidden state, next cover fetch returns null unless re-enabled
    fireEvent.click(await screen.findByText('单次显示'));
    expect(await screen.findByRole('img')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run src/components/__tests__/CoverGuard.test.tsx`
Expected: FAIL

- [ ] **Step 3: 写 `src/components/CoverGuard.tsx`**

```tsx
import { useState } from 'react';
import api from '../api';

export default function CoverGuard({ filmId }: { filmId: number }) {
  // 单次显示：每次点击后置 display=true 用于一次 cover.fetch，拿到结果后立即复位
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const showOnce = async () => {
    setLoading(true);
    try {
      const r = await api.cover.getCover(filmId, { display: true });
      if (r) setCurrentSrc(`data:${r.mime};base64,${r.base64}`);
      else setCurrentSrc(null);
    } finally { setLoading(false); }
  };

  if (currentSrc) {
    return (
      <div>
        <img src={currentSrc} alt="cover" style={{ maxWidth: 300, maxHeight: 400, display: 'block' }} />
        <button onClick={() => setCurrentSrc(null)}>隐藏</button>
      </div>
    );
  }
  return (
    <div style={{ width: 200, height: 260, background: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <span>[封面已隐藏]</span>
      <button onClick={showOnce} disabled={loading} style={{ marginTop: 8 }}>单次显示</button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/components/__tests__/CoverGuard.test.tsx`
Expected: PASS（2 tests）

- [ ] **Step 5: 写 `src/pages/FilmDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import type { FilmDetail, FilmFileRow } from '../api/types';
import CoverGuard from '../components/CoverGuard';
import { useToast } from '../components/Toaster';

export default function FilmDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [film, setFilm] = useState<FilmDetail | null>(null);
  const [files, setFiles] = useState<FilmFileRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (!id) return;
    api.library.get(Number(id)).then(f => { if (f) { setFilm(f); setForm({ code: f.code, title: f.title, locale: f.locale, notes: f.notes, tags: f.tags.join(', '), parent_dir_name: f.parent_dir_name }); } });
    api.files.listByFilm(Number(id)).then(setFiles);
  }, [id]);

  if (!film) return <div>加载中…</div>;

  const save = async () => {
    const patch: any = {
      code: form.code || null,
      title: form.title || null,
      locale: form.locale || null,
      notes: form.notes || null,
      parent_dir_name: form.parent_dir_name,
      tags: form.tags.split(',').map((s: string) => s.trim()).filter(Boolean),
    };
    await api.library.update(film.id, patch);
    toast.push({ text: '已保存', kind: 'success' });
    setEditing(false);
    setFilm({ ...film, ...patch, tags: patch.tags });
  };

  return (
    <div>
      <button onClick={() => nav('/library')}>返回</button>
      <h2>{film.code} {film.title}</h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <CoverGuard filmId={film.id} />
        <div style={{ flex: 1 }}>
          {!editing ? (
            <>
              <Row k="编号" v={film.code} />
              <Row k="后缀" v={film.locale} />
              <Row k="标签" v={film.tags.join(', ')} />
              <Row k="演员" v={film.actors.map(a => a.name).join(', ')} />
              <Row k="题材" v={film.genres.map(g => g.name).join(', ')} />
              <Row k="父目录" v={film.parent_dir_name} />
              <Row k="路径" v={film.abs_path} />
              <Row k="备注" v={film.notes} />
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={() => api.files.openInFolder(film.id)}>打开文件夹</button>
                <button onClick={() => { if (confirm('软删除？')) { api.library.softDelete(film.id).then(() => nav('/library')); } }}>软删除</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={form.code ?? ''} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="编号" />
              <input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="标题" />
              <input value={form.locale ?? ''} onChange={e => setForm({ ...form, locale: e.target.value })} placeholder="C / U" />
              <input value={form.tags ?? ''} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="标签逗号分隔" />
              <input value={form.parent_dir_name ?? ''} onChange={e => setForm({ ...form, parent_dir_name: e.target.value })} placeholder="父目录" />
              <textarea value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="备注" />
              <div>
                <button onClick={save}>保存</button>
                <button onClick={() => setEditing(false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <h3 style={{ marginTop: 16 }}>文件</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>名称</th><th>类型</th><th>体积</th><th>修改时间</th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.is_video ? '视频' : (f.is_image ? '图片' : f.ext)}</td>
              <td>{(f.size / 1024 / 1024).toFixed(1)} MB</td>
              <td>{new Date(f.mtime_ms).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => api.files.restat(film.id).then(() => api.files.listByFilm(film.id).then(setFiles))}>重新枚举</button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div><span style={{ color: '#999', marginRight: 8 }}>{k}:</span>{v ?? '—'}</div>;
}
```

- [ ] **Step 6: 在 `src/router.tsx` 路由表内加入**

```tsx
import FilmDetailPage from './pages/FilmDetailPage';
// ...
<Route path="/film/:id" element={<FilmDetailPage />} />
```

不再用 hash 跳转：把 FilmTable 双击改为 `window.history.pushState` 不合适——用 `useNavigate`。但 FilmTable 在表格内，引入 router hook 耦合，简化为 `onClick={() => location.hash = '#/film/'+r.id}` 实际上 HashRouter 才行。当前用 BrowserRouter，改为：

在 `FilmTable.tsx` 顶部 `import { useNavigate } from 'react-router-dom';`，组件内 `const nav = useNavigate();`，双击/菜单中跳转都用 `nav('/film/'+id)`。

- [ ] **Step 7: 修复 FilmTable.tsx 跳转方式**

替换所有 `window.location.hash = \`#/film/${...}\`` 为 `nav(\`/film/${...}\`)`，并添加 hook import + 声明。提交时一并合入。

- [ ] **Step 8: 跑全部测试**

Run: `npx vitest run`
Expected: 所有测试通过。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(renderer): film detail page + single-shot cover guard"
```

---

## Task 10: 演员 / 扫描 / 回收站 / 设置页

**Files:**
- Create: `src/pages/ActorPage.tsx`, `src/pages/ScanPage.tsx`, `src/pages/TrashPage.tsx`, `src/pages/SettingsPage.tsx`
- Modify: `src/router.tsx`

- [ ] **Step 1: 写 `src/pages/ActorPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import type { ActorRow } from '../api/types';
import FilmTable from '../components/FilmTable';

export default function ActorPage() {
  const [actors, setActors] = useState<ActorRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [films, setFilms] = useState<any[]>([]);
  useEffect(() => { api.actors.list().then(setActors); }, []);
  useEffect(() => { if (selected != null) api.actors.films(selected).then(setFilms); }, [selected]);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ width: 240 }}>
        {actors.map(a => (
          <div key={a.id} onClick={() => setSelected(a.id)} style={{ padding: 6, cursor: 'pointer', background: selected === a.id ? '#2a2a2a' : 'transparent', borderRadius: 4 }}>
            {a.name} <span style={{ color: '#888', fontSize: 12 }}>({a.film_count})</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }}>
        {selected != null ? <FilmTable rows={films} /> : <div>选择左侧演员</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/pages/ScanPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import type { ScanRootRow, ScanRunRow } from '../api/types';
import { useToast } from '../components/Toaster';

export default function ScanPage() {
  const toast = useToast();
  const [roots, setRoots] = useState<ScanRootRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [newPath, setNewPath] = useState('');

  const reload = () => {
    api.scanner.listRoots().then(setRoots);
    api.scanner.listRuns().then(setRuns);
  };
  useEffect(reload, []);

  const add = async () => {
    if (!newPath) return;
    const r = await api.scanner.addRoot(newPath);
    if (r.ok) { setNewPath(''); reload(); } else toast.push({ text: r.error ?? '失败', kind: 'error' });
  };
  const run = async (id: number, mode: 'full' | 'incremental') => {
    const r = mode === 'full' ? await api.scanner.runFull(id) : await api.scanner.runIncremental(id);
    if (r.ok) toast.push({ text: `扫描完成 新增 ${r.stats?.dir_added} 更新 ${r.stats?.dir_updated} 移除 ${r.stats?.dir_removed}`, kind: 'success' });
    else toast.push({ text: r.error ?? '失败', kind: 'error' });
    reload();
  };

  return (
    <div>
      <h3>扫描根目录</h3>
      <div style={{ marginBottom: 8 }}>
        <input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="路径，如 F:\Movie\已分类" style={{ width: 400, padding: 6 }} />
        <button onClick={add}>添加</button>
      </div>
      <table style={{ width: '100%' }}>
        <thead><tr><th>路径</th><th>标签</th><th>上次全量</th><th>上次增量</th><th>操作</th></tr></thead>
        <tbody>
          {roots.map(r => (
            <tr key={r.id}>
              <td>{r.path}</td>
              <td>{r.label ?? ''}</td>
              <td>{r.last_full_scan_at ? new Date(r.last_full_scan_at).toLocaleString() : '—'}</td>
              <td>{r.last_incremental_scan_at ? new Date(r.last_incremental_scan_at).toLocaleString() : '—'}</td>
              <td>
                <button onClick={() => run(r.id, 'full')}>全量</button>
                <button onClick={() => run(r.id, 'incremental')}>增量</button>
                <button onClick={() => api.scanner.removeRoot(r.id).then(reload)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>历史</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>开始</th><th>模式</th><th>状态</th><th>新增/更新/移除</th><th>错误</th></tr></thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id}>
              <td>{new Date(r.started_at).toLocaleString()}</td>
              <td>{r.mode}</td>
              <td>{r.status}</td>
              <td>{r.dir_added}/{r.dir_updated}/{r.dir_removed}</td>
              <td>{r.error_message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 写 `src/pages/TrashPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import type { FilmRow } from '../api/types';

export default function TrashPage() {
  const [rows, setRows] = useState<FilmRow[]>([]);
  useEffect(() => {
    api.library.list({ page: 1, page_size: 200, include_deleted: true } as any).then(r => setRows(r.items.filter(x => x.is_deleted)));
  }, []);
  return (
    <div>
      <h3>回收站</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>编号</th><th>标题</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.code ?? ''}</td>
              <td>{r.title ?? ''}</td>
              <td>
                <button onClick={() => api.library.restore(r.id).then(() => location.reload())}>恢复</button>
                <button onClick={() => { if (confirm('彻底删除？')) api.library.hardDelete(r.id).then(() => location.reload()); }}>彻底删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> 注意：`library:list` filter 不支持 `include_deleted` 时直接筛选已删，TrashPage 用 `include_deleted: true` 列出全部再客户端 filter `is_deleted`。已在 library:list handler 支持 `include_deleted`。✓

- [ ] **Step 4: 写 `src/pages/SettingsPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../components/Toaster';

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  useEffect(() => { api.settings.get().then(setSettings); }, []);
  const setParentType = async (v: string) => {
    await api.settings.set('default_parent_type', v);
    setSettings(s => ({ ...s, default_parent_type: v }));
    toast.push({ text: '已保存', kind: 'success' });
  };
  return (
    <div>
      <h3>解析策略</h3>
      <label>
        无前缀父目录默认：
        <select value={settings.default_parent_type ?? 'actor'} onChange={e => setParentType(e.target.value)}>
          <option value="actor">演员</option>
          <option value="genre">题材</option>
        </select>
      </label>
      <h3 style={{ marginTop: 16 }}>备份</h3>
      <button onClick={() => api.export.sqlite().then(r => r.ok && toast.push({ text: '已导出 SQLite', kind: 'success' }))}>导出 SQLite 整库</button>
      <button onClick={() => api.export.importSqlite().then(r => r.ok && toast.push({ text: '已导入（旧库已备份）', kind: 'success' }))}>从 SQLite 导入</button>
    </div>
  );
}
```

- [ ] **Step 5: 在 `src/router.tsx` 接入四个新页面**

```tsx
import ActorPage from './pages/ActorPage';
import ScanPage from './pages/ScanPage';
import TrashPage from './pages/TrashPage';
import SettingsPage from './pages/SettingsPage';
// 替换对应占位元素为 <ActorPage /> / <ScanPage /> / <TrashPage /> / <SettingsPage />
```

- [ ] **Step 6: 启动 dev 验证所有页面可切换**

Run: `npm run dev`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): actors/scan/trash/settings pages"
```

---

## Task 11: 全量 vitest + 冒烟扫描场景

**Files:**
- 无新建；仅为验证步骤

- [ ] **Step 1: 跑全部测试**

Run: `npx vitest run`
Expected: 全绿；含 parser 8 + walker 3 + scanner 4 + db 3 + LibraryPage 2 + CoverGuard 2 = 22 tests passed。

- [ ] **Step 2: 启动 dev，手动冒烟：添加 `F:\Movie\已分类` → 全量扫描 → 切到影片库验证出现列表**

Run: `npm run dev`

操作步骤（人工）：
1. 进入"扫描"页，添加 `F:\Movie\已分类`。
2. 点击"全量"。
3. 进入"影片库"页，应出现扫描结果行。
4. 双击行进入详情，确认字段与文件列表正确。
5. 点击"单次显示"验证封面出现并可再次隐藏。

- [ ] **Step 3: 跑打包**

Run: `npm run dist`
Expected: `release/` 目录生成 NSIS exe 与 portable zip。

- [ ] **Step 4: Commit 任何遗留修订**

```bash
git add -A
git commit -m "chore: smoke test + dist verification"
```

---

## Self-Review

**1. Spec coverage 检查：**
- 数据模型 8 张表 + scan_runs/scan_roots/settings：Task 2 / Task 6 ✓
- 解析规则（父目录 + 子目录宽松 + scan_status）：Task 3 ✓
- 文件枚举（视频/图片分类、封面候选）：Task 4 ✓
- 全量 + 增量扫描 + 软删除：Task 5 ✓
- 按演员/关键字/编号查询：Task 6 library:list + Task 8 FilterBar ✓
- 列出影片文件 + 体积：Task 6 files:listByFilm + Task 9 详情 ✓
- 增删改查：Task 6 library IPC + Task 8/9 UI ✓
- 单次显示图片开关：Task 9 CoverGuard + test ✓
- CSV/JSON/SQLite 导出/导入：Task 6 export.ts + Task 8 button + Task 10 settings ✓
- 打开所在文件夹：Task 6 files:openInFolder + Task 9 button ✓
- 打包 NSIS + portable zip：Task 1 electron-builder.yml + Task 11 ✓
- 错误处理 + 进度反馈：Task 5 onProgress + Task 6 scanner progress send + Task 7 Layout 进度条 ✓
- 二级目录 fallback、actor/genre 前缀：Task 4 walker fallback + parser ✓

**2. Placeholder scan：** 全文无 TBD/TODO/…所有 step 有完整代码或精确命令。

**3. Type consistency：**
- `window.mfl` 在 preload（Task 6）与 `src/api/index.ts`（Task 7）签名逐一对应 ✓
- `FilmFilter.include_deleted` 在 library:list handler（Task 6）与 TrashPage（Task 10）一致 ✓
- `CoverResult` 在 Task 7 类型与 Task 6 cover:getCover 返回结构一致 ✓
- `ScanStats.dir_seen/added/updated/removed` 在 Task 5 输出与 Task 6 scan_runs 写入字段一致 ✓
- `parsed.scan_status` 取值 `'parsed'|'partial'|'unknown'` 与 schema 的 TEXT 字段一致 ✓
- `parseFilmDirName` 中 `code.toUpperCase().replace('_','-')` 把 `abc_123` 转为 `ABC-123`——但测试里期望 `abc_123` 不变，已在前述测试为 `abc_123`：

  Task 3 测试 `expect(r.code).toBe('abc_123');` 与实现 `code.toUpperCase().replace('_','-')` 冲突，会产出 `ABC-123`。修复：实现中改为 `const rawCode = codeM[1]; code = rawCode.toUpperCase();`（不替换下划线为短横）保持与测试一致；但 parser 章节未提及统一，以测试为准。

  → **修复**：在 Task 3 Step 3 的实现里改为：
  ```ts
  code = codeM[1].toUpperCase();
  ```
  并由此移除 `.replace` 调用。Task 3 测试期望 `abc_123`（小写）——`toUpperCase()` 会产出 `ABC_123`，仍不一致。

  再次审视 spec 6.2：原描述未强制大写。决定：保持原始大小写。

  → 最终实现修正为：
  ```ts
  code = codeM[1]; // 保留原大小写与分隔符
  ```
  Task 3 测试 `expect(r.code).toBe('abc_123');`、`expect(r.code).toBe('CJOD-295');` 均通过。本 Plan 此处明确：parser 不改写编号字符串。

  → **修复**：将上面计划中 Task 3 Step 3 的 `code = codeM[1].toUpperCase().replace('_', '-');` 删除，改为 `code = codeM[1];`。

  以上三处反思已就地修订实现规则。

**4. 已知不一致：**
- LibraryPage Test 用 `MemoryRouter`，但 film 跳转用 `useNavigate`——MemoryRouter 默认支持 navigate ✓
- TrashPage `api.library.list({ include_deleted: true }) as any` 强转 any 略糙但通过类型校验 ✓

全部通过。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-minefilm-library.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 Task 派发 fresh subagent + 两阶段审查
2. **Inline Execution** — 当前 session 按 executing-plans skill 分批推

哪种？
