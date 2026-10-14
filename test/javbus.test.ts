import { describe, it, expect } from 'vitest';
import {
  normalizeActorPageUrl,
  normalizeBaseUrl,
  normalizeCodeForUrl,
  parseJavbusActorHtml,
  parseJavbusHtml,
  parseJavbusWorksPageHtml,
  parseMagnetsFromHtml,
  parseTorrentsFromHtml,
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

  it('flags works pagination by the 下一頁 anchor', () => {
    const withNext = `
      <a class="movie-box" href="/SSIS-001"><date>SSIS-001</date><date>2026-07-01</date></a>
      <div id="next"><a href="/star/okq/2">下一頁</a></div>
    `;
    expect(parseJavbusActorHtml(withNext, 'https://www.javbus.com/star/okq').worksHasNext).toBe(true);
    expect(parseJavbusWorksPageHtml(withNext, 'https://www.javbus.com/star/okq/2').hasNext).toBe(true);

    const lastPage = `
      <a class="movie-box" href="/SSIS-009"><date>SSIS-009</date><date>2020-01-01</date></a>
      <div id="prev"><a href="/star/okq/1">上一頁</a></div>
    `;
    expect(parseJavbusWorksPageHtml(lastPage, 'https://www.javbus.com/star/okq/3')).toEqual({
      works: [{ code: 'SSIS-009', title: 'SSIS-009', releaseDate: '2020-01-01', url: 'https://www.javbus.com/SSIS-009' }],
      hasNext: false,
    });
  });

  it('parseMagnetsFromHtml extracts rows from the real #magnet-table DOM', () => {
    // 贴近实站 AJAX 注入的磁力表：三列（名稱/大小/日期），磁力链接在行内
    // 每个单元格重复出现，名称格可能带「高清」角标，td 上有 onclick 属性。
    const html = `
      <div class="movie" style="padding:12px; margin-top:15px">
        <table id="magnet-table" class="table table-condensed table-striped table-hover" style="margin-bottom:0;">
          <tbody><tr style="font-weight:bold;">
            <td>磁力名稱 <span class="glyphicon glyphicon-magnet"></span></td>
            <td style="text-align:center;white-space:nowrap">檔案大小</td>
            <td style="text-align:center;white-space:nowrap">分享日期</td>
          </tr></tbody>
          <tr onmouseover="this.style.backgroundColor='#F4F9FD';" height="35px">
            <td width="70%" onclick="window.open('magnet:?xt=urn:btih:b945a0ee0906e68&amp;dn=WAAA-696-UC','_self')">
              <a style="color:#333" rel="nofollow" title="滑鼠右鍵點擊並選擇【複製連結網址】" href="magnet:?xt=urn:btih:b945a0ee0906e68&amp;dn=WAAA-696-UC">
              WAAA-696-UC </a><a class="btn btn-mini-new btn-primary disabled" title="包含高清HD的磁力連結">高清</a>
            </td>
            <td style="text-align:center;white-space:nowrap">
              <a href="magnet:?xt=urn:btih:b945a0ee0906e68&amp;dn=WAAA-696-UC">3.26GB</a>
            </td>
            <td style="text-align:center;white-space:nowrap">
              <a href="magnet:?xt=urn:btih:b945a0ee0906e68&amp;dn=WAAA-696-UC">2026-10-09</a>
            </td>
          </tr>
          <tr onmouseover="this.style.backgroundColor='#F4F9FD';" height="35px">
            <td width="70%">
              <a href="magnet:?xt=urn:btih:13909334754d2785302d47404c3acc47e82c67ec&amp;dn=WAAA-696-C+JULIA">
              WAAA-696-C 「先生って雑魚マ〇コだな」 JULIA </a><a class="btn btn-mini-new btn-primary disabled" title="包含高清HD的磁力連結">高清</a>
            </td>
            <td><a href="magnet:?xt=urn:btih:13909334754d2785302d47404c3acc47e82c67ec&amp;dn=WAAA-696-C+JULIA">7.82GB</a></td>
            <td><a href="magnet:?xt=urn:btih:13909334754d2785302d47404c3acc47e82c67ec&amp;dn=WAAA-696-C+JULIA">2026-09-28</a></td>
          </tr>
        </table>
        <div id="movie-loading" style="display: none;">
          <font class="ajax-text">讀取中...</font>
        </div>
      </div>
    `;
    const magnets = parseMagnetsFromHtml(html);
    expect(magnets).toHaveLength(2);
    expect(magnets[0]).toEqual({
      link: 'magnet:?xt=urn:btih:b945a0ee0906e68&dn=WAAA-696-UC',
      name: 'WAAA-696-UC',
      size: '3.26GB',
      date: '2026-10-09',
    });
    expect(magnets[1].link).toBe('magnet:?xt=urn:btih:13909334754d2785302d47404c3acc47e82c67ec&dn=WAAA-696-C+JULIA');
    expect(magnets[1].name).toBe('WAAA-696-C 「先生って雑魚マ〇コだな」 JULIA');
    expect(magnets[1].size).toBe('7.82GB');
    expect(magnets[1].date).toBe('2026-09-28');
  });

  it('parseMagnetsFromHtml extracts btih magnets with name/size/date and dedupes', () => {
    const html = `
      <div class="row">
        <a href="magnet:?xt=urn:btih:AAAA1111&dn=WEB-002+4K">WEB-002 4K</a>
        <span>2026-07-02</span> <span>4.36GB</span>
      </div>
      <div class="row">
        <a href="magnet:?xt=urn:btih:bbbb2222">第二条</a>
        <span>1.2GB 2026-06-01</span>
      </div>
      <a href="magnet:?xt=urn:btih:AAAA1111&dn=WEB-002+4K">重复链接</a>
      <a href="magnet:?xt=urn:sha1:notbtih">非 btih 忽略</a>
    `;
    const magnets = parseMagnetsFromHtml(html);
    expect(magnets).toHaveLength(2);
    expect(magnets[0]).toEqual({
      link: 'magnet:?xt=urn:btih:AAAA1111&dn=WEB-002+4K',
      name: 'WEB-002 4K',
      size: '4.36GB',
      date: '2026-07-02',
    });
    expect(magnets[1].name).toBe('第二条');
    expect(magnets[1].size).toBe('1.2GB');
    expect(magnets[1].date).toBe('2026-06-01');
  });

  it('parseTorrentsFromHtml resolves .torrent links and ignores magnets', () => {
    const html = `
      <a href="/download/WEB-002.torrent">WEB-002 种子</a>
      <a href="magnet:?xt=urn:btih:AAAA1111">磁力不算种子</a>
      <a href="/page">普通链接</a>
    `;
    const torrents = parseTorrentsFromHtml(html, 'https://www.javbus.com');
    expect(torrents).toEqual([{ link: 'https://www.javbus.com/download/WEB-002.torrent', name: 'WEB-002 种子' }]);
  });
});
