# MineFilmLibrary

本地影片库桌面工具（Electron + React + SQLite）。

扫描本地影片目录（演员/题材父目录 + 番号命名），建立可检索库；支持演员别名、重复编号标注、JavBus 刮削、CSV/JSON/SQLite 导出导入。

**安全约束：** 封面默认不显示；显示开关仅单次有效。

---

## 功能概览

| 模块 | 能力 |
|------|------|
| 影片库 | 搜索、筛选、分页、编号/演员排序、批量 JavBus 刮削 |
| 详情 | 编辑元数据、多演员、同编号多路径、JavBus 单片刮削 |
| 演员 | 元数据/别名、列表搜索、滚动位置保持 |
| 设置 | 分 Tab：扫描（根目录/历史/解析策略/自动包装裸视频）、回收站、隐私、JavBus 刮削、数据备份 |

---

## 环境要求

- **Node.js** 20+（推荐 LTS）
- **Windows 10/11**（当前主要验证平台）
- 原生依赖 **better-sqlite3** 需编译环境：
  - Windows：Visual Studio Build Tools + Python 3（`node-gyp`）

---

## 快速开始（开发）

```bash
# 克隆后进入项目
cd MineFilmLibrary

# 安装依赖
npm install

# 为 Electron 编译 better-sqlite3（开发启动前必须）
npm run rebuild

# 启动：Vite(5199) + Electron
npm run dev
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（渲染进程 Vite + 主进程 tsc 后启动 Electron） |
| `npm run build` | 仅构建：`dist-renderer` + `dist-electron` |
| `npm run rebuild` | `electron-rebuild` 编译 better-sqlite3（Electron ABI） |
| `npm rebuild better-sqlite3` | 切回 **Node ABI**（跑 vitest 前） |
| `npm test` | 单元测试（需 Node ABI 的 better-sqlite3） |
| `npm run dist` | 完整构建 + electron-builder 打包到 `release/` |

### ABI 切换说明

| 场景 | 需要的 better-sqlite3 |
|------|----------------------|
| `npm run dev` / 打包 | Electron ABI → `npm run rebuild` |
| `npm test` | Node ABI → `npm rebuild better-sqlite3` |

若出现 `NODE_MODULE_VERSION` 不匹配，按上表重新编译即可。  
Windows 上若文件被 Electron 占用导致 rebuild 失败，先关掉应用再编译。

---

## 数据库位置

运行时 SQLite 文件在 Electron **userData** 目录：

| 环境 | 路径 |
|------|------|
| Windows 开发/安装包 | `%AppData%\Roaming\mine-film-library\minefilm.sqlite` |
| 完整示例 | `C:\Users\<用户名>\AppData\Roaming\mine-film-library\minefilm.sqlite` |

同目录常见文件：

```
mine-film-library/
├── minefilm.sqlite          # 主库
├── minefilm.sqlite-wal      # WAL 日志（运行中可能存在）
├── minefilm.sqlite-shm
├── logs/                    # 应用日志（刮削等）
│   └── mfl-YYYY-MM-DD.log
└── ...                      # Electron 缓存等
```

代码中路径由 `electron/db/index.ts` 的 `getDbPath()` 决定：

```ts
path.join(app.getPath('userData'), 'minefilm.sqlite')
```

> 注意：库中存的是影片 **绝对路径**。换电脑后若盘符/目录不同，需重新扫描或改路径，否则「打开文件夹」与封面文件路径可能失效。库内元数据（标题、演员、标签等）仍可迁移。

---

## 备份与迁移到其他电脑

### 方式一：应用内导出 / 导入（推荐）

1. **原电脑**  
   - 打开 **设置 → 数据**  
   - **导出 SQLite 整库** → 保存为例如 `minefilm-backup.sqlite`  
   - 将文件拷到 U 盘/网盘  

2. **新电脑**  
   - 安装/运行同一版本的 MineFilmLibrary  
   - **设置 → 数据 → 从 SQLite 导入** → 选择备份文件  
   - 导入前会自动把当前库备份为 `minefilm.sqlite.preimport.bak`  

对应 IPC：`export:sqlite`（`better-sqlite3` 的 `backup`）、`import:sqlite`。

### 方式二：直接复制数据库文件

1. **完全退出** MineFilmLibrary（避免 WAL 未合并）。  
2. 复制：

   ```
   %AppData%\Roaming\mine-film-library\minefilm.sqlite
   ```

   若存在且应用已关闭，也可一并复制：

   ```
   minefilm.sqlite-wal
   minefilm.sqlite-shm
   ```

   更稳妥：关闭应用后用系统复制，或只用应用内「导出 SQLite」（会生成一致快照）。

3. 在新电脑安装应用并运行一次（生成 userData 目录）。  
4. 退出应用后，用备份覆盖：

   ```
   %AppData%\Roaming\mine-film-library\minefilm.sqlite
   ```

5. 再启动应用。

### 方式三：仅导出列表（非完整库）

- **导出 CSV / JSON**：便于表格/归档，**不能**完整还原演员别名、扫描根、封面 blob 等。  
- 完整迁移请用 **SQLite 导出/导入**。

### 迁移检查清单

- [ ] 新电脑安装相同或更新版本（库会自动跑 schema 迁移）  
- [ ] 已导入 SQLite 或覆盖 `minefilm.sqlite`  
- [ ] 影片文件盘符若变化：在 **设置 → 扫描** 中重新添加根目录并扫描  
- [ ] （可选）**设置 → 刮削** 重新配置 **JavBus 站点地址**  
- [ ] （可选）复制 `logs/` 便于对照历史刮削日志  

---

## 构建与打包

### 仅编译（不装安装包）

```bash
npm run rebuild          # Electron 用 native 模块
npm run build            # vite → dist-renderer；tsc → dist-electron
```

产物：

- `dist-renderer/` — 前端  
- `dist-electron/` — 主进程 / preload  

### 打 Windows 安装包 / 便携包

```bash
npm run rebuild
npm run dist
```

`electron-builder` 配置见 `electron-builder.yml`：

| 项 | 值 |
|----|-----|
| appId | `io.github.minefilm.library` |
| productName | `MineFilmLibrary` |
| 输出目录 | `release/` |
| 目标 | NSIS 安装包 + zip 便携包 |
| asarUnpack | `better-sqlite3` 原生 `.node` |

成功后常见产物：

```
release/
├── MineFilmLibrary Setup x.x.x.exe   # NSIS 安装程序
└── MineFilmLibrary-x.x.x-win.zip     # 便携版
```

NSIS：`oneClick: false`，可改安装目录，`perMachine: true`。

---

## 测试

```bash
# 测试前切到 Node ABI
npm rebuild better-sqlite3
npm test

# 测完若要继续 dev，再切回 Electron ABI
npm run rebuild
```

---

## 目录结构（简要）

```
MineFilmLibrary/
├── electron/           # 主进程
│   ├── db/             # SQLite、迁移、查询
│   ├── ipc/            # IPC（library / scanner / scrape / export …）
│   ├── scanner/        # 目录遍历与解析
│   ├── scraper/        # JavBus 刮削
│   ├── util/           # logger 等
│   ├── main.ts
│   └── preload.ts
├── src/                # React 渲染进程
│   ├── pages/
│   ├── components/
│   └── api/
├── test/               # vitest
├── docs/               # 设计/计划文档
├── electron-builder.yml
└── package.json
```

---

## 日志

刮削与主进程关键步骤写入：

```
%AppData%\Roaming\mine-film-library\logs\mfl-YYYY-MM-DD.log
```

应用内：**设置 → 刮削 → 打开日志目录 / 显示日志路径**。

---

## 常见问题

**Q: `better_sqlite3.node` 版本错误？**  
A: 按场景执行 `npm run rebuild`（Electron）或 `npm rebuild better-sqlite3`（Node 测试）。

**Q: 换电脑后列表有数据但打不开文件夹？**  
A: 库里是旧绝对路径。把影片放到相同路径，或重新扫描新路径。

**Q: JavBus 刮削超时？**  
A: 主进程走系统代理；确认本机代理可用。预览图在 `pics.dmm.co.jp` 可能单独超时，元数据仍可能写入。详见日志。

**Q: 开发时 5199 端口被占用？**  
A: 本项目开发端口为 5199（避开 Vite 默认 5173）。被占用时关掉残留的 `node`/`electron` 进程后再 `npm run dev`。

---

## 许可与声明

- 仅供个人本地媒体管理与技术学习。  
- 请遵守当地法律与站点服务条款；刮削功能需自行配置合法可用的站点地址。  
- 项目不包含、不传播任何受版权保护的媒体内容。
