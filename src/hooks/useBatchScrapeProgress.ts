import { useEffect, useState } from 'react';
import type { BatchScrapeProgress } from '../api/types';

const mfl = (): any => (window as any).mfl;

/**
 * 订阅主进程批量刮削进度。
 * 状态在主进程，切页面/卸载 LibraryPage 不会中断任务；
 * Layout 全局挂载本 hook 即可在任意页看到进度条。
 */
export function useBatchScrapeProgress() {
  const [progress, setProgress] = useState<BatchScrapeProgress | null>(null);

  useEffect(() => {
    const api = mfl()?.scrape;
    if (!api) return;

    // 进页时拉一次当前状态（可能已在后台跑）
    void api.getBatchStatus?.().then((s: BatchScrapeProgress) => {
      if (s?.running || s?.finished) setProgress(s);
    }).catch(() => {});

    const off = api.onBatchProgress?.((p: BatchScrapeProgress) => {
      setProgress(p);
      // 完成后保留几秒展示，再清掉（仅 UI）
      if (p.finished) {
        setTimeout(() => {
          setProgress(cur => (cur && cur.finished && !cur.running ? null : cur));
        }, 4000);
      }
    }) ?? (() => {});

    return off;
  }, []);

  return progress;
}
