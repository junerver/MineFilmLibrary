import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

const mfl = (): any => (window as any).mfl;

function flagOn(v: string | undefined, def: boolean): boolean {
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase();
  return !(s === '0' || s === 'false' || s === 'off');
}

export type PrivacySettings = {
  /** 总开关 */
  enabled: boolean;
  /** 隐私模式下隐藏封面默认显示 */
  cover: boolean;
  /** 隐私模式下模糊非编号文字 */
  text: boolean;
  loaded: boolean;
};

const DEFAULTS: PrivacySettings = {
  enabled: true,
  cover: true,
  text: false,
  loaded: false,
};

/**
 * 读取隐私模式设置。
 * - privacy_mode：总开关（默认开）
 * - privacy_cover：总开关开时是否隐藏封面（默认开）
 * - privacy_text：总开关开时是否模糊文字（默认关）
 */
export function usePrivacySettings(): PrivacySettings {
  const [state, setState] = useState<PrivacySettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    mfl().settings?.get?.().then((s: Record<string, string>) => {
      if (cancelled) return;
      setState({
        enabled: flagOn(s.privacy_mode, true),
        cover: flagOn(s.privacy_cover, true),
        text: flagOn(s.privacy_text, false),
        loaded: true,
      });
    }).catch(() => {
      if (!cancelled) setState({ ...DEFAULTS, loaded: true });
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}

/** 封面是否应按隐私默认隐藏：总开关 && 封面子项 */
export function coverPrivacyActive(p: PrivacySettings): boolean {
  return p.loaded && p.enabled && p.cover;
}

/** 文字是否应模糊：总开关 && 文字子项 */
export function textPrivacyActive(p: PrivacySettings): boolean {
  return p.loaded && p.enabled && p.text;
}

/**
 * 隐私文字：默认模糊，按住（pointer down）暂时清晰，松开恢复模糊。
 * 不启用时原样渲染 children。
 */
export function PrivacyText({
  blur,
  children,
  style,
  as: Tag = 'span',
}: {
  blur: boolean;
  children: ReactNode;
  style?: CSSProperties;
  as?: 'span' | 'div';
}) {
  const [hold, setHold] = useState(false);

  const onDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!blur) return;
    e.preventDefault();
    setHold(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }, [blur]);

  const onUp = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!blur) return;
    setHold(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }, [blur]);

  if (!blur) {
    return <Tag style={style}>{children}</Tag>;
  }

  return (
    <Tag
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
      title="按住查看，松开恢复模糊"
      style={{
        ...style,
        filter: hold ? 'none' : 'blur(6px)',
        transition: 'filter 0.08s linear',
        cursor: 'pointer',
        userSelect: hold ? 'text' : 'none',
        // 避免布局跳动
        display: style?.display ?? 'inline',
      }}
    >
      {children}
    </Tag>
  );
}
