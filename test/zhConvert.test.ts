// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toTraditional } from '../electron/util/zhConvert';

describe('toTraditional', () => {
  it('converts simplified Chinese to traditional', () => {
    // 「亚」简体 → 「亜」/「亞」繁体（opencc cn→t 标准映射）
    const out = toTraditional('三上悠亚');
    expect(out).not.toBe('三上悠亚');
    // 繁体化后应包含繁体字形（亜 或 亞）
    expect(out).toMatch(/[亜亞]/);
  });

  it('converts「制作商」to traditional「製作商」', () => {
    expect(toTraditional('制作商')).toBe('製作商');
    expect(toTraditional('发行商')).toBe('發行商');
  });

  it('keeps already-traditional text unchanged', () => {
    // 已是繁体，转一次仍为繁体（幂等方向：简→繁对繁体是恒等）
    expect(toTraditional('製作商')).toBe('製作商');
    expect(toTraditional('發行商')).toBe('發行商');
  });

  it('passes through non-Chinese / ASCII unchanged', () => {
    expect(toTraditional('ABC-123')).toBe('ABC-123');
    expect(toTraditional('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(toTraditional('')).toBe('');
  });

  it('handles mixed ASCII + Chinese', () => {
    // 编号常常是 ASCII + 可能含中文；简体部分转繁体
    const out = toTraditional('ABC-001 制作商');
    expect(out).toContain('製作商');
    expect(out).toContain('ABC-001');
  });

  it('substring match works across 简繁 boundary (standard simplified→traditional)', () => {
    // 模拟前端过滤场景：库里是标准繁体，输入简体，转繁体后 includes 命中。
    // 注意：OpenCC cn→t 覆盖标准简繁差异（制→製、发→發、亚→亞）；
    // 日文异体字（如「亜」）不在标准映射内，需走别名机制，此处不覆盖。
    const libraryValue = '三上悠亞'; // 标准繁体
    const userInput = '三上悠亚';   // 简体
    const norm = toTraditional(userInput.toLowerCase());
    expect(toTraditional(libraryValue.toLowerCase()).includes(norm)).toBe(true);
  });

  it('substring match works for "制作商" vs "製作商" tag name', () => {
    const libraryTag = '製作商: OPPAI'; // 繁体
    const userInput = '制作商';          // 简体
    const norm = toTraditional(userInput);
    expect(toTraditional(libraryTag).includes(norm)).toBe(true);
  });
});
