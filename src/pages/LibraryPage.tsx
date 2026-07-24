import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { MflApi } from '../api';
import type { FilmFilter, FilmRow } from '../api/types';
import FilmTable from '../components/FilmTable';
import FilterBar from '../components/FilterBar';
import { useToast } from '../components/Toaster';

// Resolve the IPC bridge live (see FilterBar for rationale).
const mfl = (): MflApi => (window as any).mfl;

const PAGE_SIZE = 1000;
// 进详情前保存主内容区 scrollTop，返回时恢复（Layout 主区 id=mfl-main-scroll）。
const LIST_SCROLL_KEY = 'mfl:libraryListScroll';
const SCROLL_RESTORE_MAX_FRAMES = 60;

type SortBy = NonNullable<FilmFilter['sort_by']>;

function parseSortBy(raw: string | null): SortBy {
  if (raw === 'code' || raw === 'actors' || raw === 'title' || raw === 'updated_at' || raw === 'fs_mtime_ms' || raw === 'scraped_at') return raw;
  return 'updated_at';
}

function parseSortDir(raw: string | null): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

function parseIdList(raw: string | null): number[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  return ids.length ? ids : undefined;
}

function parseStrList(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function filterFromParams(sp: URLSearchParams): FilmFilter {
  const page = Math.max(1, Number(sp.get('page') || '1') || 1);
  return {
    page,
    page_size: PAGE_SIZE,
    sort_by: parseSortBy(sp.get('sort_by')),
    sort_dir: parseSortDir(sp.get('sort_dir')),
    q: sp.get('q') ?? undefined,
    // chip 筛选必须进 URL，否则 FilterBar onChange 后立刻被 searchParams 丢掉
    actors: parseIdList(sp.get('actors')),
    genres: parseIdList(sp.get('genres')),
    tags: parseStrList(sp.get('tags')),
    locales: parseStrList(sp.get('locales')),
    statuses: parseStrList(sp.get('statuses')) as FilmFilter['statuses'],
    duplicate_codes_only: sp.get('duplicates') === '1' || undefined,
  };
}

function paramsFromFilter(f: FilmFilter): URLSearchParams {
  const next = new URLSearchParams();
  if (f.q) next.set('q', f.q);
  if (f.page && f.page !== 1) next.set('page', String(f.page));
  if (f.sort_by && f.sort_by !== 'updated_at') next.set('sort_by', f.sort_by);
  if (f.sort_dir) next.set('sort_dir', f.sort_dir);
  if (f.sort_by === 'updated_at' && f.sort_dir === 'desc') next.delete('sort_dir');
  if (f.actors?.length) next.set('actors', f.actors.join(','));
  if (f.genres?.length) next.set('genres', f.genres.join(','));
  if (f.tags?.length) next.set('tags', f.tags.join(','));
  if (f.locales?.length) next.set('locales', f.locales.join(','));
  if (f.statuses?.length) next.set('statuses', f.statuses.join(','));
  if (f.duplicate_codes_only) next.set('duplicates', '1');
  return next;
}

function getMainScrollEl(): HTMLElement | null {
  return document.getElementById('mfl-main-scroll');
}

function readSavedListScroll(): number | null {
  const raw = sessionStorage.getItem(LIST_SCROLL_KEY);
  const value = raw == null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function saveListScroll(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (normalized > 0) sessionStorage.setItem(LIST_SCROLL_KEY, String(normalized));
  else clearSavedListScroll();
}

function clearSavedListScroll() {
  sessionStorage.removeItem(LIST_SCROLL_KEY);
}

export default function LibraryPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // 排序/分页/搜索以 URL 为源：进详情再 history.back 时 query 仍在，状态自然恢复。
  const filter = useMemo(() => filterFromParams(searchParams), [searchParams]);

  const [rows, setRows] = useState<FilmRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // 批量勾选：仅当前会话内存；换页/换筛选时清空，避免跨页误刮。
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  // 仅表示「本页刚点了启动」的短暂 loading；真正任务在主进程，切页不丢。
  const [startingBatch, setStartingBatch] = useState(false);
  // 恢复成功前一直保留 storage，避免 StrictMode 双挂载或布局尚未完成时丢失位置。
  const pendingScrollRef = useRef<number | null>(readSavedListScroll());

  const setFilter = (f: FilmFilter) => {
    const prev = filter;
    const changed = f.q !== prev.q || f.actors !== prev.actors || f.genres !== prev.genres
      || f.tags !== prev.tags || f.locales !== prev.locales || f.statuses !== prev.statuses
      || f.include_deleted !== prev.include_deleted || f.duplicate_codes_only !== prev.duplicate_codes_only
      || f.sort_by !== prev.sort_by || f.sort_dir !== prev.sort_dir;
    const next: FilmFilter = changed ? { ...f, page: 1, page_size: PAGE_SIZE } : { ...f, page_size: PAGE_SIZE };
    setSearchParams(paramsFromFilter(next), { replace: true });
    // 筛选/排序变化清空勾选，避免用户以为还在刮「当前可见」的一批。
    if (changed) setSelectedIds(new Set());
  };

  useEffect(() => {
    let cancelled = false;
    const api = mfl();
    if (!api?.library?.list) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.library.list({ ...filter, page_size: PAGE_SIZE }).then(r => {
      if (!cancelled) { setRows(r.items); setTotal(r.total); }
    }).catch(e => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' })).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filter]);

  // rows 到位后等待主容器真正可滚动；只有实际恢复成功才清掉保存值。
  useLayoutEffect(() => {
    if (loading || rows.length === 0) return;
    const target = pendingScrollRef.current ?? readSavedListScroll();
    if (target == null) return;
    pendingScrollRef.current = target;

    let cancelled = false;
    let frame = 0;
    let attempts = 0;

    const tryRestore = () => {
      const el = getMainScrollEl();
      if (!el) return false;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 1) return false;

      const desired = Math.min(target, maxScroll);
      el.scrollTop = desired;
      if (Math.abs(el.scrollTop - desired) > 2) return false;

      pendingScrollRef.current = null;
      clearSavedListScroll();
      return true;
    };

    const tick = () => {
      if (cancelled || tryRestore()) return;
      attempts += 1;
      if (attempts >= SCROLL_RESTORE_MAX_FRAMES) {
        pendingScrollRef.current = null;
        clearSavedListScroll();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    if (!tryRestore()) frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [rows, loading]);

  // 翻页时清空勾选（仅本页勾选语义更清晰）。
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter.page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = filter.page ?? 1;
  const goto = (p: number) => setSearchParams(paramsFromFilter({ ...filter, page: p }), { replace: true });

  const onSortChange = (key: NonNullable<FilmFilter['sort_by']>) => {
    if (filter.sort_by === key) {
      const nextDir = filter.sort_dir === 'asc' ? 'desc' : 'asc';
      setSearchParams(paramsFromFilter({ ...filter, sort_dir: nextDir, page: 1 }), { replace: true });
      return;
    }
    // 编号/修改时间默认新的在前；标题/演员/刮削默认升序（未刮削在前）
    const defaultDir: 'asc' | 'desc' =
      key === 'code' || key === 'updated_at' || key === 'fs_mtime_ms' ? 'desc' : 'asc';
    setSearchParams(paramsFromFilter({ ...filter, sort_by: key, sort_dir: defaultDir, page: 1 }), { replace: true });
  };

  const openDetail = (film: FilmRow) => {
    const el = getMainScrollEl();
    if (el) saveListScroll(el.scrollTop);
    // 带上当前页影片 id 序列，详情页可用 ←/→ 在列表中切换。
    nav(`/film/${film.id}`, {
      state: {
        from: 'library',
        listIds: rows.map(r => r.id),
      },
    });
  };

  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.id)),
    [rows, selectedIds],
  );
  const selectableWithCode = selectedRows.filter(r => !!r.code);
  const selectedNoCode = selectedRows.length - selectableWithCode.length;

  const runBatchScrape = async () => {
    if (startingBatch) return;
    if (selectedIds.size === 0) {
      toast.push({ text: '请先勾选要刮削的影片', kind: 'error' });
      return;
    }
    if (selectableWithCode.length === 0) {
      toast.push({ text: '勾选的影片都没有编号，无法刮削', kind: 'error' });
      return;
    }
    // 主进程可能已有任务
    try {
      const st = await mfl().scrape.getBatchStatus();
      if (st?.running) {
        toast.push({ text: '已有批量刮削在进行（可切换页面，进度在顶部）', kind: 'error' });
        return;
      }
    } catch { /* ignore */ }

    const msg = selectedNoCode > 0
      ? `将并行刮削 ${selectableWithCode.length} 部（另有 ${selectedNoCode} 部无编号将跳过）。可切换页面，任务不中断。是否继续？`
      : `将并行刮削 ${selectableWithCode.length} 部影片（默认并发 3）。可切换到演员/详情页，任务不中断。是否继续？`;
    if (!confirm(msg)) return;

    setStartingBatch(true);
    try {
      // 主进程并行批量：与 LibraryPage 生命周期无关，切页不打断。
      // 并发读设置；未配置时主进程默认 6
      let conc = 6;
      try {
        const s = await mfl().settings.get();
        const n = Number(s.scrape_film_concurrency);
        if (Number.isFinite(n) && n >= 1) conc = Math.min(16, Math.floor(n));
      } catch { /* use default */ }
      const result = await mfl().scrape.javbusBatch(
        selectableWithCode.map(r => r.id),
        conc,
      );
      // 回到本页时若仍挂着，刷新列表
      try {
        const r = await mfl().library.list({ ...filter, page_size: PAGE_SIZE });
        setRows(r.items);
        setTotal(r.total);
      } catch { /* ignore */ }
      toast.push({
        text: `批量刮削${result.cancelled ? '已停止' : '完成'}：成功 ${result.ok}，失败 ${result.fail}，跳过 ${result.skip}`,
        kind: result.fail > 0 ? 'error' : 'success',
      });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally {
      setStartingBatch(false);
    }
  };

  return (
    <div>
      <FilterBar value={{ ...filter, page_size: PAGE_SIZE }} onChange={setFilter} />
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-pressed={!!filter.duplicate_codes_only}
          title="只显示当前库中编号重复的影片"
          onClick={() => setFilter({ ...filter, duplicate_codes_only: !filter.duplicate_codes_only })}
          style={filter.duplicate_codes_only ? { background: '#3a5a8a', color: '#fff' } : undefined}
        >重复编号</button>
        <span style={{ width: 1, height: 16, background: '#444' }} />
        <button onClick={() => mfl().export.csv({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 CSV', kind: 'success' }))}>导出 CSV</button>
        <button onClick={() => mfl().export.json({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 JSON', kind: 'success' }))}>导出 JSON</button>
        <span style={{ width: 1, height: 16, background: '#444' }} />
        <button
          disabled={startingBatch || rows.length === 0}
          onClick={() => setSelectedIds(new Set(rows.map(r => r.id)))}
        >全选本页</button>
        <button
          disabled={startingBatch || selectedIds.size === 0}
          onClick={() => setSelectedIds(new Set())}
        >清空勾选</button>
        <button
          disabled={startingBatch || selectedIds.size === 0}
          onClick={() => void runBatchScrape()}
          title="主进程并行刮削（默认并发3）；可切换页面，进度在顶部栏；无编号跳过"
        >
          {startingBatch ? '提交任务…' : `批量刮削${selectedIds.size ? ` (${selectedIds.size})` : ''}`}
        </button>
        <button
          disabled={startingBatch}
          onClick={() => void mfl().scrape.cancelBatch().then((r: any) => {
            toast.push({ text: r.ok ? '已请求停止批量刮削' : (r.message || '当前无批量任务'), kind: r.ok ? 'success' : 'error' });
          })}
        >停止批量</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
          {loading ? '统计中…' : `共 ${total} 部影片`}
          {selectedIds.size > 0 && ` · 已选 ${selectedIds.size}`}
        </span>
      </div>
      <FilmTable
        rows={rows}
        sortKey={
          filter.sort_by === 'code' || filter.sort_by === 'actors' || filter.sort_by === 'title'
            || filter.sort_by === 'updated_at' || filter.sort_by === 'scraped_at'
            ? filter.sort_by
            : null
        }
        sortDir={filter.sort_dir}
        onSortChange={onSortChange}
        onRowDoubleClick={openDetail}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#aaa' }}>
        <span>共 {total} 条</span>
        <span>第 {page} / {pageCount} 页</span>
        <button disabled={page <= 1} onClick={() => goto(page - 1)}>上一页</button>
        <button disabled={page >= pageCount} onClick={() => goto(page + 1)}>下一页</button>
      </div>
      {loading && <div style={{ padding: 8 }}>加载中…</div>}
    </div>
  );
}
