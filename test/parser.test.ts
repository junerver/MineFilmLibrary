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
