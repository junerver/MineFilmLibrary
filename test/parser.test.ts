import { describe, it, expect } from 'vitest';
import { parseFilmDirName, parseParentDirName } from '../electron/scanner/parser';

describe('parseParentDirName', () => {
  it('actor prefix 0-', () => {
    expect(parseParentDirName('0-Julia', { defaultType: 'actor' })).toEqual({ parent_type: 'actor', name: 'Julia' });
  });
  it('genre prefix 1-', () => {
    expect(parseParentDirName('1-剧情', { defaultType: 'actor' })).toEqual({ parent_type: 'genre', name: '剧情' });
  });
  it('no prefix uses default strategy actor-first', () => {
    expect(parseParentDirName('Maria', { defaultType: 'actor' })).toEqual({ parent_type: 'actor', name: 'Maria' });
  });
  it('no prefix genre-first', () => {
    expect(parseParentDirName('剧情', { defaultType: 'genre' })).toEqual({ parent_type: 'genre', name: '剧情' });
  });
  // 平铺根扫描会传入空字符串作为 parentDirName——早先 .trim() 会吞掉空格但
  // 这里需要保证 null 而不是空串被返回，否则 runScan 会以空串 name 去 upsert actor。
  it('empty / whitespace returns name=null (flat-root support)', () => {
    expect(parseParentDirName('', { defaultType: 'actor' })).toEqual({ parent_type: 'actor', name: null });
    expect(parseParentDirName('   ', { defaultType: 'genre' })).toEqual({ parent_type: 'genre', name: null });
  });
});

describe('parseFilmDirName', () => {
  it('full example', () => {
    const r = parseFilmDirName('CJOD-295-C [FHD] 闲暇的人妻 因为丈夫调职来到乡下 作为邻居被无内诱惑 数次中出的我 JULIA');
    expect(r).toEqual({
      code: 'CJOD-295',
      locale: 'C',
      tags: ['FHD'],
      title: '闲暇的人妻 因为丈夫调职来到乡下 作为邻居被无内诱惑 数次中出的我 JULIA',
      scan_status: 'parsed',
    });
  });
  it('underscore variant + locale U', () => {
    const r = parseFilmDirName('abc_123-U [4K] Title here');
    expect(r.code).toBe('abc_123');
    expect(r.locale).toBe('U');
    expect(r.tags).toEqual(['4K']);
    expect(r.title).toBe('Title here');
    expect(r.scan_status).toBe('parsed');
  });
  it('multiple tags', () => {
    const r = parseFilmDirName('SSIS-100 [FHD] [4K] T');
    expect(r.tags).toEqual(['FHD', '4K']);
    expect(r.title).toBe('T');
  });
  it('keeps the full FC2-PPV vendor code and treats HD as a tag', () => {
    const r = parseFilmDirName('fc2-ppv-739673-HD');
    expect(r).toEqual({
      code: 'fc2-ppv-739673',
      locale: null,
      tags: ['HD'],
      title: null,
      scan_status: 'partial',
    });
  });
  it('supports an FC2-PPV code followed by a title', () => {
    const r = parseFilmDirName('FC2PPV-739673 [FHD] Sample title');
    expect(r.code).toBe('FC2PPV-739673');
    expect(r.tags).toEqual(['FHD']);
    expect(r.title).toBe('Sample title');
    expect(r.scan_status).toBe('parsed');
  });
  it.each([
    [
      'S2MBD-016-C [FHD] 波多野結衣臨場感溢出的濃厚SEX Encore Vol.16',
      'S2MBD-016',
      '波多野結衣臨場感溢出的濃厚SEX Encore Vol.16',
    ],
    [
      '122813-509-carib-C [FHD]半澤直美癡女10倍奉還辦公室OL',
      '122813-509-carib',
      '半澤直美癡女10倍奉還辦公室OL',
    ],
    [
      '261ARA-417-C [FHD] 希望自己變得更變態的癡女美容師',
      '261ARA-417',
      '希望自己變得更變態的癡女美容師',
    ],
  ])('supports mixed and numeric-leading codes: %s', (raw, code, title) => {
    expect(parseFilmDirName(raw)).toEqual({
      code,
      locale: 'C',
      tags: ['FHD'],
      title,
      scan_status: 'parsed',
    });
  });
  it('keeps a mixed x1x prefix and adjacent tags', () => {
    expect(parseFilmDirName('x1x-111860 [FHD][无]')).toEqual({
      code: 'x1x-111860',
      locale: null,
      tags: ['FHD', '无'],
      title: null,
      scan_status: 'partial',
    });
  });
  it('treats a trailing SD token as video quality instead of part of the code', () => {
    expect(parseFilmDirName('RHJ-315-SD')).toEqual({
      code: 'RHJ-315',
      locale: null,
      tags: ['SD'],
      title: null,
      scan_status: 'partial',
    });
  });
  it('skips empty placeholder brackets in tags', () => {
    const r = parseFilmDirName('CJOD-295 [ ] [   ] [FHD] T');
    expect(r.code).toBe('CJOD-295');
    expect(r.tags).toEqual(['FHD']);
    expect(r.title).toBe('T');
    expect(r.scan_status).toBe('parsed');
  });
  it('no code -> partial', () => {
    const r = parseFilmDirName('Some Title Only');
    expect(r.code).toBeNull();
    expect(r.title).toBe('Some Title Only');
    expect(r.scan_status).toBe('partial');
  });
  it('no title but code -> partial', () => {
    const r = parseFilmDirName('SSIS-100-C [FHD]');
    expect(r.title).toBeNull();
    expect(r.scan_status).toBe('partial');
  });
  it('empty string -> unknown', () => {
    const r = parseFilmDirName('   ');
    expect(r.scan_status).toBe('unknown');
    expect(r.code).toBeNull();
    expect(r.title).toBeNull();
  });
});
