import { useEffect, useState } from 'react';
import type { MflApi } from '../api';
import type { FilmFilter, FilmRow } from '../api/types';
import FilmTable from '../components/FilmTable';
import FilterBar from '../components/FilterBar';
import { useToast } from '../components/Toaster';

// Resolve the IPC bridge live (see FilterBar for rationale).
const mfl = (): MflApi => (window as any).mfl;

export default function LibraryPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<FilmFilter>({ page: 1, page_size: 50, sort_by: 'updated_at', sort_dir: 'desc' });
  const [rows, setRows] = useState<FilmRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mfl().library.list(filter).then(r => {
      if (!cancelled) setRows(r.items);
    }).catch(e => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' })).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div>
      <FilterBar value={filter} onChange={setFilter} />
      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => mfl().export.csv({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 CSV', kind: 'success' }))}>导出 CSV</button>
        <button onClick={() => mfl().export.json({ include_deleted: false }).then(r => r.ok && toast.push({ text: '已导出 JSON', kind: 'success' }))}>导出 JSON</button>
      </div>
      <FilmTable rows={rows} />
      {loading && <div style={{ padding: 8 }}>加载中…</div>}
    </div>
  );
}
