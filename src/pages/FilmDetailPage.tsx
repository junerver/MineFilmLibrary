import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import type { FilmDetail, FilmFileRow, FilmPathStatus } from '../api/types';
import CoverGuard from '../components/CoverGuard';
import { useToast } from '../components/Toaster';
import { PrivacyText, textPrivacyActive, usePrivacySettings } from '../hooks/usePrivacySettings';

const mfl = (): any => (window as any).mfl;

/** 从列表页带入的导航 state：来源 + 可切换的影片 id 序列 */
type DetailNavState = {
  from?: 'library' | 'actors';
  listIds?: number[];
};

const LIST_IDS_KEY = 'mfl:detailListIds';

/**
 * 详情页大标题：避免「编号 + 标题」重复。
 * 例：code=xvsr-599, title="XVSR-599 絶対本番…" → 只显示 title。
 * 若标题不含编号（或无标题）→ 显示 "CODE 标题" / 仅 CODE / 仅标题。
 */
function formatDetailHeading(code: string | null | undefined, title: string | null | undefined): string {
  const c = (code ?? '').trim();
  const t = (title ?? '').trim();
  if (!c && !t) return '';
  if (!c) return t;
  if (!t) return c.toUpperCase();

  const codeUpper = c.toUpperCase();
  // 去掉编号里常见分隔符再比一次（XVSR-599 / XVSR599 / xvsr_599）
  const codeCompact = codeUpper.replace(/[-_\s]/g, '');
  const titleUpper = t.toUpperCase();
  const titleCompact = titleUpper.replace(/[-_\s]/g, '');

  const titleHasCode =
    titleUpper.includes(codeUpper)
    || (codeCompact.length >= 3 && titleCompact.includes(codeCompact));

  if (titleHasCode) return t;
  return `${codeUpper} ${t}`;
}

// 编辑表单字段定义：依次为 字段键 / 中文标签 / 是否长文本。
// 用数组驱动渲染可保证每个 input 都带可见 label——这正是 Q6 缺失的部分。
const EDIT_FIELDS: { key: 'code' | 'title' | 'locale' | 'tags' | 'parent_dir_name' | 'notes'; label: string; multiline?: boolean }[] = [
  { key: 'code', label: '编号' },
  { key: 'title', label: '标题' },
  { key: 'locale', label: '后缀 (C / U)' },
  { key: 'tags', label: '标签 (逗号分隔)' },
  { key: 'parent_dir_name', label: '父目录' },
  { key: 'notes', label: '备注', multiline: true },
];

export default function FilmDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  // location.state.from 标记来源页。返回时：
  // - actors / library → navigate(-1)，保留来源页的 query（排序/选中演员）与 history 上的滚动恢复。
  // - 无 state（刷新/外链）→ 回 /library。
  // listIds：来源列表的影片 id 顺序，用于详情内 ←/→ 切换。
  const location = useLocation();
  const navState = (location.state as DetailNavState | null) ?? null;
  const from = navState?.from;
  const backWithHistory = from === 'actors' || from === 'library';
  // 列表 id 存在 sessionStorage 备份：刷新详情页后仍尽量能切换（同一会话内）。
  const listIds = useMemo(() => {
    const fromState = navState?.listIds?.filter(n => Number.isFinite(n) && n > 0) ?? [];
    if (fromState.length > 0) {
      try { sessionStorage.setItem(LIST_IDS_KEY, JSON.stringify(fromState)); } catch { /* ignore */ }
      return fromState;
    }
    try {
      const raw = sessionStorage.getItem(LIST_IDS_KEY);
      if (!raw) return [] as number[];
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed.filter(n => Number.isFinite(n) && n > 0) : [];
    } catch {
      return [] as number[];
    }
  }, [navState?.listIds]);

  const filmId = Number(id);
  const listIndex = listIds.indexOf(filmId);
  const hasList = listIds.length > 1 && listIndex >= 0;
  const prevId = hasList ? listIds[listIndex - 1] : undefined;
  const nextId = hasList ? listIds[listIndex + 1] : undefined;

  const toast = useToast();
  const privacy = usePrivacySettings();
  const blurText = textPrivacyActive(privacy);
  const [film, setFilm] = useState<FilmDetail | null>(null);
  const [files, setFiles] = useState<FilmFileRow[]>([]);
  const [pathStatus, setPathStatus] = useState<FilmPathStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  // 演员编辑：自动补全输入 + 已选 tags + 库中不存在则新建演员。
  // selectedActors 同时保留 id+name，方便保存时不另外反查、且新建的演员也立即可见。
  const [selectedActors, setSelectedActors] = useState<{ id: number; name: string }[]>([]);
  const [actorInput, setActorInput] = useState('');
  const [actorSuggest, setActorSuggest] = useState<{ id: number; name: string }[]>([]);
  const [actorSuggestIdx, setActorSuggestIdx] = useState(-1);
  const [scraping, setScraping] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);

  /** 在列表中切换详情：保留 from + listIds，用 replace 避免堆叠 history。 */
  const goSibling = useCallback((targetId: number | undefined) => {
    if (targetId == null) return;
    nav(`/film/${targetId}`, {
      replace: true,
      state: {
        from: from ?? 'library',
        listIds,
      } satisfies DetailNavState,
    });
  }, [nav, from, listIds]);

  // 左右方向键切换；在输入框/可编辑区时不拦截。
  useEffect(() => {
    if (!hasList) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (editing || scraping) return;
      if (e.key === 'ArrowLeft') {
        if (prevId != null) {
          e.preventDefault();
          goSibling(prevId);
        }
      } else if (e.key === 'ArrowRight') {
        if (nextId != null) {
          e.preventDefault();
          goSibling(nextId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasList, prevId, nextId, editing, scraping, goSibling]);

  useEffect(() => {
    if (!id) return;
    const n = Number(id);
    let cancelled = false;
    setFilm(null);
    setFiles([]);
    setPathStatus(null);
    mfl().library.get(n).then((f: FilmDetail | null) => {
      if (!cancelled && f) {
        setFilm(f);
        setForm({
          code: f.code ?? '',
          title: f.title ?? '',
          locale: f.locale ?? '',
          notes: f.notes ?? '',
          tags: f.tags.join(', '),
          parent_dir_name: f.parent_dir_name,
        });
        // 详情页返回的 actors 直接作为已选初值；保留 id+name 两个属性。
        setSelectedActors(f.actors.map(a => ({ id: a.id, name: a.name })));
      }
    }).catch((e: unknown) => {
      if (!cancelled) toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    });
    mfl().files.listByFilm(n).then((r: FilmFileRow[]) => {
      if (!cancelled) setFiles(r);
    }).catch((e: unknown) => {
      if (!cancelled) toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    });
    mfl().files.pathStatus(n).then((r: FilmPathStatus) => {
      if (!cancelled) setPathStatus(r);
    }).catch(() => {
      if (!cancelled) setPathStatus({ valid: false, reason: 'unreadable' });
    });
    return () => { cancelled = true; };
  }, [id]);

  if (!film) return <div>加载中…</div>;

  // 输入框文字变化就去 quickFind 拉建议；为简单起见不加 debounce——
  // 演员库通常几百量级，IPC 往返很快，windowing 也在后端 LIMIT 20 已卡住。
  const onActorInputChange = (v: string) => {
    setActorInput(v);
    setActorSuggestIdx(-1);
    const term = v.trim();
    if (!term) { setActorSuggest([]); return; }
    mfl().actors.quickFind(term).then((r: { id: number; name: string }[]) => {
      // 把已经选中的从建议里过滤掉，免得用户再点一遍造成重复。
      const selectedIds = new Set(selectedActors.map(a => a.id));
      setActorSuggest(r.filter(s => !selectedIds.has(s.id)));
    }).catch(() => setActorSuggest([]));
  };

  // 在建议里选一项。
  const pickActorSuggestion = (idx: number) => {
    const s = actorSuggest[idx];
    if (!s) return;
    setSelectedActors(prev => [...prev, { id: s.id, name: s.name }]);
    setActorInput('');
    setActorSuggest([]);
    setActorSuggestIdx(-1);
  };

  // 没选中任何建议（输入框有文本但按 Enter 或点"添加"）：
  //   - 若输入和某个已选演员名重名，跳过；
  //   - 否则视为新建演员 → actors.create 拿 id 后塞进 selectedActors。
  const commitActorInput = async () => {
    const name = actorInput.trim();
    if (!name) return;
    if (selectedActors.some(a => a.name.toLowerCase() === name.toLowerCase())) {
      toast.push({ text: '该演员已添加', kind: 'info' });
      setActorInput('');
      setActorSuggest([]);
      return;
    }
    try {
      const newId = await mfl().actors.create(name);
      setSelectedActors(prev => [...prev, { id: newId, name }]);
      setActorInput('');
      setActorSuggest([]);
      setActorSuggestIdx(-1);
      toast.push({ text: `已新建演员「${name}」`, kind: 'success' });
    } catch (e: unknown) {
      toast.push({ text: `新建演员失败：${String((e as Error)?.message ?? e)}`, kind: 'error' });
    }
  };

  // 键盘导航建议列表：上/下切换、Enter 选择（无建议时 Enter 走 commitActorInput）。
  const onActorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActorSuggestIdx(i => Math.min(i + 1, actorSuggest.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActorSuggestIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (actorSuggestIdx >= 0 && actorSuggestIdx < actorSuggest.length) pickActorSuggestion(actorSuggestIdx);
      else void commitActorInput();
    } else if (e.key === 'Escape') {
      setActorSuggest([]);
      setActorSuggestIdx(-1);
    }
  };

  const removeSelectedActor = (actorId: number) => {
    setSelectedActors(prev => prev.filter(a => a.id !== actorId));
  };

  const save = async () => {
    const patch: any = {
      code: form.code || null,
      title: form.title || null,
      locale: form.locale || null,
      notes: form.notes || null,
      parent_dir_name: form.parent_dir_name,
      tags: (form.tags as string).split(',').map((s: string) => s.trim()).filter(Boolean),
      actor_ids: selectedActors.map(a => a.id),
    };
    try {
      await mfl().library.update(film.id, patch);
      toast.push({ text: '已保存', kind: 'success' });
      setEditing(false);
      // 保存成功后直接用 selectedActors 重建 film.actors，省一次详情请求。
      setFilm({ ...film, ...patch, tags: patch.tags, actors: selectedActors.map(a => ({ id: a.id, name: a.name })) });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  const softDelete = async () => {
    if (!confirm('软删除？')) return;
    try {
      await mfl().library.softDelete(film.id);
      // 软删除后同样尽量退回带来源 query 的列表页。
      if (backWithHistory) nav(-1);
      else nav('/library');
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  const restat = async () => {
    try {
      await mfl().files.restat(film.id);
      const r = await mfl().files.listByFilm(film.id);
      setFiles(r);
      setPathStatus(await mfl().files.pathStatus(film.id));
      toast.push({ text: '已重新枚举文件', kind: 'success' });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  /** 手动切换刮削标记：已刮削 ↔ 未刮削（写 films.scraped_at）。 */
  const toggleScrapedMark = async () => {
    if (!film) return;
    const next = film.scraped_at ? null : Date.now();
    try {
      await mfl().library.update(film.id, { scraped_at: next });
      setFilm({ ...film, scraped_at: next });
      toast.push({
        text: next ? '已标记为「已刮削」' : '已取消刮削标记',
        kind: 'success',
      });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  // JavBus 刮削：按编号拉标题/演员/题材/封面/预览图。
  // 订阅 scrape:progress 显示阶段进度，避免长时间无反馈。
  const scrapeJavbus = async () => {
    if (!film.code) {
      toast.push({ text: '编号为空，无法刮削', kind: 'error' });
      return;
    }
    if (scraping) return;
    setScraping(true);
    setScrapeStatus('准备刮削…');
    const off = mfl().scrape?.onProgress
      ? mfl().scrape.onProgress((p: { filmId: number; message: string }) => {
          if (p.filmId === film.id) setScrapeStatus(p.message);
        })
      : () => {};
    try {
      const r = await mfl().scrape.javbus(film.id);
      const writtenN = (r.filesWritten as string[] | undefined)?.length ?? 0;
      const sOk = r.samplesOk ?? 0;
      const sFail = r.samplesFail ?? 0;
      const sFound = r.samplesFound ?? 0;
      toast.push({
        text: r.dirExists
          ? `刮削完成：写 ${writtenN} 文件，预览 ${sOk}/${sFound}（失败 ${sFail}），演员 ${r.actresses?.length ?? 0}`
          : `刮削完成（目录不存在，仅元数据）：演员 ${r.actresses?.length ?? 0}`,
        kind: sFail > 0 && sOk === 0 ? 'error' : 'success',
      });
      const f = await mfl().library.get(film.id);
      if (f) {
        setFilm(f);
        setSelectedActors(f.actors.map((a: { id: number; name: string }) => ({ id: a.id, name: a.name })));
        setForm({
          code: f.code ?? '',
          title: f.title ?? '',
          locale: f.locale ?? '',
          notes: f.notes ?? '',
          tags: f.tags.join(', '),
          parent_dir_name: f.parent_dir_name,
        });
      }
      const files = await mfl().files.listByFilm(film.id);
      setFiles(files);
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally {
      off();
      setScraping(false);
      setScrapeStatus(null);
    }
  };

  const detailHeading = formatDetailHeading(film.code, film.title);

  return (
    <div>
      {/* 顶部导航：返回 + 列表内前后切换（按钮 / ← → 键） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => (backWithHistory ? nav(-1) : nav('/library'))}>返回</button>
        {hasList && (
          <>
            <button
              type="button"
              disabled={prevId == null || editing || scraping}
              onClick={() => goSibling(prevId)}
              title="上一片（←）"
            >
              ← 上一片
            </button>
            <button
              type="button"
              disabled={nextId == null || editing || scraping}
              onClick={() => goSibling(nextId)}
              title="下一片（→）"
            >
              下一片 →
            </button>
            <span style={{ color: '#888', fontSize: 12 }}>
              {listIndex + 1} / {listIds.length}
              <span style={{ marginLeft: 8, color: '#666' }}>快捷键 ← →</span>
            </span>
          </>
        )}
      </div>
      {/* 刮削标记在标题前，位置固定；标题若已含编号则不重复前缀编号；标题单行省略 */}
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => void toggleScrapedMark()}
          title={film.scraped_at
            ? `刮削于 ${new Date(film.scraped_at).toLocaleString()}（点击取消标记）`
            : '点击标记为已刮削（批量刮削会跳过）'}
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: '2px 10px',
            borderRadius: 10,
            cursor: 'pointer',
            flexShrink: 0,
            border: film.scraped_at ? '1px solid #2a5a40' : '1px solid #444',
            background: film.scraped_at ? '#1e3a2f' : '#2a2a2a',
            color: film.scraped_at ? '#8f8' : '#888',
          }}
        >
          {film.scraped_at ? '已刮削' : '未刮削'}
        </button>
        <PrivacyText
          blur={blurText}
          style={{
            fontWeight: 700,
            display: 'block',
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span title={detailHeading || undefined}>{detailHeading}</span>
        </PrivacyText>
      </h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <CoverGuard filmId={film.id} />
        <div style={{ flex: 1 }}>
          {!editing ? (
            <>
              {/* 编号永不模糊；其它字段在隐私文字开启时模糊，按住查看 */}
              <Row k="编号" v={film.code ? film.code.toUpperCase() : null} />
              <Row k="后缀" v={<PrivacyText blur={blurText}>{film.locale ?? '—'}</PrivacyText>} />
              <Row k="标签" v={<PrivacyText blur={blurText}>{film.tags.join(', ') || '—'}</PrivacyText>} />
              <Row k="演员" v={<PrivacyText blur={blurText}>{film.actors.map(a => a.name).join(', ') || '—'}</PrivacyText>} />
              <Row k="题材" v={<PrivacyText blur={blurText}>{film.genres.map(g => g.name).join(', ') || '—'}</PrivacyText>} />
              <Row k="刮削" v={<PrivacyText blur={blurText}>{film.scraped_at ? new Date(film.scraped_at).toLocaleString() : '未刮削'}</PrivacyText>} />
              <Row k="父目录" v={<PrivacyText blur={blurText}>{film.parent_dir_name || '—'}</PrivacyText>} />
              <Row k="路径" v={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
                  <PathStatusIcon status={pathStatus} />
                  <PrivacyText blur={blurText}>{film.abs_path || '—'}</PrivacyText>
                </span>
              } />
              <Row k="备注" v={<PrivacyText blur={blurText}>{film.notes || '—'}</PrivacyText>} />
              {film.same_code_films && film.same_code_films.length > 0 && (
                <Row k="同编号" v={
                  <PrivacyText blur={blurText} as="span">
                    另有 {film.same_code_films.length} 份同编号影片：
                    {film.same_code_films.map((s, i) => (
                      <span key={s.id}>
                        {i > 0 && '、'}
                        <a href="#" onClick={e => { e.preventDefault(); nav(`/film/${s.id}`); }} style={{ color: '#ffd0a0' }}>
                          {s.parent_dir_name || '(平铺)'} / {s.abs_path}
                        </a>
                      </span>
                    ))}
                  </PrivacyText>
                } />
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={() => void scrapeJavbus()} disabled={scraping || !film.code} title={!film.code ? '编号为空' : '按编号从 JavBus 刮削标题/演员/预览图'}>
                  {scraping ? '刮削中…' : 'JavBus 刮削'}
                </button>
                <button onClick={() => void mfl().files.openInFolder(film.id)}>打开文件夹</button>
                <button onClick={softDelete}>软删除</button>
              </div>
              {scrapeStatus && (
                <div style={{ marginTop: 6, padding: 6, background: '#222', borderRadius: 4, fontSize: 12, color: '#ccc' }}>
                  {scrapeStatus}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* 用 label 绑定每个字段，避免 Q6 那种"只有输入框没有标题"的状态。 */}
              {EDIT_FIELDS.map(f => (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                  <span style={{ color: '#999' }}>{f.label}</span>
                  {f.multiline
                    ? <textarea value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} rows={3} style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }} />
                    : <input value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }} />}
                </label>
              ))}
              {/* 演员编辑：自动补全输入 + 已选 tags。
                  输入时实时拉建议（含别名命中）；选中建议 → 加到已选；
                  输入文字但建议里没匹配（或直接回车）→ 当作新建演员，调 actors.create 后再加进已选。
                  这样既能复用库中已有演员，也允许为未知演员当场建名。 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, position: 'relative' }}>
                <span style={{ color: '#999', fontSize: 12 }}>演员 {selectedActors.length > 0 && `(已选 ${selectedActors.length})`}</span>
                {selectedActors.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {selectedActors.map(a => (
                      <span key={a.id} style={{ padding: '2px 6px', background: '#3a5a8a', borderRadius: 10, fontSize: 12 }}>
                        {a.name}
                        <button onClick={() => removeSelectedActor(a.id)} style={{ marginLeft: 4, color: '#ffd0a0', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    value={actorInput}
                    onChange={e => onActorInputChange(e.target.value)}
                    onKeyDown={onActorKeyDown}
                    onBlur={() => setTimeout(() => setActorSuggest([]), 150)}
                    placeholder="输入演员名，自动匹配；不存在则新建"
                    style={{ flex: 1, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                  <button onClick={() => void commitActorInput()}>添加</button>
                </div>
                {/* 建议下拉：positioned absolute 跟在输入框下面。
                    blur 后延迟 150ms 关闭，让用户能点到建议项再消失。 */}
                {actorSuggest.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, marginTop: 2, zIndex: 50, maxHeight: 200, overflowY: 'auto' }}>
                    {actorSuggest.map((s, i) => (
                      <div key={s.id}
                           onMouseDown={e => { e.preventDefault(); pickActorSuggestion(i); }}
                           style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12, background: i === actorSuggestIdx ? '#3a5a8a' : 'transparent' }}>
                        {s.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={save}>保存</button>
                <button onClick={() => setEditing(false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <h3 style={{ marginTop: 16 }}>文件</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>名称</th><th>类型</th><th>体积</th><th>修改时间</th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.is_video ? '视频' : (f.is_image ? '图片' : f.ext)}</td>
              <td>{(f.size / 1024 / 1024).toFixed(1)} MB</td>
              <td>{new Date(f.mtime_ms).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={restat} style={{ marginTop: 8 }}>重新枚举</button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div style={{ marginBottom: 2 }}><span style={{ color: '#999', marginRight: 8 }}>{k}:</span>{v ?? '—'}</div>;
}

function PathStatusIcon({ status }: { status: FilmPathStatus | null }) {
  const title = status == null
    ? '正在检查影片目录'
    : status.valid
      ? '影片目录有效'
      : status.reason === 'not_directory'
        ? '保存的路径不是目录'
        : status.reason === 'unreadable'
          ? '影片目录无法访问'
          : status.reason === 'film_not_found'
            ? '影片记录不存在'
            : '影片目录不存在';
  const color = status == null ? '#999' : status.valid ? '#86efac' : '#fca5a5';
  const border = status == null ? '#555' : status.valid ? '#2f6f46' : '#7f3333';
  const background = status == null ? '#2a2a2a' : status.valid ? '#173b27' : '#4a2020';

  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: `1px solid ${border}`,
        background,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 1,
        fontWeight: 700,
      }}
    >
      {status == null ? '…' : status.valid ? '✓' : '!'}
    </span>
  );
}
