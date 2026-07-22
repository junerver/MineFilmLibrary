import { NavLink, Outlet } from 'react-router-dom';
import { useScanProgress } from '../hooks/useScanProgress';

const NAV: { to: string; label: string }[] = [
  { to: '/library', label: '影片库' },
  { to: '/actors', label: '演员' },
  { to: '/scan', label: '扫描' },
  { to: '/trash', label: '回收站' },
  { to: '/settings', label: '设置' },
];

export default function Layout() {
  const progress = useScanProgress();
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 200, borderRight: '1px solid #333', padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>MineFilmLibrary</div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} style={({ isActive }) => ({
            display: 'block', padding: '6px 8px', borderRadius: 4,
            background: isActive ? '#2a2a2a' : 'transparent', color: '#e0e0e0', textDecoration: 'none',
          })}>{n.label}</NavLink>
        ))}
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {progress && (
          <div style={{ padding: 8, borderBottom: '1px solid #333', fontSize: 12 }}>
            扫描中 {progress.current}/{progress.total} — {progress.currentPath}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
