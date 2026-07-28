import type { ReactNode } from 'react';

export function SettingsTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        border: 0,
        borderBottom: active ? '2px solid #6aa8ff' : '2px solid transparent',
        borderRadius: 0,
        padding: '6px 10px',
        background: active ? '#252d38' : 'transparent',
        color: active ? '#fff' : '#999',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
