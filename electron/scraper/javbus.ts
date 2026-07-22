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
  const html = await fetchText(pageUrl);
  return parseJavbusHtml(html, base, c);
}

export function safeFileBase(name: string): string {
  return (name || 'cover')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'cover';
}

/** 把发行日/厂牌等拼进备注用的多行文本。 */
export function formatScrapeNotes(r: JavbusScrapeResult): string {
  const lines: string[] = [];
  if (r.releaseDate) lines.push(`发行日期: ${r.releaseDate}`);
  if (r.runtime) lines.push(`片长: ${r.runtime}`);
  if (r.studio) lines.push(`制作商: ${r.studio}`);
  if (r.label) lines.push(`发行商: ${r.label}`);
  if (r.pageUrl) lines.push(`来源: ${r.pageUrl}`);
  return lines.join('\n');
}
