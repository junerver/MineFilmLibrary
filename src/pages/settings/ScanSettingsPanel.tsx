import { useEffect, useState } from 'react';
import type { ScanRootRow, ScanRunRow } from '../../api/types';
import { useToast } from '../../components/Toaster';
import { clampInt, mfl } from './settingsHelpers';

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

/** 扫描根目录 / 历史 + 解析策略（原独立扫描页 + 设置「解析策略」）。 */
export default function ScanSettingsPanel() {
  const toast = useToast();
  const [roots, setRoots] = useState<ScanRootRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [newPath, setNewPath] = useState('');
  const [parentType, setParentTypeState] = useState('actor');
  const [scanMaxDepth, setScanMaxDepth] = useState('3');

  const reload = () => {
    mfl().scanner.listRoots().then(setRoots).catch(() => {});
    mfl().scanner.listRuns().then(setRuns).catch(() => {});
  };

  useEffect(() => {
    reload();
    mfl().settings.get().then((s: Record<string, string>) => {
      setParentTypeState(s.default_parent_type ?? 'actor');
      setScanMaxDepth(s.scan_max_depth ?? '3');
    }).catch(() => {});
  }, []);

  const setParentType = async (v: string) => {
    await mfl().settings.set('default_parent_type', v);
    setParentTypeState(v);
    toast.push({ text: '已保存', kind: 'success' });
  };

  const saveScanDepth = async () => {
    const depth = clampInt(scanMaxDepth, 1, 10, 3);
    await mfl().settings.set('scan_max_depth', String(depth));
    setScanMaxDepth(String(depth));
    toast.push({ text: `扫描最大深度已保存：${depth} 层`, kind: 'success' });
  };

  const add = async () => {
    if (!newPath) return;
    const r = await mfl().scanner.addRoot(newPath);
    if (r.ok) {
      setNewPath('');
      reload();
    } else {
      toast.push({ text: r.error ?? '失败', kind: 'error' });
    }
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
      <h3>解析策略</h3>
      <label>
        无前缀父目录默认：
        <select value={parentType} onChange={e => void setParentType(e.target.value)}>
          <option value="actor">演员</option>
          <option value="genre">题材</option>
        </select>
      </label>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'end', maxWidth: 360 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          <span style={{ color: '#999' }}>扫描影片最大目录层级 (1–10)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={scanMaxDepth}
            onChange={e => setScanMaxDepth(e.target.value)}
            style={{ width: 120, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
          />
        </label>
        <button type="button" onClick={() => void saveScanDepth()}>保存扫描设置</button>
      </div>
      <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
        默认 3 层：扫描只登记路径、编号和文件清单；新编号随后自动刮削，失败时才按目录名兜底。
      </div>

      <h3 style={{ marginTop: 16 }}>扫描根目录</h3>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <input
          value={newPath}
          onChange={e => setNewPath(e.target.value)}
          placeholder="路径，如 F:\Movie\已分类"
          style={{ flex: 1, padding: 6, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
        />
        <button type="button" onClick={() => void add()}>添加</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>路径</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>标签</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>上次全量</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>上次增量</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.04)' }}>
              <td style={{ padding: '4px 6px' }}>{r.path}</td>
              <td style={{ padding: '4px 6px' }}>{r.label ?? ''}</td>
              <td style={{ padding: '4px 6px' }}>{r.last_full_scan_at ? new Date(r.last_full_scan_at).toLocaleString() : '—'}</td>
              <td style={{ padding: '4px 6px' }}>{r.last_incremental_scan_at ? new Date(r.last_incremental_scan_at).toLocaleString() : '—'}</td>
              <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => void run(r.id, 'full')}>全量</button>
                <button type="button" onClick={() => void run(r.id, 'incremental')}>增量</button>
                <button type="button" onClick={() => { void mfl().scanner.removeRoot(r.id).then(reload); }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>
        历史
        <button
          type="button"
          style={{ marginLeft: 12, fontSize: 12 }}
          onClick={async () => {
            await mfl().scanner.clearHistory();
            reload();
          }}
        >
          清除历史
        </button>
      </h3>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>开始</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>路径</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>模式</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>状态</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>新增/更新/移除</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>错误</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.04)' }}>
              <td style={{ padding: '4px 6px' }}>{new Date(r.started_at).toLocaleString()}</td>
              <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '4px 6px' }} title={(r as any).root_path ?? ''}>
                {(r as any).root_path ?? '—'}
              </td>
              <td style={{ padding: '4px 6px' }}>{r.mode === 'full' ? '全量' : '增量'}</td>
              <td style={{ padding: '4px 6px' }}>{r.status === 'done' ? '完成' : r.status === 'error' ? '失败' : '运行中'}</td>
              <td style={{ padding: '4px 6px' }}>{r.dir_added}/{r.dir_updated}/{r.dir_removed}</td>
              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '4px 6px' }} title={r.error_message ?? ''}>
                {r.error_message ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
