import { useEffect, useState } from 'react';
import type { ActorRow, FilmRow } from '../api/types';
import FilmTable from '../components/FilmTable';

const mfl = (): any => (window as any).mfl;

export default function ActorPage() {
  const [actors, setActors] = useState<ActorRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [films, setFilms] = useState<FilmRow[]>([]);

  useEffect(() => {
    mfl().actors.list().then(setActors).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected == null) { setFilms([]); return; }
    mfl().actors.films(selected).then(setFilms).catch(() => {});
  }, [selected]);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ width: 240 }}>
        {actors.map(a => (
          <div key={a.id} onClick={() => setSelected(a.id)} style={{
            padding: 6, cursor: 'pointer', borderRadius: 4,
            background: selected === a.id ? '#2a2a2a' : 'transparent',
          }}>
            {a.name} <span style={{ color: '#888', fontSize: 12 }}>({a.film_count})</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }}>
        {selected != null ? <FilmTable rows={films} /> : <div>选择左侧演员</div>}
      </div>
    </div>
  );
}
