import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, normalizeCodeForUrl, parseJavbusHtml, safeFileBase, formatScrapeNotes } from '../electron/scraper/javbus';

describe('javbus helpers', () => {
  it('normalizeBaseUrl strips trailing slash', () => {
    expect(normalizeBaseUrl('https://www.javbus.com/')).toBe('https://www.javbus.com');
    expect(normalizeBaseUrl('  https://x.com  ')).toBe('https://x.com');
  });

  it('normalizeCodeForUrl uppercases and strips locale suffix', () => {
    expect(normalizeCodeForUrl('cjod-295-c')).toBe('CJOD-295');
    expect(normalizeCodeForUrl('SSIS-100-U')).toBe('SSIS-100');
    expect(normalizeCodeForUrl('abc_123')).toBe('ABC_123');
  });

  it('safeFileBase removes illegal chars', () => {
    expect(safeFileBase('A:B/C?D')).toBe('A_B_C_D');
  });

  it('parseJavbusHtml extracts title cover samples genres info (CLUB-641 shape)', () => {
    // 贴近实站结构：info 区 header + 发行日/长度/制作商/发行商；类别用 class=genre
    const html = `
      <html><body>
      <h3>CLUB-641 ワリキリ 美味しそうな太もも</h3>
      <a class="bigImage" href="/pics/cover/898a_b.jpg">
      <a class="sample-box" href="https://pics.dmm.co.jp/digital/video/club00641/club00641jp-1.jpg">
      <a class="sample-box" href="/pics/sample/2.jpg">
      <div class="movie"><div class="info">
        <p><span class="header">識別碼:</span> <span style="color:#CC0000;">CLUB-641</span></p>
        <p><span class="header">發行日期:</span> 2021-05-28</p>
        <p><span class="header">長度:</span> 150分鐘</p>
        <p><span class="header">製作商:</span> <a href="https://www.javbus.com/studio/pp">変態紳士倶楽部</a></p>
        <p><span class="header">發行商:</span> <a href="https://www.javbus.com/label/1l6">変態紳士倶楽部</a></p>
        <p class="header">類別:</p>
        <p>
          <span class="genre"><label><a href="https://www.javbus.com/genre/1f">苗條</a></label></span>
          <span class="genre"><label><a href="https://www.javbus.com/genre/3i">制服</a></label></span>
        </p>
        <p class="star-show"><span class="header">演員</span>:</p>
        <span class="glyphicon glyphicon-info-sign mb20"></span> 暫無出演者資訊
      </div></div>
      </body></html>
    `;
    const r = parseJavbusHtml(html, 'https://www.javbus.com', 'CLUB-641');
    expect(r.title).toContain('CLUB-641');
    expect(r.coverUrl).toBe('https://www.javbus.com/pics/cover/898a_b.jpg');
    expect(r.sampleUrls).toEqual([
      'https://pics.dmm.co.jp/digital/video/club00641/club00641jp-1.jpg',
      'https://www.javbus.com/pics/sample/2.jpg',
    ]);
    expect(r.genres).toEqual(expect.arrayContaining(['苗條', '制服']));
    expect(r.actresses).toEqual([]);
    expect(r.releaseDate).toBe('2021-05-28');
    expect(r.runtime).toBe('150分鐘');
    expect(r.studio).toBe('変態紳士倶楽部');
    expect(r.label).toBe('変態紳士倶楽部');
    expect(r.pageUrl).toBe('https://www.javbus.com/CLUB-641');
    const notes = formatScrapeNotes(r);
    expect(notes).toContain('发行日期: 2021-05-28');
    expect(notes).toContain('制作商: 変態紳士倶楽部');
  });
});
