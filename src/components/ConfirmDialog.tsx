import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ConfirmOptions = {
  /** 弹窗标题；省略则只显示正文 */
  title?: string;
  /** 正文；支持 \n 多行（pre-wrap 展示） */
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作：确认按钮红色，且初始焦点落在取消按钮上防回车误触 */
  danger?: boolean;
};

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

// 未包 Provider 时兜底为「取消」：宁可让操作不执行，也不能让破坏性操作在无确认下放行。
const Ctx = createContext<{ confirm: ConfirmFn }>({ confirm: async () => false });
export const useConfirm = () => useContext(Ctx).confirm;

/**
 * 应用内确认弹窗，替代原生 window.confirm()。
 * 原生 confirm 在 Electron/Windows 上关闭后破坏渲染进程焦点（点输入框无法聚焦，
 * 切出窗口再切回才恢复），且样式不可控；本组件用应用内 DOM 实现同等语义。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  // Promise 化：open 时存 resolve，按钮/键盘裁决时兑现。
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      // 防御：上一个弹窗还未裁决又开了新的，按取消兑现旧的，避免悬挂的 Promise。
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setState(opts);
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setState(null);
  }, []);

  useEffect(() => {
    if (!state) return;
    // 初始焦点：危险操作落在「取消」防回车误触；普通操作落在「确认」便于回车直进。
    const target = state.danger ? cancelBtnRef.current : confirmBtnRef.current;
    target?.focus();
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state, settle]);

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          onClick={() => settle(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={state.title ?? '确认操作'}
            // 点卡片内部不冒泡到遮罩，避免误取消
            onClick={e => e.stopPropagation()}
            style={{
              minWidth: 320, maxWidth: 520, maxHeight: '70vh', overflowY: 'auto',
              background: '#222', border: '1px solid #444', borderRadius: 6,
              padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            {state.title && <div style={{ fontWeight: 600, marginBottom: 8, color: '#fff' }}>{state.title}</div>}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: '#ddd' }}>{state.message}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                ref={cancelBtnRef}
                onClick={() => settle(false)}
                style={{ padding: '4px 14px', background: '#2a2a2a', color: '#ccc', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
              >
                {state.cancelText ?? '取消'}
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                onClick={() => settle(true)}
                style={{
                  padding: '4px 14px', borderRadius: 4, cursor: 'pointer',
                  background: state.danger ? '#8a2a24' : '#2f5a8f',
                  color: '#fff', border: '1px solid ' + (state.danger ? '#b3492f' : '#4a7ab0'),
                }}
              >
                {state.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
