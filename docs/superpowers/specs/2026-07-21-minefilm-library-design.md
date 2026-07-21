# MineFilmLibrary 设计文档

- 日期：2026-07-21
- 状态：设计待审核
- 作者：brainstorming with user

## 1. 目标与范围

构建一个本地影片库档案管理桌面工具，用于：

- 对用户指定的根目录（如 `F:\Movie\已分类`）进行扫描，按统一命名规则解析每个影片子目录，将解析结果存入本地 SQLite 数据库。
- 提供按演员、关键字、影片编号等查询能力；列出影片目录里的实际文件与体积。
- 影片刮削后的数据支持增删改查。
- 提供美观易用的桌面 UI，默认隐藏图片预览以避免 NSFW 内容外泄；图片显示开关仅单次有效。

范围外：联网刮削（不主动从公网站点获取元数据）、自动播放、批量下载封面、多用户/远程访问。

## 2. 关键决策（来自澄清问题）

| 决策点 | 选择 |
|---|---|
| 前端框架 | React + Vite + TypeScript |
| 目录名解析 | 宽松解析，能取多少取多少，未命中的字段留空，不阻塞扫描 |
| 扫描策略 | 全量重扫 + 增量扫描均支持（UI 暴露两个入口） |
| 演员采集 | 默认取父目录名作为演员名；父目录名以 `1-` 开头时视为题材，演员留空，后续手动填充 |
| 封面图片 | 三种来源均支持：本地路径、手动上传、（未来）联网；UI 默认不显示图片，单次开关仅当前会话有效 |
| 导出能力 | CSV/JSON 导出 + SQLite 文件整库导出/导入 |
| 打开文件 | 调用系统资源管理器在所在文件夹中打开 |
| 打包 | electron-builder（NSIS + portable zip） |

## 3. 技术栈

- Electron 30+
- React 18 + Vite + TypeScript
- better-sqlite3（主进程同步访问 SQLite）
- electron-builder + electron-rebuild
- 渲染层 UI：自绘组件（轻量 Tailwind 风格 utility），不引入大型组件库以保持视觉可控
- 表格：@tanstack/react-table（无样式，可控）

## 4. 项目结构

```
MineFilmLibrary/
├─ package.json
├─ tsconfig.json
├─ tsconfig.node.json
├─ vite.config.ts
├─ electron-builder.yml
├─ electron/
│  ├─ main.ts                # 入口：创建窗口、注册 IPC
│  ├─ preload.ts             # contextBridge 暴露受控 API
│  ├─ db/
│  │  ├─ index.ts            # better-sqlite3 单例 + 迁移
│  │  ├─ schema.sql
│  │  └─ migrations/
│  ├─ scanner/
│  │  ├─ parser.ts           # 子目录名 → 字段
│  │  ├─ walker.ts           # fs 遍历 + mtime 比对
│  │  └─ index.ts
│  ├─ ipc/
│  │  ├─ library.ts          # 影片 CRUD/查询
│  │  ├─ actors.ts
│  │  ├─ scanner.ts
│  │  ├─ files.ts
│  │  └─ export.ts
│  └─ util/
└─ src/                      # 渲染进程 React
   ├─ main.tsx
   ├─ App.tsx
   ├─ pages/
   │  ├─ LibraryPage.tsx
   │  ├─ ActorPage.tsx
   │  ├─ ScanPage.tsx
   │  ├─ FilmDetailPage.tsx
   │  └─ SettingsPage.tsx
   ├─ components/
   ├─ hooks/
   ├─ api/
   └─ styles/
```

## 5. 数据模型

### 5.1 表结构

**`actors`** — 演员档案
- `id` INTEGER PK AUTOINCREMENT
- `name` TEXT UNIQUE NOT NULL  —— 从父目录名去掉前缀后得到
- `raw_dir_name` TEXT  —— 父目录原名，例如 `0-Julia`
- `category` TEXT  —— 可选分类备注
- `created_at` / `updated_at`

**`genres`** — 题材
- `id` INTEGER PK AUTOINCREMENT
- `name` TEXT UNIQUE NOT NULL  —— 父目录 `1-XXX` 取 `XXX`，用户也可手动新增
- `created_at`

**`films`** — 影片档案
- `id` INTEGER PK AUTOINCREMENT
- `code` TEXT  —— 影片编号，如 `CJOD-295`，可空
- `title` TEXT  —— 解析出的影片名，可空
- `raw_dir_name` TEXT NOT NULL  —— 子目录原名，去重与诊断用
- `abs_path` TEXT UNIQUE NOT NULL  —— 子目录绝对路径
- `parent_dir_name` TEXT NOT NULL  —— 父目录名
- `parent_type` TEXT  —— `actor` 或 `genre`（由前缀判断）
- `locale` TEXT  —— `C`/`U`/null，源自 `-C` / `-U` 后缀
- `tags` TEXT  —— 自定义标签拼接字符串，例如 `FHD,4K`；同时存到 `film_tags` 表
- `cover_path` TEXT  —— 子目录内识别到的本地封面文件相对路径
- `cover_blob_id` INTEGER  —— 上传封面的 blob 引用，见 `cover_blobs`
- `notes` TEXT  —— 用户备注
- `scan_status` TEXT  —— `parsed` / `partial` / `unknown`，表示解析完整度
- `fs_mtime_ms` INTEGER  —— 子目录 mtime，用于增量扫描
- `is_deleted` INTEGER DEFAULT 0  —— 软删除标记
- `created_at` / `updated_at`

**`film_actors`** — 影片-演员多对多
- `film_id` INTEGER → `films.id`
- `actor_id` INTEGER → `actors.id`
- PK(film_id, actor_id)

**`film_genres`** — 影片-题材多对多
- `film_id` / `genre_id`，PK 复合

**`film_tags`** — 影片-标签多对多
- `tag` TEXT  —— 直接以字符串为 PK，免去 `tags` 表
- `film_id` INTEGER
- PK(tag, film_id)

**`film_files`** — 子目录下的实际文件
- `id` INTEGER PK
- `film_id` INTEGER
- `rel_path` TEXT  —— 相对影片子目录的路径
- `abs_path` TEXT
- `name` TEXT  —— 文件名
- `ext` TEXT
- `size` INTEGER  —— 字节
- `is_video` INTEGER  —— 命中视频扩展名集合
- `is_image` INTEGER  —— 命中图片扩展名集合（用于自动选封面）
- `mtime_ms` INTEGER
- `created_at`

**`cover_blobs`** — 上传的封面图缓存
- `id` INTEGER PK
- `mime` TEXT
- `data` BLOB
- `created_at`

**`scan_roots`** — 扫描根目录配置
- `id` INTEGER PK
- `path` TEXT UNIQUE NOT NULL
- `label` TEXT
- `last_full_scan_at` INTEGER
- `last_incremental_scan_at` INTEGER
- `enabled` INTEGER DEFAULT 1

**`scan_runs`** — 扫描历史
- `id` INTEGER PK
- `root_id` INTEGER
- `mode` TEXT  —— `full` / `incremental`
- `started_at` / `finished_at` INTEGER
- `dir_seen` / `dir_added` / `dir_updated` / `dir_removed` INTEGER
- `status` TEXT  —— `running` / `done` / `error`
- `error_message` TEXT

### 5.2 索引

- `films(code)` `films(parent_dir_name)` `films(abs_path)` `films(scan_status)`
- `film_files(film_id)` `film_files(abs_path)`
- `film_actors(actor_id)` `film_genres(genre_id)` `film_tags(tag)`

### 5.3 软删除策略

物理移动/删除的影片在增量扫描时打 `is_deleted=1` 而非物理删除，保护用户误删。UI 默认隐藏 `is_deleted=1`，提供"回收站"视图查看与彻底删除。

## 6. 目录名解析规则

### 6.1 父目录

- 形如 `0-Julia`、`2-Maria`：前缀数字+短横，`parent_type=actor`，演员名取去掉前缀后的部分。
- 形如 `1-剧情`、`1-年輕妻`：以 `1-` 开头，`parent_type=genre`，题材名取 `1-` 后内容。
- 无前缀：若用户在 settings 中将该根目录标记为"演员优先"则按演员解析，否则 `parent_type` 留空，演员与题材均不自动填，待人工修正。

### 6.2 子目录名解析

期望格式：
```
<编号> [-C|-U] [标签1] [标签2] ... <影片名>
```
例如 `CJOD-295-C [FHD] 闲暇的人妻 ... JULIA`

解析步骤（按 token 推进，宽松匹配）：

1. 编号：从开头取一段匹配正则 `^([A-Z]+[-_]?[0-9]+)` 的子串，不区分大小写、接受 `-` 或 `_`。取不到则留空。
2. 后缀修饰 `-C` / `-U`：编号之后若紧跟 `-C`/`-U`（大小写不敏感），记到 `locale`；多个修饰可连续出现但只取首个。
3. 标签：跳过分隔空格后，循环匹配 `\[[^\]]+\]` 抽取标签内容（不带括号），直到不再匹配。
4. 影片名：标签之后剩余的字符串（去首尾空格）作为标题。
5. `scan_status`：
   - 三项都有 → `parsed`
   - 编号或标题任一缺失 → `partial`
   - 全空 → `unknown`
   解析失败不抛错，原串仍入库。

### 6.3 文件枚举

进入每个影片子目录，递归列出文件（最深 3 层），按扩展名集合分类：
- 视频：`.mp4 .mkv .avi .wmv .mov .m4v .iso .rmvb .ts`
- 图片：`.jpg .jpeg .png .webp .gif`

封面候选：图片文件中体积最大者，记录相对路径到 `cover_path`。

## 7. 扫描流程

### 7.1 全量扫描

1. 遍历根目录下的二级目录（一级是演员/题材，二级是影片）。若某个一级目录下未发现任何符合"编号+可选后缀+标签+标题"的子目录，则把该一级目录当作章节性目录或层级缺失，尝试再往下一级解析作为兜底。
2. 对每个影片子目录：解析父目录、解析子目录名、枚举文件、选封面候选、upsert 到 `films` / `film_files` / `film_actors` / `film_genres` / `film_tags`。
3. 对比 abs_path 集合：原库中存在但本次未扫到的目录 → `is_deleted=1`。
4. 写 `scan_runs` 记录统计。

### 7.2 增量扫描

- 取上次扫描的 `fs_mtime_ms`，仅处理 mtime 变化或本次新出现的子目录。
- 删除判定同全量：未出现且未变更 → 软删除。
- 文件枚举只对 changed/new 子目录重做。

### 7.3 进度反馈

主进程通过 `webContents.send('scan:progress', { stage, current, total, currentPath })` 推送进度，渲染进程用 hook 订阅展示进度条与当前路径。

## 8. IPC API

通过 `contextBridge` 暴露 `window.mfl`，按域分组：

```ts
window.mfl.library.list(filter)        // 分页/筛选/排序
window.mfl.library.get(id)
window.mfl.library.create(payload)
window.mfl.library.update(id, patch)
window.mfl.library.softDelete(id)
window.mfl.library.hardDelete(id)
window.mfl.library.restore(id)

window.mfl.actors.list()
window.mfl.actors.create / update / delete
window.mfl.actors.films(actorId)

window.mfl.genres.list / create / delete

window.mfl.scanner.listRoots()
window.mfl.scanner.addRoot(path)
window.mfl.scanner.removeRoot(id)
window.mfl.scanner.runFull(rootId)
window.mfl.scanner.runIncremental(rootId)
window.mfl.scanner.listRuns()
window.mfl.scanner.onProgress(cb)      // 订阅

window.mfl.files.listByFilm(filmId)
window.mfl.files.openInFolder(filmId)  // 调 shell.openPath
window.mfl.files.restat(filmId)        // 重新枚举并刷 size/mtime

window.mfl.cover.getCover(filmId, { display: true })  // 仅当本次会话 display 开关打开时返回 blob/path，否则返回 null
window.mfl.cover.upload(filmId, file)
window.mfl.cover.clear(filmId)

window.mfl.export.csv(filter)
window.mfl.export.json(filter)
window.mfl.export.sqlite(destPath)
window.mfl.import.sqlite(srcPath)      // 覆盖当前库（先备份）

window.mfl.settings.get() / set(patch)
```

封面单次显示开关：渲染进程在内存中维护 `sessionDisplayImage: boolean`，点击"显示图片"按钮临时置为 true；调用 `cover.getCover` 时携带该值，主进程若未收到 true 则不返回任何二进制。每次调用后立即复位为 false，避免遗忘。

## 9. UI 设计

### 9.1 整体布局

左侧侧边导航 + 顶部条 + 主内容区。
- 侧边导航：影片库 / 演员 / 扫描 / 回收站 / 设置
- 顶部条：全局搜索框（编号/标题关键字/演员）、显示图片单次按钮、扫描进度条（运行时）

### 9.2 影片库页

- 主体为表格：编号 / 标题 / 演员 / 题材 / 标签 / 后缀 / 文件体积合计 / 状态 / 修改时间。
- 左上筛选区：演员多选、题材多选、标签多选、locale 多选、状态多选、扫描根多选。
- 表格行右键菜单：打开所在文件夹 / 编辑 / 软删除 / 详情。
- 表格行双击进入详情页。
- 顶部 toolbar：导出 CSV / 导出 JSON / 新建影片（手工）。

### 9.3 详情页

- 上方元数据卡片：编号、标题、locale、标签（chip）、演员 chip、题材 chip、备注、所在路径、状态。
- 单次"显示封面"按钮，点击后该次会展示并立即复位。
- 下方文件列表表格：文件名 / 扩展名 / 体积 / 修改时间 / 类型；"重新枚举"按钮调用 `files.restat`。
- 编辑按钮进入表单模式，所有字段可改，保存调 `library.update`。

### 9.4 演员页

- 左侧演员列表（带影片数）；右侧选中演员的影片表格（复用影片库表格组件）。
- 演员 CRUD：新增、改名、删除（删除时影片关联解除，影片保留）。

### 9.5 扫描页

- 显示已配置的扫描根列表，可增删。
- 每个根目录单按钮"全量扫描" / "增量扫描"。
- 进行中：进度条 + 当前路径 + 已新增/更新/移除计数。
- 下方扫描历史表格：时间 / 模式 / 状态 / 统计。

### 9.6 设置页

- 数据库文件路径展示（不可改，仅展示位置）。
- 默认父目录解析策略：演员优先 / 题材优先（影响无前缀目录的默认 parent_type）。
- "重置图片显示开关" 不可恢复说明（每次单次有效，故无需手动重置）。
- 备份/恢复：导出 SQLite / 导入 SQLite。

### 9.7 视觉约束

- 默认所有图片位置以占位符（如 `[cover hidden]` 或灰色块）呈现。
- 仅详情页与影片库行缩略图位置有图片显示意图；点击"单次显示"按钮后渲染一次图片并立即恢复隐藏。
- 任何路径下不主动展示任何外部 URL 图片。

## 10. 错误处理与日志

- 主进程所有 IPC handler 用 try/catch 包裹，失败返回 `{ error: { code, message } }`，渲染层统一弹 toast。
- 扫描单目录异常不影响整体，记入该影片 `scan_status=unknown` 并在 scan_runs 的 error_message 累计。
- 日志写入 `app.getPath('userData')/logs/mfl.log`，按天滚动，便于排查。

## 11. 测试策略

- 解析器单测：覆盖三类父目录前缀 + 至少 12 个子目录样本（含无编号、多标签、连续后缀、空标题）。
- 扫描器集成测试：mock fs，验证 upsert/软删除/计数。
- DB 层用临时文件 SQLite 实例跑全量 schema migration。
- 渲染层关键页面用 vitest + testing-library 跑交互测试：列表筛选、详情编辑、单次图片开关的复位时序。
- 暂不做 E2E（playwright 可后续补）。

## 12. 打包与分发

- `electron-builder`：Windows NSIS installer（per-machine）+ portable zip。
- `asar.unpack` better-sqlite3 的 native `.node` 文件。
- CI（可选）：GitHub Actions 跑 `npm ci && npm run rebuild && npm run dist`。

## 13. 里程碑

1. 项目骨架 + Electron+Vite 跑通空白窗口。
2. DB schema + 迁移 + 单元封装。
3. 解析器 + 文件枚举 + 单测。
4. 全量/增量扫描器 + IPC。
5. 影片/演员/题材 CRUD + 列表查询。
6. 渲染层页面（影片库 / 详情 / 演员 / 扫描 / 设置）。
7. 单次图片开关、CSV/JSON/SQLite 导入导出。
8. 打包与冒烟测试。
