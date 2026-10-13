import { describe, it, expect } from 'vitest';
import {
  normalizeActorPageUrl,
  normalizeBaseUrl,
  normalizeCodeForUrl,
  parseJavbusActorHtml,
  parseJavbusHtml,
  safeFileBase,
  formatScrapeNotes,
} from '../electron/scraper/javbus';

describe('javbus helpers', () => {
  it('normalizeBaseUrl strips trailing slash', () => {
    expect(normalizeBaseUrl('https://www.javbus.com/')).toBe('https://www.javbus.com');
    expect(normalizeBaseUrl('  https://x.com  ')).toBe('https://x.com');
  });

  it('normalizes and validates an actor homepage URL', () => {
    expect(normalizeActorPageUrl(' https://www.javbus.com/star/okq/ ')).toBe('https://www.javbus.com/star/okq');
    expect(() => normalizeActorPageUrl('www.javbus.com/star/okq')).toThrow(/完整的 http\(s\) URL/);
    expect(() => normalizeActorPageUrl('ftp://example.com/star/okq')).toThrow(/http 或 https/);
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
    // 制作商/发行商已写入独立列（films.studio/label），不再拼进 notes。
    expect(notes).not.toContain('制作商');
  });

  it('parseJavbusActorHtml extracts profile fields and latest works without images', () => {
    const html = `
      <html><body>
        <div class="star-info">
          <p><span class="header">姓名:</span> 小川あさ美</p>
          <p><span class="header">生日:</span> 1985-04-11</p>
          <p><span class="header">年龄:</span> 41</p>
          <p><span class="header">身高:</span> 158cm</p>
          <p><span class="header">罩杯:</span> D</p>
          <p><span class="header">胸围:</span> 88cm</p>
          <p><span class="header">腰围:</span> 60cm</p>
          <p><span class="header">臀围:</span> 86cm</p>
          <p><span class="header">爱好:</span> 音乐</p>
        </div>
        <a class="movie-box" href="/SSIS-001">
          <img title="SSIS-001 First title" src="/cover.jpg">
          <date>SSIS-001</date><date>2026-07-01</date>
        </a>
        <a href="/ABP-002" class="movie-box">
          <img alt="ABP-002 Second title" src="/cover-2.jpg">
          <date>ABP-002</date><date>2026-06-01</date>
        </a>
      </body></html>
    `;
    const r = parseJavbusActorHtml(html, 'https://www.javbus.com/star/okq');
    expect(r.pageUrl).toBe('https://www.javbus.com/star/okq');
    expect(r.profile.name).toBe('小川あさ美');
    expect(r.profile.birthday).toBe('1985-04-11');
    expect(r.profile.height).toBe('158cm');
    expect(r.profile.hobby).toBe('音乐');
    expect(r.profile.fields).toEqual(expect.arrayContaining([{ label: '罩杯', value: 'D' }]));
    expect(r.works).toEqual([
      { code: 'SSIS-001', title: 'SSIS-001 First title', releaseDate: '2026-07-01', url: 'https://www.javbus.com/SSIS-001' },
      { code: 'ABP-002', title: 'ABP-002 Second title', releaseDate: '2026-06-01', url: 'https://www.javbus.com/ABP-002' },
    ]);
  });

  it('parses the real actor-page photo-info shape and preserves extra profile fields', () => {
    const html = `
      <div class="avatar-box">
        <div class="photo-info">
          <span class="pb10">三上悠亜</span>
          <p>生日: 1993-08-16</p>
          <p>年齡: 32</p>
          <p>身高: 159cm</p>
          <p>罩杯: F</p>
          <p>胸圍: 84cm</p>
          <p>腰圍: 58cm</p>
          <p>臀圍: 88cm</p>
          <p>愛好: アイドルDVD鑑賞</p>
          <p>出生地: 东京</p>
        </div>
      </div>
      <a class="movie-box" href="https://www.javbus.com/OFJE-710">
        <img src="/pics/thumb/x.jpg" title="最新作品">
        <date>OFJE-710</date> / <date>2026-06-26</date>
      </a>
    `;
    const r = parseJavbusActorHtml(html, 'https://www.javbus.com/star/okq');
    expect(r.profile.name).toBe('三上悠亜');
    expect(r.profile.age).toBe('32');
    expect(r.profile.hobby).toBe('アイドルDVD鑑賞');
    expect(r.profile.fields).toEqual(expect.arrayContaining([{ label: '出生地', value: '东京' }]));
    expect(r.works[0]).toEqual({
      code: 'OFJE-710',
      title: '最新作品',
      releaseDate: '2026-06-26',
      url: 'https://www.javbus.com/OFJE-710',
    });
  });

  it('rejects age verification pages instead of treating them as actor data', () => {
    expect(() => parseJavbusActorHtml('<title>Age Verification JavBus</title><div id="ageVerify">x</div>', 'https://www.javbus.com/star/okq'))
      .toThrow(/年龄验证/);
  });
});
