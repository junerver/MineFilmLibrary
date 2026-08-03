import { ipcMain } from 'electron';
import { getDb } from '../db';
import { tx } from '../db/dao';
import type { FilmRow } from '../util/types';

// 标签 IPC。
// 标签在 DB 中是扁平字符串（film_tags 表，无独立 tags 主表），所以：
//   - 标签列表聚合复用现有 genres:allTags（返回 {tag, count}[]）。
//   - 这里只提供按标签查影片、重命名、合并、删除四个操作。
export function registerTagIpc() {
  // 取带某标签的全部未删除影片（带 actors_names 拼接，与 library:list 一致）。
  ipcMain.handle('tags:films', (_e, tag: string) => {
    const db = getDb();
    return db.prepare(
      `SELECT films.*,
        COALESCE((SELECT GROUP_CONCAT(a.name, '、') FROM film_actors fa JOIN actors a ON a.id=fa.actor_id WHERE fa.film_id=films.id), '') AS actors_names
        FROM films
        WHERE is_deleted=0
          AND id IN (SELECT film_id FROM film_tags WHERE tag=?)
        ORDER BY code`,
    ).all(tag) as FilmRow[];
  });

  // 重命名标签：UPDATE film_tags SET tag=? WHERE tag=?
  // PK (tag, film_id) 在新旧同名时可能冲突，但 SQLite UPDATE 对整批逐行处理，
  // 已存在同 film_id+新tag 的行会被 OR 等价跳过（这里用先 INSERT IGNORE 再 DELETE 兜底更安全）。
  // 为稳妥走「合并到新名 + 删除旧名」路径。
  ipcMain.handle('tags:rename', (_e, from: string, to: string) => {
    const db = getDb();
    const next = (to ?? '').trim();
    if (!next) throw new Error('新标签名不能为空');
    if (next === from) return true;
    return tx(db, () => {
      db.prepare(
        'INSERT OR IGNORE INTO film_tags(tag, film_id) SELECT ?, film_id FROM film_tags WHERE tag=?',
      ).run(next, from);
      db.prepare('DELETE FROM film_tags WHERE tag=?').run(from);
      return true;
    });
  });

  // 合并标签：from → to（与重命名同实现；语义上 from 是被并入的源标签）。
  ipcMain.handle('tags:merge', (_e, from: string, to: string) => {
    const db = getDb();
    const target = (to ?? '').trim();
    if (!target) throw new Error('目标标签名不能为空');
    if (target === from) return true;
    return tx(db, () => {
      db.prepare(
        'INSERT OR IGNORE INTO film_tags(tag, film_id) SELECT ?, film_id FROM film_tags WHERE tag=?',
      ).run(target, from);
      db.prepare('DELETE FROM film_tags WHERE tag=?').run(from);
      return true;
    });
  });

  // 删除标签：从所有影片移除该标签（影片本身保留）。
  ipcMain.handle('tags:delete', (_e, tag: string) => {
    const db = getDb();
    db.prepare('DELETE FROM film_tags WHERE tag=?').run(tag);
    return true;
  });
}
