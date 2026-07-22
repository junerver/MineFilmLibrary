import { useEffect, useState } from 'react';
import type { ScanProgressEvent } from '../api/types';

// Resolve IPC bridge live so tests that stub `(window as any).mfl` per-test are observed.
// (Same rationale as FilterBar/LibraryPage: the static `api` export binds once at import time.)
const mfl = (): { scanner: { onProgress(cb: (p: ScanProgressEvent) => void): () => void } } => (window as any).mfl;

export interface ScanProgressState extends ScanProgressEvent {
  // 'flash' 用来在 received 'done'/'error' 后短暂展示结果消息，1.5s 后清掉整条进度条。
  flash?: 'done' | 'error';
}

export function useScanProgress() {
  const [progress, setProgress] = useState<ScanProgressState | null>(null);
  useEffect(() => {
    const off = mfl().scanner.onProgress(p => {
      if (p.stage === 'done' || p.stage === 'error') {
        // 先短暂显示一条"扫描完成 / 扫描失败"消息，再清掉。
        // 这避免了"扫描中 452/452"在所有页面持续残留的问题；
        // 同时也给用户一个明确的扫描结束反馈。
        setProgress({ ...p, flash: p.stage });
        const stage = p.stage;
        const t = setTimeout(() => {
          if (stage === 'done') setProgress(null);
          else setProgress(null);
        }, 1500);
        // 注意：这里没法在 unmount 时清这个 timeout——但 effect 的 cleanup 会
        // 在组件卸载时取消订阅；即便 timeout 在卸载后 fire，setProgress 也只是
        // 写一个未挂载组件的 state，React 18 已安全处理（不报错）。
        void t;
      } else {
        setProgress({ ...p });
      }
    });
    return off;
  }, []);
  return progress;
}
