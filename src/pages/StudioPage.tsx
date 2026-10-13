import { useEffect, useMemo, useLayoutEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { FilmRow, StudioAggRow } from '../api/types';
import FilmTable from '../components/FilmTable';
import { useToast } from '../components/Toaster';
import { useConfirm } from '../components/ConfirmDialog';
import { toTraditional } from '../util/zhConvert';

const mfl = (): any => (window as any).mfl;

type StudioRole = 'studio' | 'label';

// 厂商页：制作商 + 发行商合并去重列表，每项显示双角色计数。
// films.studio（制作商）/ films.label（发行商）是字符串列，无独立主表。
export default function StudioPage() {
  const toast = useToast();
  // 原生 confirm 在 Electron/Windows 下破坏输入焦点，统一换应用内确认弹窗
  const confirm = useConfirm();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStudio = searchParams.get('studio');
  const [studios, setStudios] = useState<StudioAggRow[]>([]);
  const [selected, setSelected] = useState<string | null>(initialStudio);
  const [films, setFilms] = useState<FilmRow[]>([]);
  // 影片角色筛选：制作商 / 发行商 / 全部
  const [roleFilter, setRoleFilter] = useState<'studio' | 'label' | 'any'>('any');
  const [studioSearch, setStudioSearch] = useState('');
  // 操作表单
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 重命名/删除需选择角色（同一厂商名可能既是制作商又是发行商）
  const [opRole, setOpRole] = useState<StudioRole>('studio');
  const [busy, setBusy] = useState(false);

  const [paneHeight, setPaneHeight] = useState(0);
  useLayoutEffect(() => {
    const main = document.getElementById('mfl-main-scroll');
    if (!main) return;
    const apply = () => {
      const style = getComputedStyle(main);
      const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const h = main.clientHeight - pad;
      setPaneHeight(h > 0 ? h : main.clientHeight);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

  const reloadStudios = () => {
    mfl().studios.list().then((r: StudioAggRow[]) => setStudios(r)).catch(() => {});
  };
  useEffect(reloadStudios, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selected == null) next.delete('studio');
    else next.set('studio', selected);
    if (next.get('studio') !== searchParams.get('studio')) setSearchParams(next, { replace: true });
  }, [selected]);

  // 选中或角色筛选变化时加载影片
  useEffect(() => {
    if (selected == null) { setFilms([]); return; }
    let cancelled = false;
    setRenaming(false);
    setRenameValue(selected);
    mfl().studios.films(selected, roleFilter).then((rows: FilmRow[]) => {
      if (!cancelled) setFilms(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected, roleFilter]);

  const search = toTraditional(studioSearch.trim().toLowerCase());
  const visibleStudios = useMemo(
    () => search ? studios.filter(s => toTraditional(s.name.toLowerCase()).includes(search)) : studios,
    [studios, search],
  );

  const selectedAgg = studios.find(s => s.name === selected) ?? null;

  const doRename = async () => {
    if (!selected) return;
    const next = renameValue.trim();
    if (!next) { toast.push({ text: '新厂商名不能为空', kind: 'error' }); return; }
    if (next === selected) { setRenaming(false); return; }
    setBusy(true);
    try {
      await mfl().studios.rename(selected, next, opRole);
      const roleLabel = opRole === 'studio' ? '制作商' : '发行商';
      toast.push({ text: `已重命名（${roleLabel}）：${selected} → ${next}`, kind: 'success' });
      reloadStudios();
      setRenaming(false);
      // 若该名在另一角色也存在，selected 名字仍有效；否则切到新名。
      if (opRole === 'studio' && (selectedAgg?.as_label_count ?? 0) === 0) setSelected(next);
      else if (opRole === 'label' && (selectedAgg?.as_studio_count ?? 0) === 0) setSelected(next);
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!selected) return;
    const count = opRole === 'studio' ? (selectedAgg?.as_studio_count ?? 0) : (selectedAgg?.as_label_count ?? 0);
    const roleLabel = opRole === 'studio' ? '制作商' : '发行商';
    if (!(await confirm({
      title: `移除${roleLabel}标记`,
      message: `移除${roleLabel}「${selected}」标记？\n将从 ${count} 部影片中清除该${roleLabel}字段（影片本身保留）。此操作不可撤销。`,
      confirmText: '移除',
      danger: true,
    }))) return;
    setBusy(true);
    try {
      await mfl().studios.remove(selected, opRole);
      toast.push({ text: `已移除${roleLabel}标记：${selected}`, kind: 'success' });
      reloadStudios();
      // 若该名在另一角色已不存在，清空选中
      const remain = opRole === 'studio' ? (selectedAgg?.as_label_count ?? 0) : (selectedAgg?.as_studio_count ?? 0);
      if (remain === 0) setSelected(null);
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      display: 'flex', gap: 16,
      height: paneHeight > 0 ? paneHeight : '100%',
      maxHeight: paneHeight > 0 ? paneHeight : '100%',
      minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    }}>
      {/* 左列：搜索 + 厂商列表 */}
      <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, height: '100%' }}>
        <div style={{ flexShrink: 0, position: 'relative', zIndex: 2 }} onMouseDown={e => e.stopPropagation()}>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={studioSearch}
            onChange={e => setStudioSearch(e.target.value)}
            placeholder="搜索 厂商"
            onMouseDown={e => {
              e.stopPropagation();
              const el = e.currentTarget;
              if (document.activeElement !== el) {
                requestAnimationFrame(() => { if (document.activeElement !== el) el.focus({ preventScroll: true }); });
              }
            }}
            style={{ width: '100%', boxSizing: 'border-box', padding: 4, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {visibleStudios.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 4 }}>无匹配厂商</div>}
          {visibleStudios.map(s => (
            <div
              key={s.name}
              onClick={() => setSelected(s.name)}
              style={{
                padding: 6, cursor: 'pointer', borderRadius: 4,
                background: selected === s.name ? '#2a2a2a' : 'transparent',
              }}
            >
              {s.name}{' '}
              <span style={{ color: '#888', fontSize: 12 }}>
                {s.as_studio_count > 0 && <>制{s.as_studio_count}</>}
                {s.as_studio_count > 0 && s.as_label_count > 0 && '·'}
                {s.as_label_count > 0 && <>发{s.as_label_count}</>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 右列：详情 + 角色筛选 + 操作 + 影片表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {selected ? (
          <>
            <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>选中厂商：</span>
              <strong>{selected}</strong>
              {selectedAgg && (selectedAgg.as_studio_count > 0 || selectedAgg.as_label_count > 0) && (
                <span style={{ color: '#888', fontSize: 12 }}>
                  （{selectedAgg.as_studio_count > 0 && `制作商 ${selectedAgg.as_studio_count} 部`}
                  {selectedAgg.as_studio_count > 0 && selectedAgg.as_label_count > 0 && ' · '}
                  {selectedAgg.as_label_count > 0 && `发行商 ${selectedAgg.as_label_count} 部`}）
                </span>
              )}
            </div>

            {/* 影片角色筛选 */}
            <div style={{ marginBottom: 8, display: 'flex', gap: 4 }}>
              {(['any', 'studio', 'label'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  style={{
                    padding: '4px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                    background: roleFilter === r ? '#252d38' : '#2a2a2a',
                    color: roleFilter === r ? '#fff' : '#999',
                    border: roleFilter === r ? '1px solid #6aa8ff' : '1px solid #444',
                  }}
                >
                  {r === 'any' ? '全部' : r === 'studio' ? '仅制作商' : '仅发行商'}
                </button>
              ))}
            </div>

            {/* 操作区（折叠）：重命名 / 移除标记（需选角色） */}
            <details style={{ marginBottom: 12, padding: 8, background: '#1a2228', borderRadius: 4, fontSize: 12, border: '1px solid #333' }}>
              <summary style={{ color: '#aaa', cursor: 'pointer', userSelect: 'none' }}>重命名 / 移除标记</summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#999' }}>操作角色：</span>
                  <select
                    value={opRole}
                    onChange={e => setOpRole(e.target.value as StudioRole)}
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  >
                    <option value="studio">制作商</option>
                    <option value="label">发行商</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {renaming ? (
                    <>
                      <input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onMouseDown={e => e.stopPropagation()}
                        style={{ flex: '0 1 220px', minWidth: 120, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                      />
                      <button type="button" disabled={busy} onClick={() => void doRename()}>保存</button>
                      <button type="button" onClick={() => { setRenaming(false); setRenameValue(selected); }}>取消</button>
                    </>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setRenameValue(selected); setRenaming(true); }}>重命名该角色</button>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void doDelete()}
                    style={{ padding: '2px 8px', border: '1px solid #6a2a2a', borderRadius: 4, background: '#3a1010', color: '#e08080', cursor: 'pointer' }}
                  >
                    移除该角色标记
                  </button>
                </div>
              </div>
            </details>

            <FilmTable
              rows={films}
              onRowDoubleClick={(film) => nav(`/film/${film.id}`, {
                state: { from: 'studios', listIds: films.map(f => f.id) },
              })}
            />
            {films.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 4 }}>该筛选下暂无影片</div>}
          </>
        ) : <div>选择左侧厂商</div>}
      </div>
    </div>
  );
}
