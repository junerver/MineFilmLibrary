export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function flagOn(v: string | undefined, def: boolean): boolean {
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase();
  return !(s === '0' || s === 'false' || s === 'off');
}

export const mfl = (): any => (window as any).mfl;
