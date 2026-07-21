import { useEffect, useState } from 'react';
import type { FilmFilter } from '../api/types';
import type { MflApi } from '../api';

// Resolve the IPC bridge live so tests that assign `(window as any).mfl = fakeApi`
// per-test are observed (the static `api` export is bound once at import time).
const mfl = (): MflApi => (window as any).mfl;

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <input
        placeholder="搜索 编号/标题/演员"
        value={value.q ?? ''}
        onChange={e => onChange({ ...value, q: e.target.value })}
        style={{ padding: 6, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
