import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FilmRow } from '../api/types';
import api from '../api';

const STATUS_LABEL: Record<string, string> = { parsed: '完整', partial: '部分', unknown: '未识别' };

// 支持排序的列：与后端 IPC 的 ALLOWED_SORT 表保持一致。
type SortKey = 'code' | 'actors';

export interface FilmTableSortProps {
  sortKey?: SortKey | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: SortKey) => void;
}

export interface FilmTableSelectProps {
  /** 受控多选：传入时显示勾选列。 */
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
}

export default function FilmTable({
  rows,
  onRowDoubleClick,
  sortKey,
  sortDir,
  onSortChange,
  selectedIds,
  onSelectionChange,
  hideActorsColumn = false,
}: {
  rows: FilmRow[];
  onRowDoubleClick?: (film: FilmRow) => void;
  /** 演员页内列表不需要再显示演员列 */
  hideActorsColumn?: boolean;
} & FilmTableSortProps & FilmTableSelectProps) {
  const nav = useNavigate();
  const [menu, setMenu] = useState<{ film: FilmRow; x: number; y: number } | null>(null);
  const selectable = !!onSelectionChange;

  const onContext = (e: React.MouseEvent, film: FilmRow) => {
    e.preventDefault();
    setMenu({ film, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const onSortClick = (key: SortKey) => {
    if (!onSortChange) return;
    onSortChange(key);
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const allSelected = selectable && rows.length > 0 && rows.every(r => selectedIds?.has(r.id));
  const someSelected = selectable && rows.some(r => selectedIds?.has(r.id));

  const toggleOne = (id: number) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const toggleAllVisible = () => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds ?? []);
    if (allSelected) {
      for (const r of rows) next.delete(r.id);
    } else {
      for (const r of rows) next.add(r.id);
    }
    onSelectionChange(next);
  };

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
            {selectable && (
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  ref={el => {
                    if (el) el.indeterminate = !!someSelected && !allSelected;
                  }}
                  onChange={toggleAllVisible}
                  title="全选/取消本页"
                />
              </th>
            )}
            <th onClick={() => onSortClick('code')} style={{ cursor: onSortChange ? 'pointer' : 'default' }}>编号{arrow('code')}</th>
            <th>标题</th><th>后缀</th><th>状态</th><th>修改时间</th>
            {!hideActorsColumn && (
              <th onClick={() => onSortClick('actors')} style={{ cursor: onSortChange ? 'pointer' : 'default' }} title="未挂演员信息的影片排在最前">演员{arrow('actors')}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const checked = !!selectedIds?.has(r.id);
            return (
              <tr
                key={r.id}
                onDoubleClick={() => (onRowDoubleClick ? onRowDoubleClick(r) : nav(`/film/${r.id}`))}
                onContextMenu={e => onContext(e, r)}
                style={{
                  borderBottom: '1px solid #222',
                  cursor: 'pointer',
                  background: checked ? '#243044' : undefined,
                }}
              >
                {selectable && (
                  <td onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => toggleOne(r.id)} />
                  </td>
                )}
                <td>
                  {r.code ? r.code.toUpperCase() : ''}
                  {(r.code_count ?? 0) > 1 && (
                    <span title={`该编号存在 ${r.code_count} 份`} style={{ marginLeft: 6, padding: '0 5px', borderRadius: 8, fontSize: 11, background: '#7a3a00', color: '#ffd0a0' }}>×{r.code_count}</span>
                  )}
                </td>
                <td>{r.title ?? ''}</td>
                <td>{r.locale ?? ''}</td>
                <td>{STATUS_LABEL[r.scan_status] ?? r.scan_status}</td>
                <td>{new Date(r.updated_at).toLocaleString()}</td>
                {!hideActorsColumn && (
                  <td>{(r.actors_names ?? '').trim() || '—'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu && (
        <div
          style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#2a2a2a', border: '1px solid #444', zIndex: 100, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { void api.files.openInFolder(menu.film.id); setMenu(null); }}>打开所在文件夹</button>
          <button onClick={() => {
            if (onRowDoubleClick) onRowDoubleClick(menu.film);
            else nav(`/film/${menu.film.id}`);
            setMenu(null);
          }}>详情</button>
          {selectable && (
            <button onClick={() => { toggleOne(menu.film.id); setMenu(null); }}>
              {selectedIds?.has(menu.film.id) ? '取消勾选' : '勾选'}
            </button>
          )}
          <button onClick={() => { void api.library.softDelete(menu.film.id).then(() => location.reload()); setMenu(null); }}>软删除</button>
        </div>
      )}
    </>
  );
}
