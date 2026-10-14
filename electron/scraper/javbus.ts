/**
 * JavBus 刮削器（主进程用）。
 * 参考 javbus_downloader.py + 实站 CLUB-641 结构。
 *
 * 网络：优先 Electron net.fetch（走 Chromium 网络栈 + 系统代理）。
 * Node 自带 undici fetch 默认不读 Windows 系统代理，在需要代理的环境会 ConnectTimeout。
 * electron 懒加载：vitest 纯 Node 跑解析单测时不能顶层 import electron。
 */

import * as log from '../util/logger';

const TAG = 'javbus';

export interface JavbusScrapeResult {
  code: string;
  title: string;
  coverUrl: string | null;
  sampleUrls: string[];
  actresses: string[];
  genres: string[];
  /** 發行日期 yyyy-mm-dd */
  releaseDate: string | null;
  /** 製作商 */
  studio: string | null;
  /** 發行商 */
  label: string | null;
  /** 片长文案，如 150分鐘 */
  runtime: string | null;
  pageUrl: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

export function normalizeCodeForUrl(code: string): string {
  let s = (code ?? '').trim().toUpperCase();
  s = s.replace(/[-_](C|U|UC|UNCENSORED)$/i, '');
  return s;
}

function absUrl(base: string, href: string): string {
  if (!href) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return base + href;
  return base + '/' + href;
}

function defaultHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    ...extra,
  };
}

function getElectronNet(): typeof import('electron').net | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    return electron.net ?? null;
  } catch {
    return null;
  }
}

/**
 * 通过 Electron Chromium 网络栈请求（会走系统代理 / session 代理）。
 * 比 Node undici fetch 更贴近浏览器行为，避免「Chrome 能开、主进程超时」。
 * 单测环境无 electron 时回退全局 fetch。
 */
async function electronFetch(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const init: RequestInit = {
    method: 'GET',
    headers: headers ?? defaultHeaders(),
    signal: ctrl.signal,
  };
  try {
    const electronNet = getElectronNet();
    if (electronNet?.fetch) {
      const res = await electronNet.fetch(url, {
        ...init,
        bypassCustomProtocolHandlers: true,
      } as any);
      return res as unknown as Response;
    }
    return await fetch(url, init);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const t0 = Date.now();
  log.info(TAG, `GET text ${url} timeout=${timeoutMs}ms`);
  try {
    const res = await electronFetch(url, timeoutMs, defaultHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: url,
      // JavBus 的年龄确认页以 existmag Cookie 记录确认状态；没有该值时返回的
      // 是 driver-verify HTML，而不是影片/演员页面。
      Cookie: 'existmag=all',
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    log.info(TAG, `GET text ok ${Date.now() - t0}ms len=${text.length} status=${res.status}`);
    return text;
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code || cause?.message || msg;
    log.error(TAG, `GET text fail ${Date.now() - t0}ms`, detail);
    throw new Error(
      `请求失败: ${detail}`
      + '。若浏览器能打开但应用不能，请确认系统代理已开启（本机常见 127.0.0.1:7890）；应用已改用 Electron 网络栈走系统代理。'
      + ` URL=${url}`
    );
  }
}

function isVerificationOrChallengePage(html: string): boolean {
  return /age\s+verification|id\s*=\s*["']ageVerify["']|年龄验证|just a moment|checking your browser|cf-browser-verification/i.test(html);
}

/**
 * 当站点把普通请求送到年龄确认/挑战页时，用 Electron 的隐藏 BrowserWindow
 * 复用 Chromium 会话再读一次最终 DOM。该路径只在解析失败时触发，避免每次
 * 刮削都启动窗口；远程页面在隔离、无 Node 权限的渲染器中运行。
 */
// 已知广告域名：隐藏浏览器加载页面时直接阻断，避免广告 iframe（jads.co 等）
// 拖慢 load 事件甚至 stall 到超时。列表保持保守，只列确认的弹窗/横幅网络。
const AD_BLOCK_URL_PATTERNS = [
  '*://*.jads.co/*',
  '*://*.exoclick.com/*',
  '*://*.exosrv.com/*',
  '*://*.exodynamic.com/*',
  '*://*.popads.net/*',
  '*://*.popcash.net/*',
  '*://*.tsyndicate.com/*',
  '*://*.hilltopads.net/*',
];

let adBlockAttached = false;

/** 取 javbus 持久会话并确保广告拦截已挂载（session 复用，只挂一次）。 */
function javbusPartitionSession(electron: any) {
  const ses = electron.session.fromPartition('persist:mfl-javbus');
  if (!adBlockAttached && ses?.webRequest) {
    try {
      ses.webRequest.onBeforeRequest({ urls: AD_BLOCK_URL_PATTERNS }, (_details: unknown, callback: (r: { cancel: boolean }) => void) => {
        callback({ cancel: true });
      });
      adBlockAttached = true;
    } catch {
      // webRequest 不可用时保持原样，仅慢一点
    }
  }
  return ses;
}

async function fetchRenderedText(url: string, timeoutMs = 30000): Promise<string> {
  let electron: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electron = require('electron');
  } catch {
    throw new Error('当前运行环境不支持隐藏浏览器');
  }
  if (!electron?.BrowserWindow || !electron?.session) throw new Error('当前运行环境不支持隐藏浏览器');

  const ses = javbusPartitionSession(electron);
  try {
    await ses.cookies.set({ url, name: 'existmag', value: 'all', path: '/' });
  } catch {
    // Cookie 写入失败时仍尝试加载，某些镜像不要求该确认值。
  }

  const win = new electron.BrowserWindow({
    show: false,
    // 禁止抢主窗口焦点；否则刮削挑战页路径下用户正在输入时会偶发失焦/无法继续填写
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      partition: 'persist:mfl-javbus',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try { win.webContents.setUserAgent(UA); } catch { /* use Chromium default if unavailable */ }
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`隐藏浏览器加载超时（${timeoutMs}ms）`)), timeoutMs);
    });
    await Promise.race([
      win.loadURL(url, { httpReferrer: url }),
      timeout,
    ]);
    // 等待年龄确认脚本/页面重定向完成，再读取最终 DOM。
    await new Promise(resolve => setTimeout(resolve, 250));
    const html = await win.webContents.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""', true);
    if (!html || typeof html !== 'string') throw new Error('隐藏浏览器未返回页面内容');
    log.info(TAG, `rendered page ok ${Date.now() - started}ms len=${html.length}`);
    return html;
  } finally {
    if (timer) clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

async function fetchJavbusPageHtml(url: string): Promise<string> {
  let directHtml: string | null = null;
  let directError: unknown;
  try {
    directHtml = await fetchText(url);
  } catch (error: unknown) {
    directError = error;
  }

  if (directHtml && !isVerificationOrChallengePage(directHtml)) return directHtml;

  try {
    return await fetchRenderedText(url);
  } catch (renderError: unknown) {
    // 保留普通请求的具体错误；若普通请求拿到了验证页，则返回渲染错误，
    // 让 UI 明确知道隐藏浏览器也未能完成站点挑战。
    if (directError) throw directError;
    throw renderError;
  }
}

// 隐藏浏览器里从最终 DOM 读取磁力表：表已注入 → 直接读；未注入 → 模拟点击
// 「磁力」入口等站点脚本注入；仍没有 → 页面上下文内请求站点磁力接口。
const READ_MAGNET_TABLE_JS = String.raw`(() => {
  const table = document.querySelector('#magnet-table');
  if (table && table.querySelectorAll('a[href^="magnet:"]').length > 0) return table.outerHTML;
  return '';
})()`;

const CLICK_AND_READ_MAGNETS_JS = String.raw`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hits = Array.from(document.querySelectorAll('a, button, li, span'))
    .filter((el) => /磁力|magnet/i.test(el.textContent || ''))
    .filter((el) => !el.querySelector('a[href*="magnet"], button'));
  const trigger = hits.find((el) => el.offsetParent !== null) || hits[0];
  if (trigger) {
    try { trigger.click(); } catch (e) { /* ignore */ }
    await sleep(1500);
  }
  const table = document.querySelector('#magnet-table');
  if (table) return table.outerHTML;
  const holder = document.querySelector('#magnets-content');
  return holder ? holder.innerHTML : '';
})()`;

const AJAX_MAGNETS_IN_PAGE_JS = String.raw`(async () => {
  const html = document.documentElement.innerHTML;
  const gid = (window.gid !== undefined && window.gid !== null) ? String(window.gid) : (html.match(/var\s+gid\s*=\s*(\d+)/) || [])[1];
  const uc = (window.uc !== undefined && window.uc !== null) ? String(window.uc) : ((html.match(/var\s+uc\s*=\s*["']?([\w-]+)/) || [])[1] || '');
  const img = (window.img !== undefined && window.img !== null) ? String(window.img) : ((html.match(/var\s+img\s*=\s*["']([^"']+)["']/) || [])[1] || '');
  const lang = (window.lang !== undefined && window.lang !== null) ? String(window.lang) : ((html.match(/var\s+lang\s*=\s*["']([^"']+)["']/) || [])[1] || 'zh');
  if (!gid) return '';
  const floor = Math.floor(Math.random() * 1000) + 1;
  const res = await fetch('/ajax/uncledatoolsbyajax.php?gid=' + encodeURIComponent(gid) + '&lang=' + encodeURIComponent(lang) + '&img=' + encodeURIComponent(img || '') + '&uc=' + encodeURIComponent(uc) + '&floor=' + floor, { credentials: 'include' });
  return await res.text();
})()`;

/**
 * 在隐藏浏览器里加载作品页并从最终 DOM 提取磁力表。
 * 磁力表由站点自身脚本按需 AJAX 注入，静态 HTML 里没有；这里复用 Chromium
 * 会话（persist:mfl-javbus，含年龄确认 Cookie）加载页面，依次尝试
 * 读表 → 点击触发注入 → 页面上下文内请求站点磁力接口。
 */
async function fetchRenderedMagnetFragment(url: string, timeoutMs = 30000): Promise<string> {
  let electron: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electron = require('electron');
  } catch {
    throw new Error('当前运行环境不支持隐藏浏览器');
  }
  if (!electron?.BrowserWindow || !electron?.session) throw new Error('当前运行环境不支持隐藏浏览器');

  const ses = javbusPartitionSession(electron);
  try {
    await ses.cookies.set({ url, name: 'existmag', value: 'all', path: '/' });
  } catch {
    // Cookie 写入失败时仍尝试加载，某些镜像不要求该确认值。
  }

  const win = new electron.BrowserWindow({
    show: false,
    // 禁止抢主窗口焦点；否则刮削路径下用户正在输入时会偶发失焦
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      partition: 'persist:mfl-javbus',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try { win.webContents.setUserAgent(UA); } catch { /* use Chromium default if unavailable */ }
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`隐藏浏览器加载超时（${timeoutMs}ms）`)), timeoutMs);
    });
    await Promise.race([
      win.loadURL(url, { httpReferrer: url }),
      timeout,
    ]);
    await new Promise(resolve => setTimeout(resolve, 400));

    let fragment = await win.webContents.executeJavaScript(READ_MAGNET_TABLE_JS, true);
    if (!fragment) {
      fragment = await win.webContents.executeJavaScript(CLICK_AND_READ_MAGNETS_JS, true);
    }
    if (!fragment) {
      fragment = await win.webContents.executeJavaScript(AJAX_MAGNETS_IN_PAGE_JS, true);
    }
    const text = typeof fragment === 'string' ? fragment : '';
    log.info(TAG, `rendered magnet fragment ${Date.now() - started}ms len=${text.length}`);
    return text;
  } finally {
    if (timer) clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function fetchBinary(url: string, timeoutMs = 12000): Promise<Buffer> {
  const t0 = Date.now();
  log.debug(TAG, `GET bin ${url} timeout=${timeoutMs}ms`);
  try {
    const res = await electronFetch(url, timeoutMs, defaultHeaders({
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://www.javbus.com/',
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    log.debug(TAG, `GET bin ok ${Date.now() - t0}ms bytes=${buf.length}`);
    return buf;
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    log.warn(TAG, `GET bin fail ${Date.now() - t0}ms`, msg);
    throw new Error(`下载失败: ${msg} URL=${url}`);
  }
}

function textBetween(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;
}

/** 从 HTML 解析刮削结果（基于实站 CLUB-641 结构）。 */
export function parseJavbusHtml(html: string, baseUrl: string, code: string): JavbusScrapeResult {
  const base = normalizeBaseUrl(baseUrl);
  const pageUrl = `${base}/${normalizeCodeForUrl(code)}`;

  // Cloudflare / 空页检测
  if (/just a moment|checking your browser|cf-browser-verification/i.test(html)) {
    throw new Error('页面被 Cloudflare 拦截，请在浏览器能打开该站后再试，或配置可用代理');
  }

  const titleM = /<h3>([\s\S]*?)<\/h3>/i.exec(html);
  const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : normalizeCodeForUrl(code);

  let coverUrl: string | null = null;
  const coverM = /<a\s+class="bigImage"\s+href="([^"]+)"/i.exec(html);
  if (coverM) coverUrl = absUrl(base, coverM[1]);

  const sampleUrls: string[] = [];
  const sampleRe = /<a\s+class="sample-box"\s+href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = sampleRe.exec(html)) !== null) {
    sampleUrls.push(absUrl(base, m[1]));
  }

  // 演員：star-name / avatar-box；本片可能显示「暫無出演者資訊」
  const actresses: string[] = [];
  const starRe = /class="star-name"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = starRe.exec(html)) !== null) {
    const name = m[1].replace(/<[^>]+>/g, '').trim();
    if (name && !actresses.includes(name)) actresses.push(name);
  }
  if (actresses.length === 0) {
    const starLinkRe = /href="[^"]*\/star\/[^"]+"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = starLinkRe.exec(html)) !== null) {
      const name = m[1].replace(/<[^>]+>/g, '').trim();
      if (name && name.length < 40 && !/暫無|演员|演員/.test(name) && !actresses.includes(name)) actresses.push(name);
    }
  }

  // 類別：.genre a[href*="/genre/"]
  const genres: string[] = [];
  const genreRe = /class="genre"[\s\S]*?<a\s+href="[^"]*\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = genreRe.exec(html)) !== null) {
    const name = m[1].replace(/<[^>]+>/g, '').trim();
    if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
  }
  // 兜底：任意 /genre/ 链接（过滤导航里的「高清」「字幕」若不想要可保留——实站导航也有，页面类别区更准）
  if (genres.length === 0) {
    const genreLinkRe = /href="[^"]*\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = genreLinkRe.exec(html)) !== null) {
      const name = m[1].replace(/<[^>]+>/g, '').trim();
      if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
    }
  }

  // 信息区：發行日期 / 長度 / 製作商 / 發行商
  const releaseDate = textBetween(html, /發行日期:<\/span>\s*([^<]+)/i)
    ?? textBetween(html, /发行日期:<\/span>\s*([^<]+)/i);
  const runtime = textBetween(html, /長度:<\/span>\s*([^<]+)/i)
    ?? textBetween(html, /长度:<\/span>\s*([^<]+)/i);
  const studio = textBetween(html, /製作商:<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/i)
    ?? textBetween(html, /制作商:<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
  const label = textBetween(html, /發行商:<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/i)
    ?? textBetween(html, /发行商:<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/i);

  if (!coverUrl && sampleUrls.length === 0 && !titleM) {
    throw new Error(`页面解析失败（可能是番号不存在或站点结构变化）: ${pageUrl}`);
  }

  return {
    code: normalizeCodeForUrl(code),
    title,
    coverUrl,
    sampleUrls,
    actresses,
    genres,
    releaseDate,
    studio,
    label,
    runtime,
    pageUrl,
  };
}

export async function scrapeJavbus(baseUrl: string, code: string): Promise<JavbusScrapeResult> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('未配置 JavBus 站点地址（设置 → javbus_base_url）');
  const c = normalizeCodeForUrl(code);
  if (!c) throw new Error('影片编号为空，无法刮削');
  const pageUrl = `${base}/${c}`;
  const html = await fetchJavbusPageHtml(pageUrl);
  return parseJavbusHtml(html, base, c);
}

export function safeFileBase(name: string): string {
  return (name || 'cover')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'cover';
}

/** 把发行日/片长等拼进备注用的多行文本。
 *  注意：制作商/发行商已写入独立列（films.studio/label），不再拼进 notes，避免重复。 */
export function formatScrapeNotes(r: JavbusScrapeResult): string {
  const lines: string[] = [];
  if (r.releaseDate) lines.push(`发行日期: ${r.releaseDate}`);
  if (r.runtime) lines.push(`片长: ${r.runtime}`);
  if (r.pageUrl) lines.push(`来源: ${r.pageUrl}`);
  return lines.join('\n');
}

export interface JavbusActorProfileField {
  label: string;
  value: string;
}

export interface JavbusActorProfile {
  name: string | null;
  birthday: string | null;
  age: string | null;
  height: string | null;
  cup: string | null;
  bust: string | null;
  waist: string | null;
  hips: string | null;
  measurements: string | null;
  hobby: string | null;
  fields: JavbusActorProfileField[];
}

export interface JavbusActorWork {
  code: string | null;
  title: string;
  releaseDate: string | null;
  url: string;
}

export interface JavbusActorScrapeResult {
  pageUrl: string;
  profile: JavbusActorProfile;
  works: JavbusActorWork[];
  /** 已嗅探的作品列表页数（parse 固定为 1，翻页由 actors:scrapeMoreWorks 递增并回写） */
  worksPages: number;
  /** 列表是否存在「下一頁」入口 */
  worksHasNext: boolean;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_all, n: string) => {
      const value = n.toLowerCase().startsWith('x')
        ? Number.parseInt(n.slice(1), 16)
        : Number.parseInt(n, 10);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : _all;
    });
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlAttr(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  if (quoted) return decodeHtmlEntities(quoted[2]).trim();
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return bare ? decodeHtmlEntities(bare[1]).trim() : null;
}

export function normalizeActorPageUrl(raw: string): string {
  const value = (raw ?? '').trim();
  if (!value) throw new Error('演员 JavBus 主页地址为空');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('演员 JavBus 主页地址必须是完整的 http(s) URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('演员 JavBus 主页地址必须使用 http 或 https');
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function extractActorProfileFields(html: string): JavbusActorProfileField[] {
  const fields: JavbusActorProfileField[] = [];
  // JavBus 演员页当前使用 <span class="header">标签:</span> 值的结构。
  const headerRe = /<span\b[^>]*class\s*=\s*["'][^"']*\bheader\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*([\s\S]*?)(?=<\/p>|<\/li>|<br\s*\/?\s*>|<span\b[^>]*class\s*=\s*["'][^"']*\bheader\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(html)) !== null) {
    const label = stripHtml(m[1]).replace(/[：:]\s*$/, '').trim();
    const value = stripHtml(m[2]);
    if (!label || !value || value.length > 300) continue;
    if (!fields.some(f => f.label === label && f.value === value)) fields.push({ label, value });
  }

  // 个别镜像去掉 header class 时，保留对常见“标签: 值”段落的兜底。
  if (fields.length === 0) {
    const paragraphRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = paragraphRe.exec(html)) !== null) {
      const text = stripHtml(m[1]);
      const pair = /^([^:：]{1,20})\s*[:：]\s*(.+)$/.exec(text);
      if (!pair) continue;
      const label = pair[1].trim();
      const value = pair[2].trim();
      if (label && value && !fields.some(f => f.label === label && f.value === value)) fields.push({ label, value });
    }
  }
  return fields;
}

function fieldValue(fields: JavbusActorProfileField[], aliases: string[]): string | null {
  const normalized = (value: string) => value.toLowerCase().replace(/[\s：:._-]/g, '');
  const wanted = aliases.map(normalized);
  return fields.find(f => wanted.includes(normalized(f.label)))?.value ?? null;
}

function extractActorName(html: string, fields: JavbusActorProfileField[]): string | null {
  const fromField = fieldValue(fields, ['姓名', '名字', '名称', 'name', '名前']);
  if (fromField) return fromField;
  const starName = /<(?:div|span|h[1-3])\b[^>]*class\s*=\s*["'][^"']*\bstar-name\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|h[1-3])>/i.exec(html);
  if (starName) return stripHtml(starName[1]) || null;
  // 实站演员页使用 avatar-box > photo-info > span.pb10，而非 star-name。
  const photoName = /<div\b[^>]*class\s*=\s*["'][^"']*\bphoto-info\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class\s*=\s*["'][^"']*\bpb10\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (photoName) return stripHtml(photoName[1]) || null;
  const avatarImage = /<img\b([^>]*\bsrc\s*=\s*["'][^"']*\/pics\/actress\/[^"']*["'][^>]*)>/i.exec(html);
  if (avatarImage) {
    const title = htmlAttr(avatarImage[1], 'title') || htmlAttr(avatarImage[1], 'alt');
    if (title) return title;
  }
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return heading ? stripHtml(heading[1]) || null : null;
}

function extractActorWorks(html: string, pageUrl: string): JavbusActorWork[] {
  const works: JavbusActorWork[] = [];
  const boxRe = /<a\b([^>]*\bmovie-box\b[^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = boxRe.exec(html)) !== null) {
    const href = htmlAttr(m[1], 'href');
    if (!href) continue;
    let url: string;
    try { url = new URL(href, pageUrl).href; }
    catch { continue; }

    const image = /<img\b([^>]*)>/i.exec(m[2]);
    const title = (image && (htmlAttr(image[1], 'title') || htmlAttr(image[1], 'alt')))
      || stripHtml(m[2].replace(/<date\b[\s\S]*?<\/date>/gi, ''));
    const dates: string[] = [];
    const dateRe = /<date\b[^>]*>([\s\S]*?)<\/date>/gi;
    let d: RegExpExecArray | null;
    while ((d = dateRe.exec(m[2])) !== null) {
      const value = stripHtml(d[1]);
      if (value) dates.push(value);
    }
    const rawCode = dates[0] || /\/([^/?#]+?)(?:\.html)?(?:[/?#]|$)/i.exec(href)?.[1] || null;
    const code = rawCode ? rawCode.trim().toUpperCase() : null;
    const cleanTitle = title?.trim() || code || '未命名作品';
    const key = `${code ?? ''}|${url}`;
    if (works.some(w => `${w.code ?? ''}|${w.url}` === key)) continue;
    works.push({ code, title: cleanTitle, releaseDate: dates[1] ?? null, url });
  }
  return works;
}

/** 解析演员主页；仅返回文字资料和作品链接，不触发图片请求。 */
export function parseJavbusActorHtml(html: string, pageUrl: string): JavbusActorScrapeResult {
  const normalizedUrl = normalizeActorPageUrl(pageUrl);
  if (!html || /just a moment|checking your browser|cf-browser-verification/i.test(html)) {
    throw new Error('页面被 Cloudflare 拦截，无法读取演员资料');
  }
  if (/<title[^>]*>\s*age\s+verification|id\s*=\s*["']ageVerify["']|年龄验证/i.test(html)) {
    throw new Error('页面需要先完成 JavBus 年龄验证，当前请求未获得演员主页');
  }

  const fields = extractActorProfileFields(html);
  const profile: JavbusActorProfile = {
    name: extractActorName(html, fields),
    birthday: fieldValue(fields, ['生日', '出生日期', 'birthday', '生年月日']),
    age: fieldValue(fields, ['年龄', '年齡', 'age']),
    height: fieldValue(fields, ['身高', 'height']),
    cup: fieldValue(fields, ['罩杯', 'cup']),
    bust: fieldValue(fields, ['胸围', '胸圍', 'bust', 'b']),
    waist: fieldValue(fields, ['腰围', '腰圍', 'waist', 'w']),
    hips: fieldValue(fields, ['臀围', '臀圍', 'hips', 'hip', 'h']),
    measurements: fieldValue(fields, ['三围', '三圍', 'measurements']),
    hobby: fieldValue(fields, ['爱好', '愛好', '兴趣', '興趣', 'hobby', '趣味']),
    fields,
  };
  const works = extractActorWorks(html, normalizedUrl);
  if (!profile.name && fields.length === 0 && works.length === 0) {
    throw new Error(`演员主页解析失败（页面结构可能已变化）: ${normalizedUrl}`);
  }
  return { pageUrl: normalizedUrl, profile, works, worksPages: 1, worksHasNext: hasWorksNextPage(html) };
}

export async function scrapeJavbusActorPage(pageUrl: string): Promise<JavbusActorScrapeResult> {
  const normalizedUrl = normalizeActorPageUrl(pageUrl);
  const html = await fetchJavbusPageHtml(normalizedUrl);
  return parseJavbusActorHtml(html, normalizedUrl);
}

// —— 作品列表翻页嗅探 ——

export interface JavbusWorksPage {
  works: JavbusActorWork[];
  /** 页面上存在「下一頁」入口 */
  hasNext: boolean;
}

/** JavBus 列表页末尾的分页条有「下一頁」锚点；末页只有「上一頁」。 */
function hasWorksNextPage(html: string): boolean {
  return /下一頁|下一页/.test(html);
}

/** 作品列表第 N 页解析：仅作品列表 + 是否有下一页，不要求资料面板存在。 */
export function parseJavbusWorksPageHtml(html: string, pageUrl: string): JavbusWorksPage {
  const normalizedUrl = normalizeActorPageUrl(pageUrl);
  return { works: extractActorWorks(html, normalizedUrl), hasNext: hasWorksNextPage(html) };
}

export async function scrapeJavbusWorksPage(pageUrl: string): Promise<JavbusWorksPage> {
  const normalizedUrl = normalizeActorPageUrl(pageUrl);
  const html = await fetchJavbusPageHtml(normalizedUrl);
  return parseJavbusWorksPageHtml(html, normalizedUrl);
}

// —— 作品页磁力/种子资源嗅探 ——

export interface JavbusWorkMagnet {
  /** 完整 magnet:?xt=urn:btih:… 链接 */
  link: string;
  /** 资源名（优先磁链 dn= 参数，其次链接文本） */
  name: string;
  /** 体积文案，如 4.36GB */
  size: string | null;
  /** 分享日期 yyyy-mm-dd */
  date: string | null;
}

export interface JavbusWorkTorrent {
  link: string;
  name: string;
}

export interface JavbusWorkResources {
  pageUrl: string;
  magnets: JavbusWorkMagnet[];
  torrents: JavbusWorkTorrent[];
}

function magnetDisplayName(link: string, anchorText: string): string {
  const dn = /(?:^|&)dn=([^&]+)/.exec(link);
  if (dn) {
    const name = decodeURIComponent(dn[1].replace(/\+/g, ' ')).trim();
    if (name) return name;
  }
  return anchorText.trim() || link.slice(0, 60);
}

/** 从行 HTML 里取第一个磁力锚点的文本（磁力表第一格的名称）。 */
function firstMagnetAnchorText(rowHtml: string): string {
  const m = /<a\b[^>]*href\s*=\s*["']magnet:[^"']+["'][^>]*>([\s\S]*?)<\/a>/i.exec(rowHtml);
  return m ? stripHtml(m[1]) : '';
}

function extractSizeDate(text: string): { size: string | null; date: string | null } {
  return {
    size: /([0-9]+(?:\.[0-9]+)?\s*[KMGT]i?B)/i.exec(text)?.[1]?.replace(/\s+/g, '') ?? null,
    date: /\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? null,
  };
}

/**
 * 从一段 HTML（影片详情页本体、#magnet-table 磁力表或磁力 AJAX 片段）解析磁力行。
 * 实站磁力表为三列表格（磁力名稱/檔案大小/分享日期），磁力链接在行内每个单元格
 * 重复出现；优先按行结构提取，非表格页面退回「磁力锚点 + 邻近文本」抽取。
 */
export function parseMagnetsFromHtml(html: string): JavbusWorkMagnet[] {
  const tableMatch = /<table[^>]*\bid\s*=\s*["']?magnet-table["']?[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  const scope = tableMatch ? tableMatch[1] : html;
  const magnets: JavbusWorkMagnet[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(scope)) !== null) {
    const rowHtml = row[1];
    const linkM = /href\s*=\s*["'](magnet:[^"']+)["']/i.exec(rowHtml);
    if (!linkM) continue; // 表头行没有磁力链接
    const link = decodeHtmlEntities(linkM[1]).trim();
    if (!/^magnet:\?xt=urn:btih:/i.test(link)) continue;
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const cells = rowHtml.split(/<td\b/i).slice(1)
      .map(td => stripHtml(td.split(/<\/td>/i)[0] ?? ''));
    // 名称取第一格磁力锚点文本（排除「高清」等角标），结构变化时退回 dn= 参数
    const name = firstMagnetAnchorText(rowHtml)
      || magnetDisplayName(link, '')
      || cells[0]
      || link.slice(0, 60);
    const fromCells = extractSizeDate(`${cells[1] ?? ''} ${cells[2] ?? ''}`);
    const fromRow = extractSizeDate(stripHtml(rowHtml));
    magnets.push({
      link,
      name,
      size: fromCells.size ?? fromRow.size,
      date: fromCells.date ?? fromRow.date,
    });
  }
  if (magnets.length > 0) return magnets;

  // 兜底：无表结构时按「磁力锚点 + 邻近文本」抽取。行元数据通常紧随锚点之后、
  // 下一个磁力锚点之前；个别镜像放在锚点之前，此时回退取上一个锚点之后的文本。
  const matches: { link: string; text: string; index: number; end: number }[] = [];
  const anchorRe = /<a\b[^>]*href\s*=\s*["'](magnet:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    matches.push({ link: m[1], text: m[2], index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const link = decodeHtmlEntities(cur.link).trim();
    if (!/^magnet:\?xt=urn:btih:/i.test(link)) continue;
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const after = html.slice(cur.end, matches[i + 1]?.index ?? html.length);
    const before = html.slice(matches[i - 1]?.end ?? 0, cur.index);
    let contextText = stripHtml(after).slice(0, 200);
    if (!/[KMGT]i?B/i.test(contextText) && !/\d{4}-\d{2}-\d{2}/.test(contextText)) {
      contextText = stripHtml(before).slice(0, 200);
    }
    const size = /([0-9]+(?:\.[0-9]+)?\s*[KMGT]i?B)/i.exec(contextText)?.[1]?.replace(/\s+/g, '') ?? null;
    const date = /\d{4}-\d{2}-\d{2}/.exec(contextText)?.[0] ?? null;
    magnets.push({ link, name: magnetDisplayName(link, stripHtml(cur.text)), size, date });
  }
  return magnets;
}

/** 解析 .torrent / 站点种子下载链接（部分镜像提供）。 */
export function parseTorrentsFromHtml(html: string, baseUrl: string): JavbusWorkTorrent[] {
  const torrents: JavbusWorkTorrent[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1]).trim();
    if (/^magnet:/i.test(href)) continue;
    if (!/\.torrent(?:$|[?#])/i.test(href) && !/\/torrent\//i.test(href)) continue;
    let link: string;
    try { link = new URL(href, baseUrl).href; }
    catch { continue; }
    if (!/^https?:/i.test(link) || seen.has(link)) continue;
    seen.add(link);
    const fileName = decodeURIComponent(href.split('/').pop() ?? '').replace(/\.(torrent).*$/i, '');
    torrents.push({ link, name: stripHtml(m[2]) || fileName || '种子' });
  }
  return torrents;
}

/**
 * 磁力表接口（站点 gallery.js 的加载逻辑）：页面 ready 时请求
 * /ajax/uncledatoolsbyajax.php?gid=&lang=&img=&uc=&floor=随机数，
 * 把响应行 append 进 #magnet-table。floor 是 1~1000 的随机缓存穿透参数。
 * 参数值与站点脚本一致，从页面脚本的 var gid/uc/img/lang 里提取。
 */
function magnetAjaxUrl(url: URL, html: string): string | null {
  const gid = /var\s+gid\s*=\s*(\d+)/.exec(html)?.[1];
  if (!gid) return null;
  const uc = /var\s+uc\s*=\s*["']?([\w-]+)/.exec(html)?.[1] ?? '';
  const img = /var\s+img\s*=\s*["']([^"']+)["']/.exec(html)?.[1]
    ?? /<a\s+class="bigImage"\s+href="([^"]+)"/i.exec(html)?.[1]
    ?? '';
  const lang = /var\s+lang\s*=\s*["']([^"']+)["']/.exec(html)?.[1] ?? 'zh';
  const floor = Math.floor(Math.random() * 1000) + 1;
  return `${url.origin}/ajax/uncledatoolsbyajax.php?gid=${gid}`
    + `&lang=${encodeURIComponent(lang)}&img=${encodeURIComponent(img)}`
    + `&uc=${encodeURIComponent(uc)}&floor=${floor}`;
}

/**
 * 快路径：直连磁力接口一次往返即可拿到磁力行片段，比隐藏浏览器整页渲染
 * 快一个量级。接口失败/被拦截/页面缺参数时返回 null，由调用方走隐藏浏览器兜底。
 */
async function fetchMagnetsViaAjax(url: URL, html: string): Promise<JavbusWorkMagnet[] | null> {
  const ajaxUrl = magnetAjaxUrl(url, html);
  if (!ajaxUrl) return null;
  const t0 = Date.now();
  try {
    const fragment = await fetchText(ajaxUrl, 10000);
    const magnets = parseMagnetsFromHtml(fragment);
    log.info(TAG, `magnet ajax direct magnets=${magnets.length} ${Date.now() - t0}ms`);
    return magnets.length > 0 ? magnets : null;
  } catch (e: unknown) {
    log.warn(TAG, `magnet ajax direct fail ${Date.now() - t0}ms`, String((e as Error)?.message ?? e));
    return null;
  }
}

/**
 * 嗅探作品详情页的磁力/种子资源。
 * 顺序：静态 HTML（少数镜像直出磁力表）→ 直连磁力接口（快）→
 * 隐藏浏览器读最终 DOM（慢，兜底挑战页/接口参数缺失）。
 */
export async function sniffJavbusWorkResources(rawUrl: string): Promise<JavbusWorkResources> {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error('作品地址无效'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('作品地址必须使用 http 或 https');
  }
  const html = await fetchJavbusPageHtml(url.href);
  let magnets = parseMagnetsFromHtml(html);
  const torrents = parseTorrentsFromHtml(html, url.origin);
  if (magnets.length === 0) {
    const viaAjax = await fetchMagnetsViaAjax(url, html);
    if (viaAjax) magnets = viaAjax;
  }
  if (magnets.length === 0) {
    try {
      const fragment = await fetchRenderedMagnetFragment(url.href);
      magnets = parseMagnetsFromHtml(fragment);
    } catch (e: unknown) {
      log.warn(TAG, `rendered magnet fail url=${url.href}`, String((e as Error)?.message ?? e));
    }
  }
  return { pageUrl: url.href, magnets, torrents };
}
