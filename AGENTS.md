# AGENTS.md — MineFilmLibrary

Guidance for AI coding agents working on this repository. Follow these rules unless the user explicitly overrides them.

---

## Project purpose

**MineFilmLibrary** is a **local** film-library desktop app:

- **Stack:** Electron 30 + React 18 + Vite + TypeScript + better-sqlite3  
- **Domain:** Scan local movie folders, index by code/title/actor/tag, optional JavBus scrape, export/import SQLite  
- **Not in scope:** Online streaming, mass downloading of media files, supply-chain compromise, or scraping for redistribution

Language of UI and user-facing copy is **Chinese** unless the user asks otherwise. Code identifiers are English.

---

## Critical product constraints

### Image / cover safety (non-negotiable)

1. **Default: do not show cover images** when privacy mode is on (default `privacy_mode=1`).
2. **IPC safety gate:** `cover:getCover` must return `null` unless `opts.display === true`. Never bypass this for “convenience.”
3. **UI:** Show/hide controls may stay the same; only **default load behavior** follows privacy settings. Single-shot display still goes through `{ display: true }` once per user action.
4. Directory image browsing (←/→) is allowed **only after** an explicit display path; still requires `display: true` per fetch.

### Local-first data

- DB lives under Electron `userData`:  
  Windows: `%AppData%\Roaming\mine-film-library\minefilm.sqlite`
- Film rows store **absolute paths**. Migrations of data across machines need re-scan or path alignment; do not invent cloud sync.

### Scrape ethics / ops

- JavBus base URL is **user-configured** (`javbus_base_url`). Do not hardcode illegal mirrors into commits as “the” production host.
- Prefer **Electron `net.fetch`** (system proxy) over Node `fetch` for remote HTTP (Windows proxy is common).
- Sample images (`sample-box` / DMM) often time out — **default sample scrape off** (`scrape_enable_samples=0`); respect settings.

---

## Architecture map

```
electron/                 # Main process (CommonJS via tsc → dist-electron/)
  main.ts                 # App lifecycle, initLogger, openDb, registerAllIpc
  preload.ts              # contextBridge → window.mfl
  db/                     # SQLite open + migrations + queries
  ipc/                    # One module per domain; register in registry.ts
  scanner/                # walkFilmDirs, parseFilmDirName, runScan
  scraper/javbus.ts       # Parse + fetch (lazy require('electron'))
  util/                   # types, logger
src/                      # Renderer (Vite + React)
  api/                    # MflApi types + thin window.mfl access
  pages/                  # Route screens（设置含 settings/* 子面板）
  components/             # FilmTable, FilterBar, CoverGuard, Layout, Toaster
  hooks/                  # Scan/batch progress, etc.
test/                     # vitest (Node env for DB/scanner; jsdom for React)
```

**Sidebar nav:** 影片库 / 演员 / 标签 / 厂商 / 设置. 标签页聚合 `film_tags`（扁平字符串，无独立主表）；厂商页聚合 `films.studio`/`films.label`（制作商+发行商合并去重，显示双角色计数）。Scan and trash live under **设置** tabs (`/settings?tab=scan|trash|privacy|scrape|data`); `/scan` and `/trash` redirect for bookmarks. Global scan/batch progress bars stay in `Layout`.

**IPC surface:** All renderer ↔ main traffic goes through `window.mfl` (preload). Prefer live `const mfl = () => (window as any).mfl` (or typed helper) in components so tests can stub per case; avoid binding `api` once at module load when testability matters.

**Long-running jobs** (scan, batch scrape) must live in the **main process** and emit progress events. Do not hang work on a page’s React state so route changes cancel the job.

---

## Commands (Windows-first)

| Goal | Command |
|------|---------|
| Install | `npm install` |
| Dev (Electron ABI) | `npm run rebuild` then `npm run dev` |
| Unit tests (Node ABI) | `npm rebuild better-sqlite3` then `npm test` |
| Build | `npm run build` |
| Package | `npm run rebuild` && `npm run dist` → `release/` |

### better-sqlite3 ABI dance

| Context | Rebuild |
|---------|---------|
| Electron dev / dist | `npm run rebuild` (`electron-rebuild`) |
| vitest / Node | `npm rebuild better-sqlite3` |

If rebuild fails with EBUSY/EPERM on Windows: kill all `electron.exe` and the Vite port (often 5173), wait, retry.

After **main-process** TypeScript changes, **restart Electron** (Vite HMR does not reload main/preload). Renderer-only changes can HMR.

---

## Database & migrations

- Runtime schema is applied via **numbered migrations** in `electron/db/migrations/`:
  - `0001-init` … `0011-film-studio-label` (chain in `openDb` / `openDbForTest`; current `schema_version=11`)
- `schema.sql` is **documentation/reference only** — do not load it at runtime (packaging).
- New columns: prefer `ALTER TABLE … ADD COLUMN` with existence check; bump `schema_version`.
- Important fields/agents should know:
  - `films.code` — not UNIQUE (dupes allowed); `code_count` maintained after scan
  - `films.scraped_at` — last successful scrape; batch scrape **skips** non-null
  - `films.studio` / `films.label` — 制作商/发行商（javbus 製作商/發行商），字符串列无独立主表；厂商页用 GROUP BY 聚合。0011 迁移会从存量 notes 解析回填这两列并清除原文。
  - `actor_aliases` — alias → canonical actor; scrape/scan must resolve aliases before insert
- Use `upsertActorByName` / `resolveActorIdByName` for actor resolution (exact + case-insensitive alias/name). Do not create a new actor when the scraped name is only an alias of an existing one.
- `convertActorToTag(db, actorId)` / `convertActorToStudio(db, actorId, role)` — 演员 → 标签/厂商（不可逆）：把演员名写入对应字段后 DELETE 演员（CASCADE 清理 film_actors/aliases）。标签用 INSERT OR IGNORE（多对多，不覆盖）；厂商用 UPDATE（单值列 studio/label，**会覆盖**影片原值）。适合「演员」其实是题材/标签/厂商（被错配成演员）的场景。

WAL mode + `foreign_keys=ON`. Tests: use `openDbForTest` + retrying temp-dir cleanup on Windows.

---

## Domain conventions

### Directory naming (scanner)

- Actor/genre parents: often `0-Name` / `1-Theme` (`looksLikeActorOrGenre`)
- Film dirs: code-like prefix and/or `[Tag]` (`looksLikeFilmDir`)
- **Flat root:** when root has no `N-` parents, treat film-like children as films with empty `parent_dir_name`
- Parser keeps **original code casing** in storage; UI may `.toUpperCase()` for display
- Detail heading: if title already contains code, **do not** prefix code again (`formatDetailHeading`)

### Drive letter mapping (盘符映射)

- Setting key `drive_mappings` holds JSON `[{ from: 'F:', to: 'G:' }]`（库盘符 → 真实盘符）。UI 在设置 → 扫描 →「盘符映射」编辑。
- **DB 与 UI 永远只存/显示虚拟（库）盘符**；磁盘访问必须在主进程入口经 `electron/util/driveMap.ts` 的 `virtualToReal` / `realToVirtual` 换算。已接入：`runScan`（真实盘遍历、虚拟盘入库）、`ipc/files.ts`（stat/open/restat/rename/trash）、`ipc/cover.ts`（读图）、`ipc/scrape.ts`（目录判断/写图/restat）。
- 新增任何 `fs` / `shell` 调用如果路径来自 `films.abs_path` / `film_files.abs_path` / `scan_roots.path`，必须先过 `virtualToReal`；扫描/清单结果入库前必须过 `realToVirtual`。无映射时两者都是恒等函数，不影响既有行为。

### Scrape settings (settings table keys)

| Key | Default | Meaning |
|-----|---------|---------|
| `javbus_base_url` | `''` | Site root, no trailing slash |
| `scrape_enable_title` | `1` | Write title |
| `scrape_enable_meta` | `1` | Actors/genres/notes |
| `scrape_enable_cover` | `1` | bigImage download |
| `scrape_enable_samples` | `0` | sample-box images |
| `scrape_film_concurrency` | `6` | Batch film parallelism (1–16) |
| `scrape_sample_concurrency` | `6` | In-film sample parallelism |
| `scrape_image_timeout_ms` | `10000` | Per-image timeout |
| `privacy_mode` | `1` | Cover default-hidden when on |
| `default_parent_type` | `actor` | Ambiguous parent dirs |

Images written under film `abs_path` only if directory exists; **never overwrite** same-named files; restat file list after writes.

### Logging

- Use `electron/util/logger.ts` for main-process scrape/scan diagnostics.
- Files: `userData/logs/mfl-YYYY-MM-DD.log`
- Expose open-log-dir via existing scrape settings UI when adding new long ops.

---

## UI / UX patterns

- **Library list:** URL query is source of truth for `q`, `page`, sort, **and** chip filters (`actors`, `genres`, `tags`, `locales`, …). If you add filters, wire them through `filterFromParams` / `paramsFromFilter` or chips will appear “unclickable.”
- **FilmTable:** column widths/visibility in `localStorage` (`mfl:filmTable.*`); use `tableLayout: 'fixed'` and min widths so short columns don’t render vertically.
- **Detail navigation:** pass `{ from, listIds }` in `location.state` for back + prev/next; keyboard ←/→ must ignore focus in inputs/textarea and while editing/scraping.
- **Actor list scroll:** left pane must be a real overflow container with measured pixel height (parent `#mfl-main-scroll` breaks `%` height). Persist scroll carefully under StrictMode (don’t wipe sessionStorage on first mount before restore).
- **Toasts:** avoid putting toast objects in React effect dependency arrays (re-fetch loops).
- Match existing style: compact dark UI, Chinese labels, minimal new dependencies.

---

## Testing expectations

- Add/adjust vitest for parser, walker, migrations, scrape pure helpers when behavior changes.
- React tests: stub `window.mfl` in `beforeEach` (include new APIs used by the component, e.g. `settings.get`, `cover.listImages`).
- After schema changes, extend `test/db-migration.test.ts` for new tables/columns/version.

---

## Git & repo hygiene

- Do **not** commit: `node_modules/`, `dist*`, `release/`, `.env`, `.zcode/`, large media, user SQLite DBs.
- Prefer small, focused commits with clear messages (feat/fix/chore).
- Do not push secrets; GitHub tokens must never land in source.
- Remote example: `https://github.com/junerver/MineFilmLibrary` (public). Confirm remotes before force-push; never force-push `master` unless the user asks.

---

## Implementation checklist for agents

Before claiming done:

1. [ ] Privacy/cover gate still enforced if you touched covers  
2. [ ] Migrations chain updated for both `openDb` and `openDbForTest`  
3. [ ] Preload + `src/api` types updated for any new IPC  
4. [ ] Long tasks main-process + progress events if multi-page  
5. [ ] `tsc` for `tsconfig.node.json` and `tsconfig.json` clean  
6. [ ] Relevant vitest green under correct better-sqlite3 ABI  
7. [ ] Electron restarted after main/preload changes  
8. [ ] README/AGENTS updated only when user-facing workflows or agent rules change  

---

## What not to do

- Do not remove or weaken `display: true` cover gate  
- Do not load `schema.sql` at runtime  
- Do not run batch scrape only in React state that unmounts on navigation  
- Do not add heavy UI frameworks without need  
- Do not invent network features beyond user-authorized scrape/export  
- Do not commit user library paths or personal scrape logs  

---

## Quick reference — important modules

| Concern | Where |
|---------|--------|
| Scan pipeline | `electron/scanner/index.ts`, `walker.ts`, `parser.ts` |
| Drive letter mapping (盘符映射) | `electron/util/driveMap.ts`（设置键 `drive_mappings`） |
| Actor alias merge | `electron/db/queries.ts` (`upsertActorByName`, `mergeActors`, `convertActorToTag`) |
| Library list/sort/filter | `electron/ipc/library.ts`, `src/pages/LibraryPage.tsx` |
| Cover IPC | `electron/ipc/cover.ts`, `src/components/CoverGuard.tsx` |
| Scrape (writes studio/label) | `electron/ipc/scrape.ts`, `electron/scraper/javbus.ts` |
| Tags (聚合/重命名/合并/删除) | `electron/ipc/tags.ts`, `src/pages/TagPage.tsx` |
| Studios (制作商+发行商聚合) | `electron/ipc/studios.ts`, `src/pages/StudioPage.tsx` |
| Settings (tabs: scan/trash/privacy/scrape/data) | `electron/ipc/settings.ts`, `src/pages/SettingsPage.tsx`, `src/pages/settings/*` |
| Global progress bars | `src/components/Layout.tsx` + scan/batch hooks |

When unsure, prefer matching existing patterns in these files over introducing parallel abstractions.
