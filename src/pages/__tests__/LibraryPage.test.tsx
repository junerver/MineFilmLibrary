import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FilmFilter, ListResult, FilmRow } from '../../api/types';
import LibraryPage from '../LibraryPage';

const fakeRow = {
  id: 1, code: 'AAA-1', title: 'T1', is_deleted: 0, scan_status: 'parsed' as const,
  locale: null, parent_type: 'actor' as const, parent_dir_name: '0-J',
  raw_dir_name: 'AAA-1 T1', abs_path: '/x/AAA-1 T1', cover_path: null, cover_blob_id: null,
  notes: null, fs_mtime_ms: 0, code_count: 1, created_at: 0, updated_at: 0,
};

const fakeApi = {
  library: {
    list: vi.fn(async (_f: FilmFilter): Promise<ListResult<FilmRow>> => ({ items: [fakeRow], total: 1, page: 1, page_size: 1000 })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => 1),
    update: vi.fn(async () => true),
    softDelete: vi.fn(async () => true),
    hardDelete: vi.fn(async () => true),
    restore: vi.fn(async () => true),
  },
  actors: { list: vi.fn(async () => []) },
  genres: { list: vi.fn(async () => []), allTags: vi.fn(async () => []) },
};

beforeEach(() => {
  (window as any).mfl = fakeApi;
  fakeApi.library.list.mockClear();
  sessionStorage.clear();
});

describe('LibraryPage', () => {
  it('renders rows from api', async () => {
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    expect(await screen.findByText('AAA-1')).toBeInTheDocument();
    expect(await screen.findByText('T1')).toBeInTheDocument();
  });

  it('typing in keyword triggers list call', async () => {
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    const input = await screen.findByPlaceholderText('搜索 编号/标题/演员');
    fireEvent.change(input, { target: { value: 'CJOD' } });
    await waitFor(() => expect(fakeApi.library.list).toHaveBeenCalled());
    const calls = fakeApi.library.list.mock.calls as [FilmFilter][];
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.q).toBe('CJOD');
  });

  it('restores list scroll after the table becomes scrollable', async () => {
    let resolveList!: (result: ListResult<FilmRow>) => void;
    fakeApi.library.list.mockImplementationOnce(() => new Promise(resolve => {
      resolveList = resolve;
    }));
    sessionStorage.setItem('mfl:libraryListScroll', '320');

    render(
      <MemoryRouter>
        <div id="mfl-main-scroll"><LibraryPage /></div>
      </MemoryRouter>,
    );

    const scrollEl = document.getElementById('mfl-main-scroll')!;
    const clientHeight = 100;
    let scrollHeight = clientHeight;
    let scrollTop = 0;
    Object.defineProperties(scrollEl, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
    });

    await act(async () => {
      resolveList({ items: [fakeRow], total: 1, page: 1, page_size: 1000 });
    });
    expect(await screen.findByText('AAA-1')).toBeInTheDocument();
    expect(scrollTop).toBe(0);

    scrollHeight = 1000;
    await waitFor(() => expect(scrollTop).toBe(320));
    expect(sessionStorage.getItem('mfl:libraryListScroll')).toBeNull();
  });
});
