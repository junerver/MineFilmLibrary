import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FilmFilter } from '../api/types';
import type { MflApi } from '../api';

// Resolve the IPC bridge live so tests that assign `(window as any).mfl = fakeApi`
// per-test are observed (the static `api` export is bound once at import time).
const mfl = (): MflApi => (window as any).mfl;

// Chips 区在折叠状态下最多显示两行——超过才出现"展开/收起"按钮。
// 用 lineHeight=28px 作为 chip 高度近似（chip 内边距 2px 上下 + 字号 12 ≈ 24，
// 加上父容器 gap 6 容忍一点）。
const CHIP_ROW_HEIGHT = 28;
const COLLAPSED_MAX_ROWS = 2;
const COLLAPSED_MAX_HEIGHT = CHIP_ROW_HEIGHT * COLLAPSED_MAX_ROWS;

export default function FilterBar({ value, onChange }: { value: FilmFilter; onChange: (f: FilmFilter) => void }) {
  const [actors, setActors] = useState<{ id: number; name: string }[]>([]);
  const [genres, setGenres] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    const a = mfl();
    void a.actors.list().then(r => setActors(r));
    void a.genres.list().then(r => setGenres(r));
    void a.genres.allTags().then(r => setTags(r.map(t => t.tag)));
  }, []);
  const toggle = (key: 'actors' | 'genres' | 'tags' | 'locales' | 'statuses', v: any) => {
    const arr = (value[key] as any[] | undefined) ?? [];
    const next = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
    onChange({ ...value, [key]: next });
  };

  // Chips 区折叠/展开。用 useLayoutEffect 测量 scrollHeight 与折叠高度对比，
  // 只在 chip 数量实际占两行以上时才显示按钮——避免 chip 不足以撑满两行时
  // 冒出一个无意义的"展开"按钮。
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const [overflowed, setOverflowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const measure = () => {
    const el = chipsRef.current;
    if (!el) return;
    // 暂时设成 none 测真实高度，再恢复——但 React 渲染时父级 maxHeight 已生效，
    // scrollHeight 仍然反映完全展开的内容高度（CSS maxHeight 不影响 scrollHeight）。
    setOverflowed(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 1);
  };
  useLayoutEffect(measure, [actors, genres, tags]);
  useEffect(() => {
    // 窗口缩放会改变每行可容纳的 chip 数量，因此监听 resize 重新判断。
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <input
        placeholder="搜索 编号/标题/演员"
        value={value.q ?? ''}
        onChange={e => onChange({ ...value, q: e.target.value })}
        style={{ padding: 6, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
      />
      <div
        ref={chipsRef}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          // 折叠状态下限高二行；展开时 maxHeight:none。overflow:hidden 防止 chip
          // 被第三行撑出。chip 高度近似 28px，所以 56px ≈ 两行。
          maxHeight: expanded ? 'none' : COLLAPSED_MAX_HEIGHT,
          overflow: expanded ? 'visible' : 'hidden',
        }}
      >
        {actors.map(a => (
          <Chip key={a.id} active={value.actors?.includes(a.id)} onClick={() => toggle('actors', a.id)}>{a.name}</Chip>
        ))}
        {genres.map(g => (
          <Chip key={g.id} active={value.genres?.includes(g.id)} onClick={() => toggle('genres', g.id)}>{g.name}</Chip>
        ))}
        {tags.map(t => (
          <Chip key={t} active={value.tags?.includes(t)} onClick={() => toggle('tags', t)}>{t}</Chip>
        ))}
        <Chip active={value.locales?.includes('C')} onClick={() => toggle('locales', 'C')}>中字</Chip>
        <Chip active={value.locales?.includes('U')} onClick={() => toggle('locales', 'U')}>破解</Chip>
      </div>
      {overflowed && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ alignSelf: 'flex-start', padding: '2px 10px', fontSize: 12, background: '#2a2a2a', color: '#aaa', border: '1px solid #444', borderRadius: 4, cursor: 'pointer' }}
        >
          {expanded ? '收起标签 ▲' : '展开更多标签 ▼'}
        </button>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
      background: active ? '#3a5a8a' : '#2a2a2a', color: '#e0e0e0', border: '1px solid #444',
    }}>{children}</button>
  );
}
