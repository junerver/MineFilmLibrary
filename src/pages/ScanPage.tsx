import { useEffect, useState } from 'react';
import type { ScanRootRow, ScanRunRow } from '../api/types';
import { useToast } from '../components/Toaster';

const mfl = (): any => (window as any).mfl;

interface ScanResultStats {
  dir_added: number;
  dir_updated: number;
  dir_removed: number;
  code_repaired: number;
  scrape_candidates: number;
  scrape_resumed: number;
  scrape_deferred: number;
  scrape_ok: number;
  scrape_fail: number;
  scrape_skipped: number;
  fallback_applied: number;
  fallback_fail: number;
}

export default function ScanPage() {
  const toast = useToast();
  const [roots, setRoots] = useState<ScanRootRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [newPath, setNewPath] = useState('');

  const reload = () => {
    mfl().scanner.listRoots().then(setRoots).catch(() => {});
    mfl().scanner.listRuns().then(setRuns).catch(() => {});
  };
  useEffect(reload, []);

  const add = async () => {
    if (!newPath) return;
    const r = await mfl().scanner.addRoot(newPath);
    if (r.ok) { setNewPath(''); reload(); }
    else toast.push({ text: r.error ?? '失败', kind: 'error' });
  };

  const run = async (id: number, mode: 'full' | 'incremental') => {
    const r = mode === 'full' ? await mfl().scanner.runFull(id) : await mfl().scanner.runIncremental(id);
    if (r.ok) {
      const stats = r.stats as ScanResultStats;
      toast.push({
        text: `扫描完成：新增 ${stats.dir_added}，文件变化 ${stats.dir_updated}，移除 ${stats.dir_removed}（扫描不删除记录）`
          + `，修正编号 ${stats.code_repaired}`
          + `；待刮削 ${stats.scrape_candidates}（续刮 ${stats.scrape_resumed}），成功 ${stats.scrape_ok}，失败 ${stats.scrape_fail}，跳过 ${stats.scrape_skipped}`
          + (stats.scrape_deferred ? `，另有 ${stats.scrape_deferred} 部因已有批量任务而延后` : '')
          + `；目录兜底 ${stats.fallback_applied}，兜底失败 ${stats.fallback_fail}`,
        kind: 'success',
      });
    } else {
      toast.push({ text: r.error ?? '失败', kind: 'error' });
    }
    reload();
  };

  return (
    <div>
      <h3>扫描根目录</h3>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="路径，如 F:\Movie\已分类" style={{ flex: 1, padding: 6, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }} />
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
              <td style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => run(r.id, 'full')}>全量</button>
                <button onClick={() => run(r.id, 'incremental')}>增量</button>
                <button onClick={() => { mfl().scanner.removeRoot(r.id).then(reload); }}>删除</button>
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
