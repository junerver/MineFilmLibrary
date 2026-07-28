import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsPage from '../SettingsPage';
import { Toaster } from '../../components/Toaster';

function stubMfl() {
  (window as any).mfl = {
    settings: {
      get: vi.fn(async () => ({
        default_parent_type: 'actor',
        scan_max_depth: '3',
        privacy_mode: '1',
        privacy_cover: '1',
        privacy_text: '0',
        javbus_base_url: '',
        scrape_enable_title: '1',
        scrape_enable_meta: '1',
        scrape_enable_cover: '1',
        scrape_enable_samples: '0',
        scrape_film_concurrency: '6',
        scrape_sample_concurrency: '6',
        scrape_image_timeout_ms: '10000',
      })),
      set: vi.fn(async () => true),
    },
    scanner: {
      listRoots: vi.fn(async () => []),
      listRuns: vi.fn(async () => []),
      addRoot: vi.fn(),
      removeRoot: vi.fn(),
      runFull: vi.fn(),
      runIncremental: vi.fn(),
      clearHistory: vi.fn(),
    },
    library: {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      restore: vi.fn(),
      hardDelete: vi.fn(),
    },
    scrape: {
      openLogDir: vi.fn(),
      getLogPath: vi.fn(),
    },
    export: {
      sqlite: vi.fn(),
      importSqlite: vi.fn(),
    },
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Toaster>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Toaster>
    </MemoryRouter>,
  );
}

describe('SettingsPage tabs', () => {
  beforeEach(() => {
    stubMfl();
  });

  it('defaults to scan tab', async () => {
    renderAt('/settings');
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '解析策略' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '扫描根目录' })).toBeInTheDocument();
    });
  });

  it('opens trash tab from query', async () => {
    renderAt('/settings?tab=trash');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '回收站' })).toBeInTheDocument();
    });
  });

  it('switches tabs via tablist', async () => {
    renderAt('/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: '解析策略' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: '隐私' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '隐私模式' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: '刮削' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'JavBus 刮削' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '备份' })).toBeInTheDocument();
    });
  });
});
