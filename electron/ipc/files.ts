import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, shell } from 'electron';
import { getDb } from '../db';
import { listFilmFiles } from '../scanner/walker';
import { replaceFilmFiles } from '../db/queries';
import { nowMs, tx } from '../db/dao';
import {
  canRenameParentDir,
  isPathStrictlyUnder,
  isPathUnderOrEqual,
  parentAbsOfFilm,
  pathKey,
  replacePathPrefix,
  validateDirName,
} from '../util/pathOps';
import { loadDriveMappings, realToVirtual, virtualToReal } from '../util/driveMap';

type OpResult =
  | { ok: true; filmAbsPath?: string; parentAbsPath?: string; updatedFilms?: number; updatedFiles?: number }
  | { ok: false; error: string };

// 盘符映射：库内存的是虚拟盘符，磁盘访问统一在此换算。
function toRealPath(p: string): string {
  return virtualToReal(p, loadDriveMappings(getDb()));
}
function toVirtualPath(p: string): string {
  return realToVirtual(p, loadDriveMappings(getDb()));
}

async function assertDirExists(abs: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(abs);
    if (!st.isDirectory()) return '路径不是目录';
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return '路径不存在';
    return '路径无法访问';
  }
}

async function assertTargetFree(target: string): Promise<string | null> {
  try {
    await fs.promises.access(target);
    return '目标名称已存在';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    return '无法检查目标路径';
  }
}

function rewriteFilmRowsUnderPrefix(oldPrefix: string, newPrefix: string, parentDirName?: string): { updatedFilms: number; updatedFiles: number } {
  const db = getDb();
  const now = nowMs();
  // 取出所有可能受影响的影片（含软删除），用 JS 做 pathKey 匹配，避免 Windows 大小写问题。
  const films = db.prepare('SELECT id, abs_path, parent_dir_name, raw_dir_name FROM films').all() as {
    id: number;
    abs_path: string;
    parent_dir_name: string;
    raw_dir_name: string;
  }[];

  const affected = films.filter(f => isPathUnderOrEqual(f.abs_path, oldPrefix));
  if (affected.length === 0) return { updatedFilms: 0, updatedFiles: 0 };

  // 目标 abs_path 冲突预检（与库内其他行）
  const existingKeys = new Map(films.map(f => [pathKey(f.abs_path), f.id]));
  for (const f of affected) {
    const nextAbs = replacePathPrefix(f.abs_path, oldPrefix, newPrefix);
    const key = pathKey(nextAbs);
    const other = existingKeys.get(key);
    if (other != null && other !== f.id) {
      throw new Error(`库内路径冲突: ${nextAbs}`);
    }
  }

  const updFilm = db.prepare(
    `UPDATE films SET abs_path=?, parent_dir_name=?, raw_dir_name=?, updated_at=? WHERE id=?`,
  );
  const listFiles = db.prepare('SELECT id, abs_path FROM film_files WHERE film_id=?');
  const updFile = db.prepare('UPDATE film_files SET abs_path=? WHERE id=?');

  let updatedFiles = 0;
  tx(db, () => {
    for (const f of affected) {
      const nextAbs = replacePathPrefix(f.abs_path, oldPrefix, newPrefix);
      const nextParent = parentDirName !== undefined ? parentDirName : f.parent_dir_name;
      // raw_dir_name：仅当影片目录本身被改名时才变；父目录改名时 basename 不变。
      const nextRaw = path.basename(nextAbs);
      updFilm.run(nextAbs, nextParent, nextRaw, now, f.id);

      const files = listFiles.all(f.id) as { id: number; abs_path: string }[];
      for (const file of files) {
        if (!isPathUnderOrEqual(file.abs_path, oldPrefix)) continue;
        const nextFileAbs = replacePathPrefix(file.abs_path, oldPrefix, newPrefix);
        updFile.run(nextFileAbs, file.id);
        updatedFiles++;
      }
    }
  });

  return { updatedFilms: affected.length, updatedFiles };
}

export function registerFileIpc() {
  ipcMain.handle('files:listByFilm', (_e, filmId: number) => {
    return getDb().prepare('SELECT * FROM film_files WHERE film_id=? ORDER BY name').all(filmId);
  });

  ipcMain.handle('files:pathStatus', async (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return { valid: false, reason: 'film_not_found' as const };
    try {
      const stat = await fs.promises.stat(toRealPath(film.abs_path));
      return stat.isDirectory()
        ? { valid: true, reason: 'ok' as const }
        : { valid: false, reason: 'not_directory' as const };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return {
        valid: false,
        reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' as const : 'unreadable' as const,
      };
    }
  });

  ipcMain.handle('files:openInFolder', async (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const result = await shell.openPath(toRealPath(film.abs_path));
    return result === '';
  });

  ipcMain.handle('files:restat', (_e, filmId: number) => {
    const film = getDb().prepare('SELECT abs_path FROM films WHERE id=?').get(filmId) as { abs_path: string } | undefined;
    if (!film) return false;
    const files = listFilmFiles(toRealPath(film.abs_path)).map(f => ({ ...f, abs_path: toVirtualPath(f.abs_path) }));
    tx(getDb(), () => replaceFilmFiles(getDb(), filmId, files));
    return true;
  });

  /**
   * 重命名影片目录本身：F:/A/B/filmDir → F:/A/B/newName
   * 仅更新当前影片及其 film_files；不重解析 code/title。
   */
  ipcMain.handle('files:renameFilmDir', async (_e, filmId: number, newName: string): Promise<OpResult> => {
    const nameErr = validateDirName(newName);
    if (nameErr) return { ok: false, error: nameErr };

    const film = getDb().prepare('SELECT id, abs_path, parent_dir_name, raw_dir_name FROM films WHERE id=?').get(filmId) as
      | { id: number; abs_path: string; parent_dir_name: string; raw_dir_name: string }
      | undefined;
    if (!film) return { ok: false, error: '影片不存在' };

    const oldAbs = path.resolve(film.abs_path);
    const dirErr = await assertDirExists(toRealPath(oldAbs));
    if (dirErr) return { ok: false, error: dirErr };

    const trimmed = newName.trim();
    if (path.basename(oldAbs) === trimmed) {
      return { ok: false, error: '新名称与当前相同' };
    }

    const newAbs = path.join(path.dirname(oldAbs), trimmed);
    const freeErr = await assertTargetFree(toRealPath(newAbs));
    if (freeErr) return { ok: false, error: freeErr };

    // 库内 UNIQUE(abs_path) 冲突（pathKey 比对，兼容 Windows 大小写）
    const all = getDb().prepare('SELECT id, abs_path FROM films WHERE id<>?').all(filmId) as { id: number; abs_path: string }[];
    if (all.some(r => pathKey(r.abs_path) === pathKey(newAbs))) {
      return { ok: false, error: '库内已存在相同路径的影片' };
    }

    try {
      await fs.promises.rename(toRealPath(oldAbs), toRealPath(newAbs));
    } catch (error) {
      return { ok: false, error: `磁盘重命名失败: ${(error as Error).message}` };
    }

    try {
      const { updatedFilms, updatedFiles } = rewriteFilmRowsUnderPrefix(oldAbs, newAbs);
      return { ok: true, filmAbsPath: newAbs, updatedFilms, updatedFiles };
    } catch (error) {
      // 尽量回滚磁盘 rename
      try { await fs.promises.rename(toRealPath(newAbs), toRealPath(oldAbs)); } catch { /* ignore */ }
      return { ok: false, error: `库更新失败: ${(error as Error).message}` };
    }
  });

  /**
   * 重命名影片父目录：F:/A/B → F:/A/B_new
   * 批量更新 abs_path 以该父目录为前缀的全部影片（含软删除）与 film_files。
   */
  ipcMain.handle('files:renameParentDir', async (_e, filmId: number, newName: string): Promise<OpResult> => {
    const nameErr = validateDirName(newName);
    if (nameErr) return { ok: false, error: nameErr };

    const film = getDb().prepare('SELECT id, abs_path, parent_dir_name FROM films WHERE id=?').get(filmId) as
      | { id: number; abs_path: string; parent_dir_name: string }
      | undefined;
    if (!film) return { ok: false, error: '影片不存在' };

    const filmAbs = path.resolve(film.abs_path);
    if (!canRenameParentDir(filmAbs)) {
      return { ok: false, error: '父目录为磁盘根，无法重命名' };
    }

    const oldParent = parentAbsOfFilm(filmAbs);
    const dirErr = await assertDirExists(toRealPath(oldParent));
    if (dirErr) return { ok: false, error: `父目录${dirErr}` };

    // 影片目录本身也必须存在，避免半残状态
    const filmDirErr = await assertDirExists(toRealPath(filmAbs));
    if (filmDirErr) return { ok: false, error: filmDirErr };

    const trimmed = newName.trim();
    if (path.basename(oldParent) === trimmed) {
      return { ok: false, error: '新名称与当前相同' };
    }

    const newParent = path.join(path.dirname(oldParent), trimmed);
    const freeErr = await assertTargetFree(toRealPath(newParent));
    if (freeErr) return { ok: false, error: freeErr };

    // 预检：父目录改名后会不会与库内其他路径冲突
    try {
      const films = getDb().prepare('SELECT id, abs_path FROM films').all() as { id: number; abs_path: string }[];
      const affected = films.filter(f => isPathUnderOrEqual(f.abs_path, oldParent));
      const unaffectedKeys = new Map(
        films.filter(f => !isPathUnderOrEqual(f.abs_path, oldParent)).map(f => [pathKey(f.abs_path), f.id]),
      );
      for (const f of affected) {
        const next = replacePathPrefix(f.abs_path, oldParent, newParent);
        if (unaffectedKeys.has(pathKey(next))) {
          return { ok: false, error: `库内路径冲突: ${next}` };
        }
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    try {
      await fs.promises.rename(toRealPath(oldParent), toRealPath(newParent));
    } catch (error) {
      return { ok: false, error: `磁盘重命名失败: ${(error as Error).message}` };
    }

    try {
      // 父目录显示名：与磁盘 basename 对齐（平铺 root 下 parent_dir_name 为空则保持空？）
      // 用户改的是物理父目录名；库字段 parent_dir_name 应同步为新 basename。
      // 若原先为空（平铺扫描），则仍写新 basename——因为现在父目录确实有名字了。
      // 更稳妥：始终写 trimmed（用户显式重命名的目标名）。
      const { updatedFilms, updatedFiles } = rewriteFilmRowsUnderPrefix(oldParent, newParent, trimmed);
      return {
        ok: true,
        parentAbsPath: newParent,
        filmAbsPath: replacePathPrefix(filmAbs, oldParent, newParent),
        updatedFilms,
        updatedFiles,
      };
    } catch (error) {
      try { await fs.promises.rename(toRealPath(newParent), toRealPath(oldParent)); } catch { /* ignore */ }
      return { ok: false, error: `库更新失败: ${(error as Error).message}` };
    }
  });

  /**
   * 删除影片目录内的单个文件：移入系统回收站，并删除 film_files 行。
   * 仅允许删除当前影片 abs_path 之下的文件。
   */
  ipcMain.handle('files:deleteFile', async (_e, filmId: number, fileId: number): Promise<OpResult> => {
    const film = getDb().prepare('SELECT id, abs_path FROM films WHERE id=?').get(filmId) as
      | { id: number; abs_path: string }
      | undefined;
    if (!film) return { ok: false, error: '影片不存在' };

    const row = getDb().prepare('SELECT id, film_id, abs_path, name FROM film_files WHERE id=?').get(fileId) as
      | { id: number; film_id: number; abs_path: string; name: string }
      | undefined;
    if (!row || row.film_id !== filmId) return { ok: false, error: '文件记录不存在' };

    const filmAbs = path.resolve(film.abs_path);
    const fileAbs = path.resolve(row.abs_path);
    if (!isPathStrictlyUnder(fileAbs, filmAbs)) {
      return { ok: false, error: '文件不在影片目录内，拒绝删除' };
    }

    try {
      await fs.promises.stat(toRealPath(fileAbs));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // 磁盘已无文件：清理库记录
        getDb().prepare('DELETE FROM film_files WHERE id=?').run(fileId);
        return { ok: true, updatedFiles: 1 };
      }
      return { ok: false, error: '文件无法访问' };
    }

    try {
      await shell.trashItem(toRealPath(fileAbs));
    } catch (error) {
      return { ok: false, error: `移入回收站失败: ${(error as Error).message}` };
    }

    getDb().prepare('DELETE FROM film_files WHERE id=?').run(fileId);
    return { ok: true, updatedFiles: 1 };
  });
}
