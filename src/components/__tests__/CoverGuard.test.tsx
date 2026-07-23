import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoverGuard from '../CoverGuard';

beforeEach(() => {
  (window as any).mfl = {
    settings: {
      // 总开关开 + 封面子项开 → 默认隐藏
      get: vi.fn(async () => ({ privacy_mode: '1', privacy_cover: '1', privacy_text: '0' })),
    },
    cover: {
      listImages: vi.fn(async () => ({ images: [{ rel_path: 'c.jpg', name: 'c.jpg' }], cover_path: 'c.jpg' })),
      getCover: vi.fn(async (_id: number, opts?: { display?: boolean }) =>
        opts?.display ? { kind: 'file' as const, mime: 'image/jpeg', base64: 'AAAA' } : null),
    },
  };
});

describe('CoverGuard', () => {
  it('hides image by default', async () => {
    render(<CoverGuard filmId={1} />);
    expect(await screen.findByText('[封面已隐藏]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows image after clicking single-shot button', async () => {
    render(<CoverGuard filmId={1} />);
    fireEvent.click(await screen.findByText('单次显示'));
    expect(await screen.findByRole('img')).toBeInTheDocument();
    // The image must remain visible until user explicitly hides via the 隐藏 button.
    // The "single-shot" semantics apply to the FETCH (only one fetch per click of 单次显示);
    // the displayed image is held in local state, not auto-cleared, so the user has
    // time to view it without re-fetching.
  });
});
