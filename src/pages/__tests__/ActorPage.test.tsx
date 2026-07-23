import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActorJavbusData, ActorRow, FilmRow } from '../../api/types';
import ActorPage from '../ActorPage';

const actor: ActorRow = {
  id: 7,
  name: '本地演员',
  raw_dir_name: '本地演员',
  category: '日本',
  notes: null,
  birthday: '1993-08-16',
  age: '32',
  height: '159cm',
  cup: 'F',
  bust: '84cm',
  waist: '58cm',
  hips: '88cm',
  measurements: null,
  hobby: '电影',
  javbus_url: 'https://www.javbus.com/star/okq',
  javbus_data_json: null,
  javbus_scraped_at: 1,
  film_count: 1,
  aliases: [],
  created_at: 1,
  updated_at: 1,
};

const localFilm: FilmRow = {
  id: 11,
  code: 'LOCAL-001',
  title: '本地影片标题',
  raw_dir_name: 'LOCAL-001',
  abs_path: 'C:\\Movie\\LOCAL-001',
  parent_dir_name: '',
  parent_type: null,
  locale: null,
  cover_path: null,
  cover_blob_id: null,
  notes: null,
  scan_status: 'parsed',
  fs_mtime_ms: 1,
  is_deleted: 0,
  code_count: 1,
  created_at: 1,
  updated_at: 1,
};

const javbusData: ActorJavbusData = {
  pageUrl: actor.javbus_url!,
  profile: {
    name: '网页演员名',
    birthday: actor.birthday,
    age: actor.age,
    height: actor.height,
    cup: actor.cup,
    bust: actor.bust,
    waist: actor.waist,
    hips: actor.hips,
    measurements: null,
    hobby: actor.hobby,
    fields: [
      { label: '生日', value: actor.birthday! },
      { label: '出生地', value: '东京' },
    ],
  },
  works: [{
    code: 'WEB-002',
    title: '网页最新作品',
    releaseDate: '2026-07-01',
    url: 'https://www.javbus.com/WEB-002',
  }],
};

const openExternal = vi.fn(async () => true);

beforeEach(() => {
  openExternal.mockClear();
  (window as any).mfl = {
    actors: {
      list: vi.fn(async () => [actor]),
      films: vi.fn(async () => [localFilm]),
      getJavbusData: vi.fn(async () => javbusData),
      scrapeJavbus: vi.fn(async () => ({ ...javbusData, scrapedAt: 2 })),
      openExternal,
      update: vi.fn(async () => true),
      addAlias: vi.fn(async () => true),
      removeAlias: vi.fn(async () => true),
      merge: vi.fn(async () => true),
    },
    settings: { get: vi.fn(async () => ({ privacy_mode: '0' })) },
  };
  sessionStorage.clear();
});

describe('ActorPage', () => {
  it('separates local films and latest works, and opens a work externally', async () => {
    render(<MemoryRouter><ActorPage /></MemoryRouter>);

    fireEvent.click(await screen.findByText('本地演员'));
    expect(await screen.findByRole('tab', { name: '本地影片 (1)' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('LOCAL-001')).toBeInTheDocument();
    expect(screen.queryByText('网页最新作品')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '最新作品 (1)' }));
    expect(await screen.findByText('网页最新作品')).toBeInTheDocument();
    expect(screen.queryByText('LOCAL-001')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('网页最新作品'));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://www.javbus.com/WEB-002'));
  });

  it('shows extended scraped metadata and keeps merge controls collapsed', async () => {
    render(<MemoryRouter><ActorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('本地演员'));

    expect(await screen.findByText('网页其他资料')).toBeInTheDocument();
    expect(screen.getByText('东京')).toBeInTheDocument();
    const summary = screen.getByText('合并到其他演员');
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });
});
