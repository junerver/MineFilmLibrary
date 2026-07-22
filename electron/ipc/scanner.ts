import { ipcMain, BrowserWindow } from 'electron';
import { getDb } from '../db';
import { nowMs } from '../db/dao';
import { runScan } from '../scanner';
import type { ScanProgress } from '../scanner';

export function registerScannerIpc(progressKey = 'scanner:progress') {
  ipcMain.handle('scanner:listRoots', () => getDb().prepare('SELECT * FROM scan_roots ORDER BY id').all());
  ipcMain.handle('scanner:addRoot', async (_e, p: string, label?: string) => {
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
      // 终止事件：让前端的 useScanProgress 把进度条清掉。
      // 把 current/total 设成最终值，万一前端先收到 'done' 时显示一下"扫描完成"也能拿到合理数字。
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(progressKey, { runId, stage: 'done', current: stats.dir_seen, total: stats.dir_seen, currentPath: '' });
      }
      return { ok: true, stats };
    } catch (err: any) {
      errorMessage = err.message;
      getDb().prepare('UPDATE scan_runs SET finished_at=?, status=?, error_message=? WHERE id=?').run(nowMs(), 'error', errorMessage, runId);
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(progressKey, { runId, stage: 'error', current: 0, total: 0, currentPath: '', errorMessage });
      }
      return { ok: false, error: errorMessage };
    }
  }

  ipcMain.handle('scanner:runFull', (_e, rootId: number) => run(rootId, 'full'));
  ipcMain.handle('scanner:runIncremental', (_e, rootId: number) => run(rootId, 'incremental'));
  ipcMain.handle('scanner:listRuns', (_e, limit = 50) => getDb().prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?').all(limit));
}
