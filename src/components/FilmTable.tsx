import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FilmRow } from '../api/types';
import api from '../api';
import { PrivacyText, textPrivacyActive, usePrivacySettings } from '../hooks/usePrivacySettings';

const STATUS_LABEL: Record<string, string> = { parsed: '完整', partial: '部分', unknown: '未识别' };

// 与 library:list ALLOWED_SORT / FilmFilter.sort_by 对齐
type SortKey = 'code' | 'title' | 'updated_at' | 'actors' | 'scraped_at';

export type FilmTableColumnId = 'code' | 'title' | 'locale' | 'status' | 'updated' | 'actors' | 'scraped';

const COLUMN_DEFS: { id: FilmTableColumnId; label: string; defaultWidth: number; sortable?: SortKey }[] = [
  { id: 'code', label: '编号', defaultWidth: 140, sortable: 'code' },
  { id: 'title', label: '标题', defaultWidth: 280, sortable: 'title' },
  { id: 'locale', label: '后缀', defaultWidth: 56 },
  { id: 'status', label: '状态', defaultWidth: 64 },
  { id: 'updated', label: '修改时间', defaultWidth: 150, sortable: 'updated_at' },
  { id: 'actors', label: '演员', defaultWidth: 160, sortable: 'actors' },
  { id: 'scraped', label: '刮削', defaultWidth: 72, sortable: 'scraped_at' },
];

const WIDTHS_KEY = 'mfl:filmTable.colWidths';
const VISIBLE_KEY = 'mfl:filmTable.colVisible';

function loadWidths(): Partial<Record<FilmTableColumnId, number>> {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, number>;
    const out: Partial<Record<FilmTableColumnId, number>> = {};
    for (const d of COLUMN_DEFS) {
      if (typeof o[d.id] === 'number' && o[d.id] >= 40) out[d.id] = o[d.id];
    }
    return out;
  } catch {
    return {};
  }
}

function loadVisible(): Record<FilmTableColumnId, boolean> {
  const defaults: Record<FilmTableColumnId, boolean> = {
    code: true, title: true, locale: true, status: true, updated: true, actors: true, scraped: true,
  };
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    if (!raw) return defaults;
    const o = JSON.parse(raw) as Record<string, boolean>;
    for (const d of COLUMN_DEFS) {
      if (typeof o[d.id] === 'boolean') defaults[d.id] = o[d.id];
    }
    // 至少保留编号+标题
    if (!defaults.code) defaults.code = true;
    if (!defaults.title) defaults.title = true;
    return defaults;
  } catch {
    return defaults;
  }
}

export interface FilmTableSortProps {
  sortKey?: SortKey | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: SortKey) => void;
}

export interface FilmTableSelectProps {
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
  hideActorsColumn?: boolean;
} & FilmTableSortProps & FilmTableSelectProps) {
  const nav = useNavigate();
  const privacy = usePrivacySettings();
  const blurText = textPrivacyActive(privacy);
  const [menu, setMenu] = useState<{ film: FilmRow; x: number; y: number } | null>(null);
  const selectable = !!onSelectionChange;

  const [widths, setWidths] = useState(loadWidths);
  const [visible, setVisible] = useState(loadVisible);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ id: FilmTableColumnId; startX: number; startW: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  }, [widths]);
  useEffect(() => {
    localStorage.setItem(VISIBLE_KEY, JSON.stringify(visible));
  }, [visible]);

  useEffect(() => {
    if (!colMenuOpen) return;
    // 用 click（冒泡阶段）而不是 mousedown：
    // mousedown 阶段 setState 关菜单会触发整表重渲染，同一指针序列里随后的
    // input focus/选区可能被吃掉（表现为点搜索框/表单却无法输入）。
    const close = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [colMenuOpen]);

  useLayoutEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      const next = Math.max(48, d.startW + (e.clientX - d.startX));
      setWidths(w => ({ ...w, [d.id]: next }));
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

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

  const activeCols = useMemo(() => {
    return COLUMN_DEFS.filter(c => {
      if (c.id === 'actors' && hideActorsColumn) return false;
      return visible[c.id] !== false;
    });
  }, [visible, hideActorsColumn]);

  const colWidth = (id: FilmTableColumnId, fallback: number) => widths[id] ?? fallback;

  const startResize = (e: ReactMouseEvent, id: FilmTableColumnId, defaultWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = {
      id,
      startX: e.clientX,
      startW: colWidth(id, defaultWidth),
    };
  };

  // 隐私文字：编号(code)永不模糊；其它列在 privacy_text 开启时模糊，按住查看。
  const P = ({ children }: { children: React.ReactNode }) => (
    <PrivacyText blur={blurText}>{children}</PrivacyText>
  );

  const renderCell = (r: FilmRow, id: FilmTableColumnId) => {
    switch (id) {
      case 'code':
        return (
          <>
            {r.code ? r.code.toUpperCase() : ''}
            {(r.code_count ?? 0) > 1 && (
              <span title={`该编号存在 ${r.code_count} 份`} style={{ marginLeft: 6, padding: '0 5px', borderRadius: 8, fontSize: 11, background: '#7a3a00', color: '#ffd0a0', whiteSpace: 'nowrap' }}>×{r.code_count}</span>
            )}
          </>
        );
      case 'title': {
        const t = r.title ?? '';
        // 单行省略；完整标题放在内层 span 的 title（PrivacyText 不透传 title）
        return (
          <PrivacyText
            blur={blurText}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span title={t || undefined}>{t}</span>
          </PrivacyText>
        );
      }
      case 'locale':
        return <P>{r.locale ?? ''}</P>;
      case 'status':
        return <P>{STATUS_LABEL[r.scan_status] ?? r.scan_status}</P>;
      case 'updated':
        return <P>{new Date(r.updated_at).toLocaleString()}</P>;
      case 'actors': {
        const names = (r.actors_names ?? '').trim() || '—';
        // 单行省略；完整演员名放在内层 span 的 title
        return (
          <PrivacyText
            blur={blurText}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span title={names !== '—' ? names : undefined}>{names}</span>
          </PrivacyText>
        );
      }
      case 'scraped':
        return r.scraped_at
          ? <P><span title={new Date(r.scraped_at).toLocaleString()} style={{ color: '#8f8', whiteSpace: 'nowrap' }}>已刮削</span></P>
          : <P><span style={{ color: '#666', whiteSpace: 'nowrap' }}>—</span></P>;
      default:
        return null;
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, position: 'relative' }} ref={colMenuRef}>
        <button
          type="button"
          onClick={() => setColMenuOpen(o => !o)}
          style={{ fontSize: 12, padding: '2px 8px', background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, cursor: 'pointer' }}
        >
          显示列 ▾
        </button>
        {colMenuOpen && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', zIndex: 50, marginTop: 4,
            background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, padding: 8,
            minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            {COLUMN_DEFS.filter(c => !(c.id === 'actors' && hideActorsColumn)).map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={visible[c.id] !== false}
                  disabled={c.id === 'code' || c.id === 'title'}
                  onChange={e => setVisible(v => ({ ...v, [c.id]: e.target.checked }))}
                />
                {c.label}
              </label>
            ))}
            <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>拖拽表头右缘调列宽，自动保存</div>
          </div>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
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
            {activeCols.map(c => (
              <th
                key={c.id}
                onClick={() => c.sortable && onSortClick(c.sortable)}
                style={{
                  width: colWidth(c.id, c.defaultWidth),
                  position: 'relative',
                  cursor: c.sortable && onSortChange ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  userSelect: 'none',
                  paddingRight: 8,
                }}
                title={c.id === 'actors' ? '未挂演员信息的影片排在最前' : undefined}
              >
                {c.label}{c.sortable ? arrow(c.sortable) : ''}
                <span
                  onMouseDown={e => startResize(e, c.id, c.defaultWidth)}
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
                    cursor: 'col-resize', userSelect: 'none',
                  }}
                  title="拖拽调整列宽"
                />
              </th>
            ))}
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
                {activeCols.map(c => (
                  <td
                    key={c.id}
                    style={{
                      width: colWidth(c.id, c.defaultWidth),
                      // 标题/演员等统一单行省略
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      verticalAlign: 'middle',
                      maxWidth: 0, // 配合 table-layout:fixed，强制列宽内省略
                    }}
                  >
                    {renderCell(r, c.id)}
                  </td>
                ))}
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
