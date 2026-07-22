import { useState } from 'react';

const mfl = (): any => (window as any).mfl;

export default function CoverGuard({ filmId }: { filmId: number }) {
  // Single-shot image display:
  // - Default state: cover hidden (placeholder).
  // - User clicks 单次显示 → ONE call to api.cover.getCover(id, {display:true}).
  //   IPC returns null unless display:true; this is the safety gate.
  // - Fetched result is held in local state and rendered until user clicks 隐藏.
  //   This gives the user time to view without re-fetching; the "single shot"
  //   semantic is enforced per click at the fetch boundary.
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);

  const showOnce = async () => {
    setLoading(true);
    try {
      const r = await mfl().cover.getCover(filmId, { display: true });
      if (r) {
        setCurrentSrc(`data:${r.mime};base64,${r.base64}`);
      } else {
        setTried(true);
      }
    } finally { setLoading(false); }
  };

  if (currentSrc) {
    return (
      <div>
        <img src={currentSrc} alt="cover" style={{ maxWidth: 300, maxHeight: 400, display: 'block' }} />
        <button onClick={() => setCurrentSrc(null)}>隐藏</button>
      </div>
    );
  }

  return (
    <div style={{ width: 200, height: 260, background: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <span>[封面已隐藏]</span>
      {tried && <span style={{ fontSize: 11, color: '#999', marginTop: 4 }}>未找到封面</span>}
      <button onClick={showOnce} disabled={loading} style={{ marginTop: 8 }}>
        {loading ? '加载中…' : '单次显示'}
      </button>
    </div>
  );
}
