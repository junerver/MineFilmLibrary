import { ipcMain } from 'electron';
import { getDb } from '../db';
import { tx } from '../db/dao';
import type { FilmRow, StudioAggRow } from '../util/types';

// 厂商 IPC。
// 厂商名直接以字符串存于 films.studio（制作商）/ films.label（发行商），不建独立主表
// （与现有 tag 的扁平字符串设计一致）。本模块提供：
//   - list：制作商+发行商合并去重，带各角色影片计数
//   - films：按厂商名+角色查影片
//   - rename：重命名某角色下的厂商名（合并即改名）
//   - delete：清除某厂商在某角色下的标记（影片保留）
export function registerStudioIpc() {
  // 合并去重 + 双角色计数。
  // 把所有 studio/label 行 UNION 成 (name, is_studio, is_label) 标记，再按 name 聚合。
  ipcMain.handle('studios:list', () => {
    const db = getDb();
    return db.prepare(
      `SELECT name,
          SUM(is_studio) AS as_studio_count,
          SUM(is_label)  AS as_label_count
       FROM (
          SELECT studio AS name, 1 AS is_studio, 0 AS is_label
            FROM films WHERE studio IS NOT NULL AND is_deleted=0
          UNION ALL
          SELECT label AS name, 0, 1
            FROM films WHERE label IS NOT NULL AND is_deleted=0
       )
       GROUP BY name
       ORDER BY name`,
    ).all() as StudioAggRow[];
  });

  // 按厂商名 + 角色查影片。role: 'studio' | 'label' | 'any'。
  ipcMain.handle('studios:films', (_e, name: string, role: 'studio' | 'label' | 'any') => {
    const db = getDb();
    const where = role === 'studio'
      ? 'studio=?'
      : role === 'label'
        ? 'label=?'
        : '(studio=? OR label=?)';
    const args = role === 'any' ? [name, name] : [name];
    return db.prepare(
      `SELECT films.*,
        COALESCE((SELECT GROUP_CONCAT(a.name, '、') FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=films.id), '') AS actors_names
        FROM films
        WHERE is_deleted=0 AND ${where}
        ORDER BY code`,
    ).all(...args) as FilmRow[];
  });

  // 重命名：把某角色下的「旧名」整体改为「新名」。
  // role: 'studio' | 'label'。同名合并即多次对同一新名执行（天然去重，因列是单值）。
  ipcMain.handle('studios:rename', (_e, from: string, to: string, role: 'studio' | 'label') => {
    const db = getDb();
    const target = (to ?? '').trim();
    if (!target) throw new Error('新厂商名不能为空');
    const col = role === 'studio' ? 'studio' : 'label';
    return tx(db, () => {
      db.prepare(`UPDATE films SET ${col}=? WHERE ${col}=?`).run(target, from);
      return true;
    });
  });

  // 删除厂商标记：把某角色下的该厂商名清空（置 NULL），影片本身保留。
  ipcMain.handle('studios:delete', (_e, name: string, role: 'studio' | 'label') => {
    const db = getDb();
    const col = role === 'studio' ? 'studio' : 'label';
    db.prepare(`UPDATE films SET ${col}=NULL WHERE ${col}=?`).run(name);
    return true;
  });
}
