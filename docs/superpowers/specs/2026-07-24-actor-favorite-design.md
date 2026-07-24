# 演员收藏（星标）设计

日期：2026-07-24
状态：已定稿（方案 A）

## 目标

演员页选中演员后，右侧信息区可星标收藏；收藏的演员在左侧列表默认置顶，并在名称旁显示 ★。

## 范围

- 仅影响演员页列表排序与星标展示
- 不改库列表筛选/联想
- 不支持拖拽排序、收藏时间排序

## 数据

- 迁移 `0007-actor-favorite`：`actors.is_favorite INTEGER NOT NULL DEFAULT 0`
- `schema_version = 7`
- 挂到 `openDb` / `openDbForTest`
- `schema.sql` 仅文档同步

## 排序

- `actors:list`：`ORDER BY is_favorite DESC, name ASC`
- 左侧搜索过滤后保持该相对顺序（`filter` 保序）

## IPC / API

- `actors:list` 返回 `is_favorite`
- `actors:setFavorite(id, favorite: boolean)` 切换收藏并更新 `updated_at`
- `ActorRow.is_favorite: number`（0/1）

## UI

- 右侧标题行：星标按钮（★/☆），点击切换
- 左侧列表：`is_favorite=1` 时名称前/旁显示 ★
- 切换后刷新列表（或本地更新后按同一规则重排）

## 合并

- `mergeActors(from → to)`：`to.is_favorite = max(from, to)`（任一收藏则保留）

## 测试

- 迁移 0007：列存在、默认 0、version=7
- merge：from 收藏 → to 变为收藏
- ActorPage：星标调用 `setFavorite`，列表显示 ★
