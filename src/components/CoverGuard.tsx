import { useCallback, useEffect, useState } from 'react';
import { usePrivacySettings } from '../hooks/usePrivacySettings';

const mfl = (): any => (window as any).mfl;

/**
 * 封面安全门组件。
 * - 隐私总开关 && privacy_cover：占位 +「单次显示」；否则默认加载封面。
 * - 显示中可在目录图片间 ←/→ 切换。
 * - IPC 仍要求 getCover(..., { display: true })。
 */
export default function CoverGuard({ filmId }: { filmId: number }) {
  const privacy = usePrivacySettings();

  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);
  const [images, setImages] = useState<{ rel_path: string; name: string }[]>([]);
  const [index, setIndex] = useState(0);
  // 是否已按当前 privacy 策略完成首轮加载决策
  const [bootstrapped, setBootstrapped] = useState(false);

  const loadAt = useCallback(async (list: { rel_path: string; name: string }[], i: number) => {
    setLoading(true);
    try {
      const rel = list[i]?.rel_path;
      const r = await mfl().cover.getCover(filmId, {
        display: true,
        ...(rel ? { rel_path: rel } : {}),
      });
      if (r) {
        setCurrentSrc(`data:${r.mime};base64,${r.base64}`);
        setTried(false);
      } else {
        setCurrentSrc(null);
        setTried(true);
      }
    } finally {
      setLoading(false);
    }
  }, [filmId]);

  // 换片时重置
  useEffect(() => {
    setCurrentSrc(null);
    setImages([]);
    setIndex(0);
    setTried(false);
    setBootstrapped(false);
  }, [filmId]);

  // 设置加载完成后：拉图片列表；非隐私封面则默认显示
  useEffect(() => {
    if (!privacy.loaded) return;
    let cancelled = false;
    (async () => {
      let list: { rel_path: string; name: string }[] = [];
      try {
        const r = await mfl().cover.listImages(filmId);
        list = r?.images ?? [];
      } catch {
        list = [];
      }
      if (cancelled) return;
      setImages(list);
      setIndex(0);

      const hide = privacy.enabled && privacy.cover;
      if (!hide) {
        await loadAt(list, 0);
      }
      if (!cancelled) setBootstrapped(true);
    })();
    return () => { cancelled = true; };
  }, [filmId, privacy.loaded, privacy.enabled, privacy.cover, loadAt]);

  const showOnce = async () => {
    if (images.length === 0) {
      try {
        const r = await mfl().cover.listImages(filmId);
        const list = r?.images ?? [];
        setImages(list);
        setIndex(0);
        await loadAt(list, 0);
        return;
      } catch {
        // fallthrough
      }
    }
    await loadAt(images, index);
  };

  const go = async (delta: number) => {
    if (images.length <= 1) return;
    const next = (index + delta + images.length) % images.length;
    setIndex(next);
    await loadAt(images, next);
  };

  if (!privacy.loaded || !bootstrapped) {
    return (
      <div style={{ width: 200, height: 260, background: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#888', fontSize: 12 }}>…</span>
      </div>
    );
  }

  if (currentSrc) {
    return (
      <div style={{ maxWidth: 320 }}>
        <img src={currentSrc} alt="cover" style={{ maxWidth: 300, maxHeight: 400, display: 'block' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {images.length > 1 && (
            <>
              <button type="button" onClick={() => void go(-1)} disabled={loading} title="上一张">←</button>
              <span style={{ fontSize: 12, color: '#aaa' }}>{index + 1}/{images.length}</span>
              <button type="button" onClick={() => void go(1)} disabled={loading} title="下一张">→</button>
            </>
          )}
          <button type="button" onClick={() => setCurrentSrc(null)}>隐藏</button>
        </div>
        {images[index] && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 4, wordBreak: 'break-all' }}>{images[index].name}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: 200, height: 260, background: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <span>[封面已隐藏]</span>
      {tried && <span style={{ fontSize: 11, color: '#999', marginTop: 4 }}>未找到封面</span>}
      <button type="button" onClick={() => void showOnce()} disabled={loading} style={{ marginTop: 8 }}>
        {loading ? '加载中…' : '单次显示'}
      </button>
    </div>
  );
}
