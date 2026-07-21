import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
const Ctx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(s => [...s, { ...t, id }]);
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '8px 12px', borderRadius: 4,
            background: t.kind === 'error' ? '#b3261e' : (t.kind === 'success' ? '#2e7d32' : '#333'),
            color: '#fff', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
