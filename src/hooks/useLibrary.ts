import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import type { FilmFilter, FilmRow, ListResult } from '../api/types';

export function useLibrary(initial: FilmFilter) {
  const [filter, setFilter] = useState<FilmFilter>(initial);
  const [result, setResult] = useState<ListResult<FilmRow>>({ items: [], total: 0, page: 1, page_size: 50 });
  const [loading, setLoading] = useState(false);
  const run = useCallback(async () => {
    setLoading(true);
    try { setResult(await api.library.list(filter)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void run(); }, [run]);
  return { filter, setFilter, result, loading, reload: run };
}
