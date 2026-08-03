import { useEffect, useMemo, useLayoutEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { FilmRow } from '../api/types';
import FilmTable from '../components/FilmTable';
import { useToast } from '../components/Toaster';
import { toTraditional } from '../util/zhConvert';

const mfl = (): any => (window as any).mfl;

type TagAgg = { tag: string; count: number };

// 标签页：聚合影片库全部标签（film_tags），左侧列表 + 右侧选中标签的影片。
// 支持 重命名 / 合并到 / 删除。标签在 DB 是扁平字符串，无独立主表。
export default function TagPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTag = searchParams.get('tag');
  const [tags, setTags] = useState<TagAgg[]>([]);
  const [selected, setSelected] = useState<string | null>(initialTag);
  const [films, setFilms] = useState<FilmRow[]>([]);
  // 左列搜索（纯前端子串过滤）
  const [tagSearch, setTagSearch] = useState('');
  // 操作表单：重命名 / 合并到
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [mergeValue, setMergeValue] = useState('');
  const [busy, setBusy] = useState(false);

  // 量主内容区像素高度，让左列独立滚动（与 ActorPage 同思路：百分比高度在 overflow 父级失效）。
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

  const reloadTags = () => {
    mfl().genres.allTags().then((r: TagAgg[]) => setTags(r)).catch(() => {});
  };
  useEffect(reloadTags, []);

  // 选中同步到 URL ?tag=（replace 避免堆 history）
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selected == null) next.delete('tag');
    else next.set('tag', selected);
    if (next.get('tag') !== searchParams.get('tag')) setSearchParams(next, { replace: true });
  }, [selected]);

  // 选中变化时加载影片
  useEffect(() => {
    if (selected == null) { setFilms([]); return; }
    let cancelled = false;
    setRenaming(false);
    setRenameValue(selected);
    setMergeValue('');
    mfl().tags.films(selected).then((rows: FilmRow[]) => {
      if (!cancelled) setFilms(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  const search = toTraditional(tagSearch.trim().toLowerCase());
  const visibleTags = useMemo(
    () => search ? tags.filter(t => toTraditional(t.tag.toLowerCase()).includes(search)) : tags,
    [tags, search],
  );

  const selectedTagAgg = tags.find(t => t.tag === selected) ?? null;

  const doRename = async () => {
    if (!selected) return;
    const next = renameValue.trim();
    if (!next) { toast.push({ text: '新标签名不能为空', kind: 'error' }); return; }
    if (next === selected) { setRenaming(false); return; }
    setBusy(true);
    try {
      await mfl().tags.rename(selected, next);
      toast.push({ text: `已重命名：${selected} → ${next}`, kind: 'success' });
      setSelected(next);
      reloadTags();
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally { setBusy(false); }
  };

  const doMerge = async () => {
    if (!selected) return;
    const target = mergeValue.trim();
    if (!target) { toast.push({ text: '请输入目标标签名', kind: 'error' }); return; }
    if (target === selected) { toast.push({ text: '不能合并到自己', kind: 'error' }); return; }
    if (!confirm(`将标签「${selected}」合并到「${target}」？\n所有带该标签的影片会改挂到目标标签，源标签将被删除。此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await mfl().tags.merge(selected, target);
      toast.push({ text: `已合并：${selected} → ${target}`, kind: 'success' });
      setSelected(target);
      reloadTags();
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!selected) return;
    const n = selectedTagAgg?.count ?? 0;
    if (!confirm(`删除标签「${selected}」？\n将从 ${n} 部影片中移除该标签（影片本身保留）。此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await mfl().tags.remove(selected);
      toast.push({ text: `已删除标签：${selected}`, kind: 'success' });
      setSelected(null);
      reloadTags();
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
      {/* 左列：搜索 + 标签列表 */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, height: '100%' }}>
        <div style={{ flexShrink: 0, position: 'relative', zIndex: 2 }} onMouseDown={e => e.stopPropagation()}>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={tagSearch}
            onChange={e => setTagSearch(e.target.value)}
            placeholder="搜索 标签"
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
          {visibleTags.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 4 }}>无匹配标签</div>}
          {visibleTags.map(t => (
            <div
              key={t.tag}
              onClick={() => setSelected(t.tag)}
              style={{
                padding: 6, cursor: 'pointer', borderRadius: 4,
                background: selected === t.tag ? '#2a2a2a' : 'transparent',
              }}
            >
              {t.tag} <span style={{ color: '#888', fontSize: 12 }}>({t.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* 右列：详情 + 操作 + 影片表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {selected ? (
          <>
            <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>选中标签：</span>
              <strong>{selected}</strong>
              <span style={{ color: '#888', fontSize: 12 }}>({selectedTagAgg?.count ?? films.length} 部)</span>
            </div>

            {/* 操作区（折叠）：重命名 / 合并到 / 删除 */}
            <details style={{ marginBottom: 12, padding: 8, background: '#1a2228', borderRadius: 4, fontSize: 12, border: '1px solid #333' }}>
              <summary style={{ color: '#aaa', cursor: 'pointer', userSelect: 'none' }}>重命名 / 合并 / 删除</summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 重命名 */}
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
                    <button type="button" disabled={busy} onClick={() => { setRenameValue(selected); setRenaming(true); }}>重命名</button>
                  )}
                </div>
                {/* 合并到 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#999' }}>合并到：</span>
                  <input
                    value={mergeValue}
                    onChange={e => setMergeValue(e.target.value)}
                    placeholder="目标标签名"
                    onMouseDown={e => e.stopPropagation()}
                    style={{ flex: '0 1 220px', minWidth: 120, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                  <button type="button" disabled={busy || !mergeValue.trim()} onClick={() => void doMerge()}>合并</button>
                </div>
                {/* 删除 */}
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void doDelete()}
                    style={{ padding: '2px 8px', border: '1px solid #6a2a2a', borderRadius: 4, background: '#3a1010', color: '#e08080', cursor: 'pointer' }}
                  >
                    删除标签
                  </button>
                </div>
              </div>
            </details>

            <FilmTable
              rows={films}
              onRowDoubleClick={(film) => nav(`/film/${film.id}`, {
                state: { from: 'tags', listIds: films.map(f => f.id) },
              })}
            />
            {films.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 4 }}>该标签下暂无影片</div>}
          </>
        ) : <div>选择左侧标签</div>}
      </div>
    </div>
  );
}
