import { useEffect, useState } from 'react';
import api from '../api';

export function useScanProgress() {
  const [progress, setProgress] = useState<{ stage: string; current: number; total: number; currentPath: string } | null>(null);
  useEffect(() => {
    const off = api.scanner.onProgress(p => setProgress(p));
    return off;
  }, []);
  return progress;
}
