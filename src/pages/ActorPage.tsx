import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ActorJavbusData, ActorRow, FilmRow } from '../api/types';
import FilmTable from '../components/FilmTable';
import { useToast } from '../components/Toaster';

const mfl = (): any => (window as any).mfl;

// sessionStorage key：演员列表左侧 scrollTop。
// 注意：React StrictMode 会双挂载；不能在第一次 effect 里 removeItem，否则第二次 mount 读不到。
// 用模块级缓存 + 成功 restore 后再清 storage。
const LIST_SCROLL_KEY = 'mfl:actorListScroll';
/** 跨 StrictMode 双挂载共享的待恢复 scrollY；undefined=尚未读 storage */
let cachedPendingScroll: number | null | undefined;

type ActorMetaForm = {
  name: string;
  category: string;
  notes: string;
  aliases: string;
  javbus_url: string;
  birthday: string;
  age: string;
  height: string;
  cup: string;
  bust: string;
  waist: string;
  hips: string;
  measurements: string;
  hobby: string;
};

const ACTOR_PROFILE_KEYS = [
  'birthday', 'age', 'height', 'cup', 'bust', 'waist', 'hips', 'measurements', 'hobby',
] as const;

const ACTOR_PROFILE_LABELS: Record<(typeof ACTOR_PROFILE_KEYS)[number], string> = {
  birthday: '生日',
  age: '年龄',
  height: '身高',
  cup: '罩杯',
  bust: '胸围',
  waist: '腰围',
  hips: '臀围',
  measurements: '三围',
  hobby: '爱好',
};

function normalizeProfileLabel(value: string): string {
  return value.toLowerCase().replace(/[\s：:._-]/g, '');
}

const KNOWN_PROFILE_LABELS = new Set([
  '生日', '出生日期', 'birthday', '生年月日',
  '年龄', '年齡', 'age',
  '身高', 'height',
  '罩杯', 'cup',
  '胸围', '胸圍', 'bust', 'b',
  '腰围', '腰圍', 'waist', 'w',
  '臀围', '臀圍', 'hips', 'hip', 'h',
  '三围', '三圍', 'measurements',
  '爱好', '愛好', '兴趣', '興趣', 'hobby', '趣味',
].map(normalizeProfileLabel));

function readPendingScroll(): number | null {
  if (cachedPendingScroll !== undefined) return cachedPendingScroll;
  const raw = sessionStorage.getItem(LIST_SCROLL_KEY);
  const n = raw != null ? Number(raw) : 0;
  cachedPendingScroll = Number.isFinite(n) && n > 0 ? n : null;
  return cachedPendingScroll;
}

function saveListScroll(y: number) {
  const v = Math.max(0, Math.round(y));
  sessionStorage.setItem(LIST_SCROLL_KEY, String(v));
  cachedPendingScroll = v > 0 ? v : null;
}

function clearPendingScroll() {
  sessionStorage.removeItem(LIST_SCROLL_KEY);
  cachedPendingScroll = null;
}

export default function ActorPage() {
  const toast = useToast();
  const nav = useNavigate();
  // 用 URL query `?actor=N` 持久化当前选中演员——这样进详情页再返回时
  // (浏览器 history back 或显式 nav 回 /actors) 还能恢复选中状态，
  // 而不是退回"未选中"的初始空白态。
  const [searchParams, setSearchParams] = useSearchParams();
  const initialActor = searchParams.get('actor');
  const [actors, setActors] = useState<ActorRow[]>([]);
  const [selected, setSelected] = useState<number | null>(initialActor ? Number(initialActor) : null);
  const [films, setFilms] = useState<FilmRow[]>([]);
  // 左侧演员列表的搜索框：纯前端按 name/aliases 子串过滤，没有 IPC 往返。
  // 大小写不敏感以应对大小写不一的别名（例如 0-Ogura vs ogura）。
  const [actorSearch, setActorSearch] = useState('');
  // 演员元数据编辑表单：名称 / 分类 / 备注 / 别名 / JavBus 地址都嵌在同一表单里。
  // 没有独立的"别名/合并"面板——别名作为元数据的一部分。
  const [metaEditing, setMetaEditing] = useState(false);
  const [metaForm, setMetaForm] = useState<ActorMetaForm>({
    name: '', category: '', notes: '', aliases: '', javbus_url: '',
    birthday: '', age: '', height: '', cup: '', bust: '', waist: '', hips: '', measurements: '', hobby: '',
  });
  const [actorJavbusData, setActorJavbusData] = useState<ActorJavbusData | null>(null);
  const [actorScraping, setActorScraping] = useState(false);
  const [actorTab, setActorTab] = useState<'films' | 'works'>('films');
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;
  // 合并：把「当前选中」并入目标演员；当前名会变成目标的别名（适合中文名 / 假名）。
  // 目标可用下拉或手动输入自动匹配（名称 / 别名）。
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeSuggestOpen, setMergeSuggestOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // 元数据表单首个输入框：打开编辑时主动 focus，避免偶发点不中/无焦点。
  const metaNameInputRef = useRef<HTMLInputElement | null>(null);
  // 待恢复的 scrollTop（从 storage / 模块缓存读入）。
  const pendingScrollRef = useRef<number | null>(readPendingScroll());
  const restoreTriesRef = useRef(0);
  // 恢复期间禁止 scroll 监听把 0 写回 storage，覆盖真正的待恢复值。
  const suppressScrollSaveRef = useRef(false);
  // 父级 #mfl-main-scroll 的像素高度：height:100% 在 overflow:auto 父级上经常失效，
  // 导致左侧列表撑满内容、实际滚动的是外层主区域，listScrollRef.scrollTop 恒为 0。
  const [paneHeight, setPaneHeight] = useState(0);

  // 量主内容区高度，给本页一个明确像素高，左右列才能各自 overflow 滚动。
  useLayoutEffect(() => {
    const main = document.getElementById('mfl-main-scroll');
    if (!main) return;
    const apply = () => {
      // clientHeight 含 padding；子元素可用高度 = clientHeight - paddingTop - paddingBottom
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

  // 选中变化时同步到 URL query。replace: true 避免每次点选都堆一条 history，
  // 否则从详情页返回会因为 history 栈里有多次演员切换而要连按多次 back。
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selected == null) next.delete('actor');
    else next.set('actor', String(selected));
    // 只在值真正变化时 replace，否则会触发不必要 re-render。
    if (next.get('actor') !== searchParams.get('actor')) setSearchParams(next, { replace: true });
  }, [selected]);

  const reloadActors = () => {
    mfl().actors.list().then(setActors).catch(() => {});
  };
  useEffect(reloadActors, []);

  // 列表滚动时持续写入 sessionStorage。
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (suppressScrollSaveRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 只有真正发生列表内滚动才保存（clientHeight 已约束）
        if (el.scrollHeight > el.clientHeight + 1) saveListScroll(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [actors.length, paneHeight]);

  // actors + 高度就绪后恢复滚动。
  useLayoutEffect(() => {
    const target = pendingScrollRef.current ?? readPendingScroll();
    if (target == null || target <= 0) return;
    if (!paneHeight) return; // 等量到高度
    pendingScrollRef.current = target;
    suppressScrollSaveRef.current = true;

    const tryRestore = (): boolean => {
      const el = listScrollRef.current;
      if (!el) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      el.scrollTop = target;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (el.scrollTop + 2 < Math.min(target, maxScroll)) return false;
      clearPendingScroll();
      pendingScrollRef.current = null;
      restoreTriesRef.current = 0;
      // 延迟解除 suppress，避免 restore 触发的 scroll 事件写 0
      setTimeout(() => { suppressScrollSaveRef.current = false; }, 100);
      return true;
    };

    if (tryRestore()) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      restoreTriesRef.current += 1;
      if (tryRestore() || restoreTriesRef.current > 40) {
        if (restoreTriesRef.current > 40) {
          clearPendingScroll();
          pendingScrollRef.current = null;
          restoreTriesRef.current = 0;
          suppressScrollSaveRef.current = false;
        }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, [actors, paneHeight]);

  // 应用左列搜索过滤。Name 直接 includes；别名任意匹配也算命中。
  const search = actorSearch.trim().toLowerCase();
  const visibleActors = search
    ? actors.filter(a =>
        a.name.toLowerCase().includes(search)
        || (a.aliases ?? []).some(al => al.toLowerCase().includes(search)))
    : actors;

  const selectedActor = actors.find(a => a.id === selected) ?? null;
  const scrapedProfileName = actorJavbusData?.profile?.name?.trim() || null;
  const extraProfileFields = (actorJavbusData?.profile?.fields ?? []).filter(field =>
    !KNOWN_PROFILE_LABELS.has(normalizeProfileLabel(field.label)),
  );

  // 切换选中演员时清空影片列表，并关掉可能开着的编辑表单，避免看到上一个演员的初值。
  useEffect(() => {
    if (selected == null) {
      setFilms([]);
      setActorJavbusData(null);
      return;
    }
    let cancelled = false;
    setMetaEditing(false);
    setActorScraping(false);
    setActorJavbusData(null);
    setActorTab('films');
    setMergeTargetId(null);
    setMergeQuery('');
    setMergeSuggestOpen(false);
    mfl().actors.films(selected).then((rows: FilmRow[]) => {
      if (!cancelled) setFilms(rows);
    }).catch(() => {});
    mfl().actors.getJavbusData(selected).then((data: ActorJavbusData | null) => {
      if (!cancelled) setActorJavbusData(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  // 合并目标候选：名称或别名包含输入（排除自己）。
  const mergeCandidates = (() => {
    const q = mergeQuery.trim().toLowerCase();
    const pool = actors.filter(a => a.id !== selected);
    if (!q) return pool.slice(0, 30);
    return pool.filter(a =>
      a.name.toLowerCase().includes(q)
      || (a.aliases ?? []).some(al => al.toLowerCase().includes(q)),
    ).slice(0, 30);
  })();

  const pickMergeTarget = (a: ActorRow) => {
    setMergeTargetId(a.id);
    setMergeQuery(a.name);
    setMergeSuggestOpen(false);
  };

  const doMerge = async () => {
    // 若只输入了文字未点建议，尝试精确/唯一匹配一次。
    let targetId = mergeTargetId;
    if (!targetId && mergeQuery.trim()) {
      const q = mergeQuery.trim().toLowerCase();
      const exact = actors.filter(a => a.id !== selected && (
        a.name.toLowerCase() === q
        || (a.aliases ?? []).some(al => al.toLowerCase() === q)
      ));
      if (exact.length === 1) targetId = exact[0].id;
      else if (mergeCandidates.length === 1) targetId = mergeCandidates[0].id;
    }
    if (!selected || !targetId) {
      toast.push({ text: '请选择或输入匹配到的目标演员', kind: 'error' });
      return;
    }
    if (selected === targetId) {
      toast.push({ text: '不能合并到自己', kind: 'error' });
      return;
    }
    const from = actors.find(a => a.id === selected);
    const to = actors.find(a => a.id === targetId);
    if (!from || !to) return;
    if (!confirm(
      `将「${from.name}」合并到「${to.name}」？\n`
      + `· ${from.name} 的影片会归到 ${to.name}\n`
      + `· 「${from.name}」会成为 ${to.name} 的别名\n`
      + `· 「${from.name}」条目将被删除\n\n此操作不可撤销（可用整库备份恢复）。`,
    )) return;
    setMerging(true);
    try {
      await mfl().actors.merge(selected, targetId);
      toast.push({ text: `已合并：${from.name} → ${to.name}`, kind: 'success' });
      setSelected(targetId);
      setMergeTargetId(null);
      setMergeQuery('');
      reloadActors();
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally {
      setMerging(false);
    }
  };

  // 仅在「刚打开编辑」时初始化表单 + 聚焦名称框。
  // 不要依赖 selectedActor 对象：reloadActors 会换新引用，导致输入中途被 setMetaForm 冲掉、焦点丢失。
  const openMetaEditor = () => {
    if (!selectedActor) return;
    setMetaForm({
      name: selectedActor.name,
      category: selectedActor.category ?? '',
      notes: selectedActor.notes ?? '',
      aliases: (selectedActor.aliases ?? []).join(', '),
      javbus_url: selectedActor.javbus_url ?? '',
      birthday: selectedActor.birthday ?? '',
      age: selectedActor.age ?? '',
      height: selectedActor.height ?? '',
      cup: selectedActor.cup ?? '',
      bust: selectedActor.bust ?? '',
      waist: selectedActor.waist ?? '',
      hips: selectedActor.hips ?? '',
      measurements: selectedActor.measurements ?? '',
      hobby: selectedActor.hobby ?? '',
    });
    setMetaEditing(true);
  };

  useEffect(() => {
    if (!metaEditing) return;
    // 等表单挂到 DOM 后再 focus（下一帧更稳，避免和按钮点击抢焦点）
    const t = window.setTimeout(() => {
      const el = metaNameInputRef.current;
      if (!el) return;
      el.focus();
      // 光标放到末尾，方便继续改名
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* ignore */ }
    }, 0);
    return () => window.clearTimeout(t);
  }, [metaEditing]);

  const saveMeta = async () => {
    if (!selected || !selectedActor) return;
    // actors.update：name/category/notes 四个字段。
    // 只下发实际变化的字段，避免覆盖未被渲染的列；空串归一成 null（category/notes）或 undefined（name 还空就什么都不动）。
    const patch: Partial<Pick<ActorRow,
      'name' | 'category' | 'notes' | 'javbus_url' | 'birthday' | 'age' | 'height'
      | 'cup' | 'bust' | 'waist' | 'hips' | 'measurements' | 'hobby'>> = {};
    if (metaForm.name !== (selectedActor.name ?? '')) patch.name = metaForm.name.trim() || undefined;
    if (metaForm.category !== (selectedActor.category ?? '')) patch.category = metaForm.category.trim() || null;
    if (metaForm.notes !== (selectedActor.notes ?? '')) patch.notes = metaForm.notes || null;
    if (metaForm.javbus_url.trim() !== (selectedActor.javbus_url ?? '')) patch.javbus_url = metaForm.javbus_url.trim() || null;
    for (const key of ACTOR_PROFILE_KEYS) {
      const next = metaForm[key].trim();
      if (next !== (selectedActor[key] ?? '')) patch[key] = next || null;
    }
    if (Object.keys(patch).length > 0) {
      try { await mfl().actors.update(selected, patch as any); }
      catch (e: unknown) { toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }); return; }
    }
    // 别名：分别 diff 新旧集合，添加新增、删除去除。逐个走 IPC（数量通常个位数）。
    const oldAliases = new Set(selectedActor.aliases ?? []);
    const newAliases = metaForm.aliases.split(',').map(s => s.trim()).filter(Boolean);
    const newSet = new Set(newAliases);
    try {
      for (const a of newAliases) if (!oldAliases.has(a)) await mfl().actors.addAlias(selected, a);
      for (const a of Array.from(oldAliases)) if (!newSet.has(a)) await mfl().actors.removeAlias(a);
    } catch (e: unknown) {
      toast.push({ text: `别名更新出错：${String((e as Error)?.message ?? e)}`, kind: 'error' });
      reloadActors();
      return;
    }
    // 没有任何字段变化时也提示一下，避免用户以为点坏了。
    const nothingChanged = Object.keys(patch).length === 0 && newAliases.length === (selectedActor.aliases ?? []).length && newAliases.every(a => oldAliases.has(a));
    if (nothingChanged) toast.push({ text: '没有变化', kind: 'info' });
    else toast.push({ text: '已保存', kind: 'success' });
    if ('javbus_url' in patch) setActorJavbusData(null);
    setMetaEditing(false);
    reloadActors();
  };

  const scrapeActorJavbus = async () => {
    if (!selected || !selectedActor?.javbus_url || actorScraping) return;
    setActorScraping(true);
    try {
      const actorId = selected;
      const result = await mfl().actors.scrapeJavbus(actorId) as ActorJavbusData & { scrapedAt: number };
      if (selectedRef.current === actorId) {
        setActorJavbusData(result);
        setActorTab('works');
      }
      toast.push({ text: `演员资料已更新，读取 ${result.works.length} 部最新作品`, kind: 'success' });
      reloadActors();
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    } finally {
      if (selectedRef.current === selected) setActorScraping(false);
    }
  };

  const openActorWork = async (url: string) => {
    try {
      await mfl().actors.openExternal(url);
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  return (
    // 用 ResizeObserver 量到的 paneHeight（像素）撑满主内容区，保证左侧列表是独立滚动容器。
    // 若用 height:100%，父级 #mfl-main-scroll 为 overflow:auto 时百分比高度常失效，
    // 列表被撑满、用户实际滚的是外层，scrollTop 恒为 0，返回后无法恢复。
    <div style={{
      display: 'flex',
      gap: 16,
      height: paneHeight > 0 ? paneHeight : '100%',
      maxHeight: paneHeight > 0 ? paneHeight : '100%',
      minHeight: 0,
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 0,
        height: '100%',
      }}>
        {/* 搜索框独立一层，避免列表滚动层/右侧绝对定位菜单在叠层上挡住点击 */}
        <div
          style={{ flexShrink: 0, position: 'relative', zIndex: 2 }}
          onMouseDown={e => {
            // 与元数据表单相同：阻止冒泡，降低 Electron 下焦点被外层抢走的概率
            e.stopPropagation();
          }}
        >
          <input
            type="text"
            value={actorSearch}
            onChange={e => setActorSearch(e.target.value)}
            placeholder="搜索 名称/别名"
            // 点击后若未聚焦则主动 focus（Electron 偶发点不中）
            onMouseDown={e => {
              e.stopPropagation();
              const el = e.currentTarget;
              // 不 preventDefault，保留浏览器默认选区/光标行为
              if (document.activeElement !== el) {
                el.focus({ preventScroll: true });
              }
            }}
            onClick={e => {
              const el = e.currentTarget;
              if (document.activeElement !== el) {
                el.focus({ preventScroll: true });
              }
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 4,
              background: '#2a2a2a',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 4,
            }}
          />
        </div>
        {/* 真正的滚动容器：必须有受限高度 + overflowY:auto，scrollTop 才有意义。 */}
        <div
          ref={listScrollRef}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4, position: 'relative', zIndex: 0 }}
        >
          {visibleActors.length === 0 && <div style={{ color: '#666', fontSize: 12, padding: 4 }}>无匹配演员</div>}
          {visibleActors.map(a => (
            <div
              key={a.id}
              data-actor-id={a.id}
              onClick={() => setSelected(a.id)}
              style={{
                padding: 6, cursor: 'pointer', borderRadius: 4,
                background: selected === a.id ? '#2a2a2a' : 'transparent',
              }}
            >
              {a.name} <span style={{ color: '#888', fontSize: 12 }}>({a.film_count})</span>
              {a.aliases && a.aliases.length > 0 && <span style={{ color: '#666', fontSize: 11 }}> +{a.aliases.length}别名</span>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {selectedActor ? (
          <>
            <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>选中演员：</span>
              <strong>{selectedActor.name}</strong>
              {selectedActor.category && <span style={{ color: '#888', fontSize: 11 }}>[{selectedActor.category}]</span>}
              <button
                type="button"
                onClick={() => (metaEditing ? setMetaEditing(false) : openMetaEditor())}
                style={{ marginLeft: 8 }}
              >
                {metaEditing ? '取消编辑' : '编辑元数据'}
              </button>
              <button
                type="button"
                disabled={actorScraping || !selectedActor.javbus_url}
                onClick={() => void scrapeActorJavbus()}
                title={selectedActor.javbus_url ? '从已配置的演员主页更新资料与最新作品' : '请先编辑元数据并配置 JavBus 主页'}
              >
                {actorScraping ? '刮削中…' : '刮削演员主页'}
              </button>
            </div>

            {/* —— 演员元数据编辑区 ——
                name / category / notes / aliases 四栏同表单。aliases 用逗号分隔，
                保存时 diff 新旧集合后逐个增删（数量通常个位数，IPC 往返可忽略）。 */}
            {metaEditing ? (
              <div
                style={{ marginBottom: 12, padding: 8, background: '#222', borderRadius: 4, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
                onMouseDown={e => {
                  // 防止点击输入框时被外层/按钮逻辑抢走焦点（Electron 偶发）
                  e.stopPropagation();
                }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#999' }}>名称</span>
                  <input
                    ref={metaNameInputRef}
                    value={metaForm.name}
                    onChange={e => setMetaForm(f => ({ ...f, name: e.target.value }))}
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#999' }}>分类 (可选)</span>
                  <input
                    value={metaForm.category}
                    onChange={e => setMetaForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="例如：日本 / 欧美 / 自制"
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#999' }}>JavBus 主页地址</span>
                  <input
                    type="url"
                    value={metaForm.javbus_url}
                    onChange={e => setMetaForm(f => ({ ...f, javbus_url: e.target.value }))}
                    placeholder="例如：已配置站点/star/演员ID"
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {ACTOR_PROFILE_KEYS.map(key => (
                    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ color: '#999' }}>{ACTOR_PROFILE_LABELS[key]}</span>
                      <input
                        value={metaForm[key]}
                        onChange={e => setMetaForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ minWidth: 0, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                      />
                    </label>
                  ))}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#999' }}>备注</span>
                  <textarea
                    value={metaForm.notes}
                    onChange={e => setMetaForm(f => ({ ...f, notes: e.target.value }))}
                    rows={4}
                    placeholder="本名 / 出道年代 / 偏好题材 / 其它自由备注"
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#999' }}>别名 (逗号分隔，多个)</span>
                  <textarea
                    value={metaForm.aliases}
                    onChange={e => setMetaForm(f => ({ ...f, aliases: e.target.value }))}
                    rows={2}
                    placeholder="例如：三上悠亜, みかみ ゆあ, Mikami Yua"
                    style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 4 }}
                  />
                  <span style={{ color: '#666', fontSize: 11 }}>同一演员的中文名 / 假名 / 英文可写在这里；扫描与刮削命中别名会归到本演员。</span>
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <button type="button" onClick={saveMeta}>保存</button>
                  <button type="button" onClick={() => setMetaEditing(false)}>取消</button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 12, padding: 8, background: '#222', borderRadius: 4, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '4px 16px' }}>
                  <ReadField k="分类" v={selectedActor.category} />
                  <ReadField k="生日" v={selectedActor.birthday} />
                  <ReadField k="年龄" v={selectedActor.age} />
                  <ReadField k="身高" v={selectedActor.height} />
                  <ReadField k="罩杯" v={selectedActor.cup} />
                  <ReadField k="胸围" v={selectedActor.bust} />
                  <ReadField k="腰围" v={selectedActor.waist} />
                  <ReadField k="臀围" v={selectedActor.hips} />
                  <ReadField k="三围" v={selectedActor.measurements} />
                  <ReadField k="爱好" v={selectedActor.hobby} />
                  <ReadField k="JavBus 主页" v={selectedActor.javbus_url} />
                  <ReadField
                    k="主页刮削时间"
                    v={selectedActor.javbus_scraped_at ? new Date(selectedActor.javbus_scraped_at).toLocaleString() : null}
                  />
                  <ReadField k="别名" v={(selectedActor.aliases ?? []).join(', ') || null} />
                  {scrapedProfileName && scrapedProfileName !== selectedActor.name && (
                    <ReadField k="网页姓名" v={scrapedProfileName} />
                  )}
                </div>
                {extraProfileFields.length > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #333' }}>
                    <div style={{ color: '#999', marginBottom: 4 }}>网页其他资料</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '4px 16px' }}>
                      {extraProfileFields.map(field => <ReadField key={`${field.label}:${field.value}`} k={field.label} v={field.value} />)}
                    </div>
                  </div>
                )}
                {selectedActor.notes && <div style={{ marginTop: 6 }}><ReadField k="备注" v={selectedActor.notes} multiline /></div>}
              </div>
            )}

            {/* 合并同人属于低频且不可逆操作，默认折叠以减少页面高度。 */}
            <details style={{ marginBottom: 12, padding: 8, background: '#1a2228', borderRadius: 4, fontSize: 12, border: '1px solid #333' }}>
              <summary style={{ color: '#aaa', cursor: 'pointer', userSelect: 'none' }}>合并到其他演员</summary>
              <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
                  <input
                    value={mergeQuery}
                    onChange={e => {
                      setMergeQuery(e.target.value);
                      setMergeSuggestOpen(true);
                      // 输入变化时清空已点选的 id，避免文案与 id 不一致
                      setMergeTargetId(null);
                    }}
                    onFocus={() => setMergeSuggestOpen(true)}
                    // 延迟关闭建议层，给 mousedown 选中留时间；不要在 blur 里改表单值
                    onBlur={() => { window.setTimeout(() => setMergeSuggestOpen(false), 180); }}
                    placeholder="输入名称或别名自动匹配，或点下方建议"
                    style={{ width: '100%', boxSizing: 'border-box', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
                  />
                  {mergeSuggestOpen && mergeCandidates.length > 0 && (
                    <div
                      // 建议层本身不抢焦点，避免 input blur 抖动
                      onMouseDown={e => e.preventDefault()}
                      style={{
                      position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20,
                      maxHeight: 200, overflowY: 'auto', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, marginTop: 2,
                    }}>
                      {mergeCandidates.map(a => (
                        <div
                          key={a.id}
                          onMouseDown={e => { e.preventDefault(); pickMergeTarget(a); }}
                          style={{
                            padding: '6px 8px', cursor: 'pointer',
                            background: mergeTargetId === a.id ? '#3a5a8a' : 'transparent',
                          }}
                        >
                          <div>{a.name} <span style={{ color: '#888' }}>· {a.film_count} 部</span></div>
                          {a.aliases && a.aliases.length > 0 && (
                            <div style={{ color: '#777', fontSize: 11 }}>别名：{a.aliases.slice(0, 5).join('、')}{a.aliases.length > 5 ? '…' : ''}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {mergeTargetId != null && (
                    <div style={{ color: '#8f8', fontSize: 11, marginTop: 4 }}>
                      已选目标：{actors.find(a => a.id === mergeTargetId)?.name ?? mergeTargetId}
                    </div>
                  )}
                </div>
                <select
                  value={mergeTargetId ?? ''}
                  onChange={e => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setMergeTargetId(id);
                    const a = actors.find(x => x.id === id);
                    setMergeQuery(a?.name ?? '');
                  }}
                  style={{ minWidth: 160, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
                >
                  <option value="">下拉选择…</option>
                  {actors
                    .filter(a => a.id !== selected)
                    .map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.aliases?.length ? ` (+${a.aliases.length})` : ''} · {a.film_count} 部
                      </option>
                    ))}
                </select>
                <button disabled={merging || (!mergeTargetId && !mergeQuery.trim())} onClick={() => void doMerge()}>
                  {merging ? '合并中…' : '合并到目标'}
                </button>
              </div>
              <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
                例：选中「みかみ ゆあ」→ 输入或选择「三上悠亜」→ 合并。假名会变成别名，之后刮削到假名也会归到中文名下。
              </div>
              </div>
            </details>

            <div
              role="tablist"
              aria-label="演员影片"
              style={{ display: 'flex', gap: 2, borderBottom: '1px solid #3a3a3a', marginBottom: 8 }}
            >
              <ActorTabButton active={actorTab === 'films'} onClick={() => setActorTab('films')}>
                本地影片 ({films.length})
              </ActorTabButton>
              <ActorTabButton active={actorTab === 'works'} onClick={() => setActorTab('works')}>
                最新作品 ({actorJavbusData?.works?.length ?? 0})
              </ActorTabButton>
            </div>

            {actorTab === 'films' ? (
              <div role="tabpanel" aria-label="本地影片">
                <FilmTable
                  rows={films}
                  hideActorsColumn
                  onRowDoubleClick={(film) => {
                    // 进详情前强制再存一次左侧列表 scrollTop。
                    const el = listScrollRef.current;
                    if (el) {
                      saveListScroll(el.scrollTop);
                    }
                    // 带上当前演员下的影片 id 序列，详情页可用 ←/→ 切换。
                    nav(`/film/${film.id}`, {
                      state: {
                        from: 'actors',
                        listIds: films.map(f => f.id),
                      },
                    });
                  }}
                />
              </div>
            ) : (
              <div role="tabpanel" aria-label="最新作品">
                <ActorWorksPanel data={actorJavbusData} onOpen={openActorWork} />
              </div>
            )}
          </>
        ) : <div>选择左侧演员</div>}
      </div>
    </div>
  );
}

function ReadField({ k, v, multiline }: { k: string; v: string | null; multiline?: boolean }) {
  if (!v) return <div><span style={{ color: '#999', marginRight: 8 }}>{k}:</span><span style={{ color: '#666' }}>—</span></div>;
  return <div>
    <span style={{ color: '#999', marginRight: 8 }}>{k}:</span>
    <span style={{ whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>{v}</span>
  </div>;
}

function ActorTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        border: 0,
        borderBottom: active ? '2px solid #6aa8ff' : '2px solid transparent',
        borderRadius: 0,
        padding: '6px 10px',
        background: active ? '#252d38' : 'transparent',
        color: active ? '#fff' : '#999',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ActorWorksPanel({
  data,
  onOpen,
}: {
  data: ActorJavbusData | null;
  onOpen: (url: string) => void;
}) {
  const works = Array.isArray(data?.works) ? data.works : [];
  if (!data) {
    return <div style={{ color: '#666', fontSize: 12, padding: 8 }}>尚未刮削演员主页，请先点击“刮削演员主页”。</div>;
  }
  if (works.length === 0) {
    return <div style={{ color: '#666', fontSize: 12, padding: 8 }}>未发现最新作品。</div>;
  }
  return (
    <section>
      <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>点击作品后使用系统浏览器打开 JavBus 页面</div>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {works.map((work, index) => (
          <button
            key={`${work.url}:${index}`}
            type="button"
            role="listitem"
            onClick={() => onOpen(work.url)}
            title={work.url}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 105px minmax(0, 1fr) 24px',
              gap: 8,
              alignItems: 'center',
              width: '100%',
              minHeight: 34,
              padding: '6px 8px',
              textAlign: 'left',
              border: '1px solid #333',
              borderRadius: 3,
              background: '#202020',
              color: '#ddd',
              cursor: 'pointer',
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#9fc4ff' }}>{work.code || '—'}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#999' }}>{work.releaseDate || '—'}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{work.title}</span>
            <span aria-hidden="true" style={{ color: '#8ab4f8', textAlign: 'center' }}>↗</span>
          </button>
        ))}
      </div>
    </section>
  );
}
