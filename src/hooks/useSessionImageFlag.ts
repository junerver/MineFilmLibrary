import { useCallback, useState } from 'react';

/**
 * Single-shot image display flag — for future use.
 * enableOnce() flips true; consume() returns the current value and resets it
 * to false on the same cycle. CoverGuard will use consume() once per click.
 */
export function useSessionImageFlag() {
  const [enabled, setEnabled] = useState(false);
  const enableOnce = useCallback(() => setEnabled(true), []);
  const consume = useCallback(() => {
    const v = enabled;
    if (v) setEnabled(false);
    return v;
  }, [enabled]);
  return { current: enabled, enableOnce, consume };
}
