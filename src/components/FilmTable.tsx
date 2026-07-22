import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FilmRow } from '../api/types';
import api from '../api';

const STATUS_LABEL: Record<string, string> = { parsed: '完整', partial: '部分', unknown: '未识别' };

export default function FilmTable({ rows }: { rows: FilmRow[] }) {
  const nav = useNavigate();
  const [menu, setMenu] = useState<{ film: FilmRow; x: number; y: number } | null>(null);

  const onContext = (e: React.MouseEvent, film: FilmRow) => {
    e.preventDefault();
    setMenu({ film, x: e.clientX, y: e.clientY });
  };

  // Dismiss the context menu on any click outside the menu
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

 	return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
            <th>编号</th><th>标题</th><th>后缀</th><th>状态</th><th>修改时间</th><th>父目录</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}
                onDoubleClick={() => nav(`/film/${r.id}`)}
                onContextMenu={e => onContext(e, r)}
                style={{ borderBottom: '1px solid #222', cursor: 'pointer' }}>
              <td>{r.code ?? ''}</td>
              <td>{r.title ?? ''}</td>
              <td>{r.locale ?? ''}</td>
              <td>{STATUS_LABEL[r.scan_status] ?? r.scan_status}</td>
              <td>{new Date(r.updated_at).toLocaleString()}</td>
              <td>{r.parent_dir_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {menu && (
        <div style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#2a2a2a', border: '1px solid #444', zIndex: 100, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}
             onClick={e => e.stopPropagation()}>
          <button onClick={() => { void api.files.openInFolder(menu.film.id); setMenu(null); }}>打开所在文件夹</button>
          <button onClick={() => { nav(`/film/${menu.film.id}`); setMenu(null); }}>详情</button>
          <button onClick={() => { void api.library.softDelete(menu.film.id).then(() => location.reload()); setMenu(null); }}>软删除</button>
        </div>
      )}
    </>
  );
}
