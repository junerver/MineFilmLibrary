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
  is_favorite: 0,
  avatar_url: null,
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
  is_favorite: 0,
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
const setFavorite = vi.fn(async (_id: number, _favorite: boolean) => true);
const workResources = vi.fn(async () => ({
  pageUrl: 'https://www.javbus.com/WEB-002',
  magnets: [{ link: 'magnet:?xt=urn:btih:abcdef123', name: 'WEB-002 高清', size: '4.36GB', date: '2026-07-02' }],
  torrents: [],
}));
const scrapeMoreWorks = vi.fn(async () => ({
  works: javbusData.works,
  added: 0,
  worksPages: 1,
  worksHasNext: false,
}));
const hasCodes = vi.fn(async (codes: string[]) => codes.filter(c => c === 'WEB-002'));
let listActors: ActorRow[] = [actor];

beforeEach(() => {
  openExternal.mockClear();
  setFavorite.mockClear();
  workResources.mockClear();
  scrapeMoreWorks.mockClear();
  hasCodes.mockClear();
  listActors = [{ ...actor, is_favorite: 0 }];
  (window as any).mfl = {
    library: { hasCodes },
    actors: {
      list: vi.fn(async () => listActors),
      films: vi.fn(async () => [localFilm]),
      getJavbusData: vi.fn(async () => javbusData),
      scrapeJavbus: vi.fn(async () => ({ ...javbusData, scrapedAt: 2 })),
      scrapeMoreWorks,
      openExternal,
      setFavorite: vi.fn(async (id: number, favorite: boolean) => {
        listActors = listActors.map(a => a.id === id ? { ...a, is_favorite: favorite ? 1 : 0 } : a);
        return setFavorite(id, favorite);
      }),
      update: vi.fn(async () => true),
      addAlias: vi.fn(async () => true),
      removeAlias: vi.fn(async () => true),
      merge: vi.fn(async () => true),
      fillFromBuiltin: vi.fn(async () => false),
      lookupBuiltin: vi.fn(async () => null),
      searchBuiltin: vi.fn(async () => []),
    },
    scrape: { workResources },
    settings: { get: vi.fn(async () => ({ privacy_mode: '0' })) },
  };
  sessionStorage.clear();
});

describe('ActorPage', () => {
  it('separates local films and latest works, and expands resources on click', async () => {
    render(<MemoryRouter><ActorPage /></MemoryRouter>);

    fireEvent.click(await screen.findByText('本地演员'));
    expect(await screen.findByRole('tab', { name: '本地影片 (1)' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('LOCAL-001')).toBeInTheDocument();
    expect(screen.queryByText('网页最新作品')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '最新作品 (1)' }));
    expect(await screen.findByText('网页最新作品')).toBeInTheDocument();
    expect(screen.queryByText('LOCAL-001')).not.toBeInTheDocument();

    // 点击作品不再跳浏览器，而是嗅探磁力/种子资源并展开
    fireEvent.click(screen.getByText('网页最新作品'));
    await waitFor(() => expect(workResources).toHaveBeenCalledWith('https://www.javbus.com/WEB-002'));
    expect(await screen.findByText('WEB-002 高清')).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();

    // 本地库已存在的编号显示「本地」徽章
    expect(hasCodes).toHaveBeenCalledWith(['WEB-002']);
    expect(await screen.findByText('本地')).toBeInTheDocument();
  });

  it('loads more works and merges into the list', async () => {
    scrapeMoreWorks.mockResolvedValueOnce({
      works: [
        ...javbusData.works,
        { code: 'WEB-003', title: '早期作品', releaseDate: '2025-01-01', url: 'https://www.javbus.com/WEB-003' },
      ],
      added: 1,
      worksPages: 2,
      worksHasNext: false,
    });
    render(<MemoryRouter><ActorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('本地演员'));
    fireEvent.click(await screen.findByRole('tab', { name: '最新作品 (1)' }));
    expect(await screen.findByText('网页最新作品')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('早期作品')).toBeInTheDocument();
    expect(scrapeMoreWorks).toHaveBeenCalledWith(7);
    expect(await screen.findByText('已加载全部 2 部作品（2 页）')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '最新作品 (2)' })).toBeInTheDocument();
  });

  it('shows extended scraped metadata and keeps merge controls collapsed', async () => {
    render(<MemoryRouter><ActorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('本地演员'));

    expect(await screen.findByText('网页其他资料')).toBeInTheDocument();
    expect(screen.getByText('东京')).toBeInTheDocument();
    const summary = screen.getByText('合并到其他演员');
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });

  it('toggles favorite star and shows list marker', async () => {
    render(<MemoryRouter><ActorPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('本地演员'));
    const starBtn = await screen.findByRole('button', { name: '收藏' });
    expect(starBtn).toHaveTextContent('☆ 收藏');
    fireEvent.click(starBtn);
    await waitFor(() => expect(setFavorite).toHaveBeenCalledWith(7, true));
    expect(await screen.findByRole('button', { name: '取消收藏' })).toHaveTextContent('★ 已收藏');
    // 左侧列表收藏标记
    const listItem = document.querySelector('[data-actor-id="7"]');
    expect(listItem?.textContent).toContain('★');
  });
});
