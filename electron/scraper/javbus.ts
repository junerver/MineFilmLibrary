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
async function fetchRenderedText(url: string, timeoutMs = 30000): Promise<string> {
  let electron: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    electron = require('electron');
  } catch {
    throw new Error('当前运行环境不支持隐藏浏览器');
  }
  if (!electron?.BrowserWindow || !electron?.session) throw new Error('当前运行环境不支持隐藏浏览器');

  const partition = 'persist:mfl-javbus';
  const ses = electron.session.fromPartition(partition);
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
      partition,
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
  return { pageUrl: normalizedUrl, profile, works };
}

export async function scrapeJavbusActorPage(pageUrl: string): Promise<JavbusActorScrapeResult> {
  const normalizedUrl = normalizeActorPageUrl(pageUrl);
  const html = await fetchJavbusPageHtml(normalizedUrl);
  return parseJavbusActorHtml(html, normalizedUrl);
}
