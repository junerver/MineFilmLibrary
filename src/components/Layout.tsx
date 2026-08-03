import { NavLink, Outlet } from 'react-router-dom';
import { useScanProgress } from '../hooks/useScanProgress';
import { useBatchScrapeProgress } from '../hooks/useBatchScrapeProgress';

const NAV: { to: string; label: string }[] = [
  { to: '/library', label: '影片库' },
  { to: '/actors', label: '演员' },
  { to: '/tags', label: '标签' },
  { to: '/studios', label: '厂商' },
  // 扫描 / 回收站已并入「设置」内 Tab（/settings?tab=…）
  { to: '/settings', label: '设置' },
];

const LIBRARY_LAST_QUERY_KEY = 'mfl:libraryLastQuery';

const mfl = (): any => (window as any).mfl;

/** 侧栏「影片库」尽量带上最近一次筛选 query，避免点侧栏后丢失搜索/筛选。 */
function libraryNavTo(): string {
  try {
    const last = sessionStorage.getItem(LIBRARY_LAST_QUERY_KEY);
    if (last) return `/library?${last}`;
  } catch { /* ignore */ }
  return '/library';
}

export default function Layout() {
  const progress = useScanProgress();
  const batch = useBatchScrapeProgress();

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 200, borderRight: '1px solid #333', padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>MineFilmLibrary</div>
        {NAV.map(n => (
          <NavLink
            key={n.to}
            // 路由变化会重渲染 Layout；每次渲染读一次最近筛选，避免点侧栏丢 query。
            to={n.to === '/library' ? libraryNavTo() : n.to}
            style={({ isActive }) => ({
              display: 'block', padding: '6px 8px', borderRadius: 4,
              background: isActive ? '#2a2a2a' : 'transparent', color: '#e0e0e0', textDecoration: 'none',
            })}
          >{n.label}</NavLink>
        ))}
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {progress && (
          <div style={{
            padding: 8, borderBottom: '1px solid #333', fontSize: 12,
            color: progress.flash === 'error' ? '#ff8080' : progress.flash === 'done' ? '#80ff80' : undefined,
          }}>
            {progress.flash === 'done'
              ? `扫描完成（${progress.current} 个目录）`
              : progress.flash === 'error'
                ? `扫描失败：${progress.errorMessage ?? '未知错误'}`
                : `${progress.stage === 'scrape' ? '新片刮削中' : progress.stage === 'fallback' ? '应用目录兜底' : '扫描中'} ${progress.current}/${progress.total}`
                  + (progress.currentPath ? ` — ${progress.currentPath}` : '')}
          </div>
        )}
        {/* 批量刮削：主进程任务，任意页面可见；切页不中断。 */}
        {batch && (batch.running || batch.finished) && (
          <div style={{
            padding: 8, borderBottom: '1px solid #333', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 12,
            color: batch.finished
              ? (batch.fail > 0 ? '#ffb080' : '#80ff80')
              : '#e0e0e0',
            background: '#1a1a1a',
          }}>
            <span style={{ flex: 1 }}>
              {batch.finished
                ? `批量刮削${batch.cancelled ? '已停止' : '完成'}：成功 ${batch.ok}，失败 ${batch.fail}，跳过 ${batch.skip}（${batch.done}/${batch.total}）`
                : `批量刮削 ${batch.done}/${batch.total} 成功 ${batch.ok} 失败 ${batch.fail}`
                  + (batch.active.length ? ` — 进行中：${batch.active.join('、')}` : '')
                  + (batch.message ? ` · ${batch.message}` : '')}
            </span>
            {batch.running && (
              <button
                style={{ fontSize: 12, padding: '2px 8px' }}
                onClick={() => void mfl().scrape.cancelBatch()}
              >停止</button>
            )}
          </div>
        )}
        {/* id 供影片库/其它列表页保存/恢复滚动位置（进详情再返回）。 */}
        <div id="mfl-main-scroll" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
