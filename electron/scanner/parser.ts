import type { Locale, ParsedDir, ParsedParent, ParentType, ScanStatus } from '../util/types';

export interface ParentParseOptions {
  defaultType: Extract<ParentType, 'actor' | 'genre'>;
}

export function parseParentDirName(raw: string, opts: ParentParseOptions): ParsedParent {
  // 平铺根扫描会传入空字符串（root 直接是影片目录），raw.trim() 必须容忍；
  // 任何空/纯空白输入都返回 name=null，上层据此跳过演员/题材 upsert。
  const s = (raw ?? '').trim();
  if (!s) return { parent_type: opts.defaultType, name: null };
  const m = /^(\d+)-(.+)$/.exec(s);
  if (m) {
    const idx = Number(m[1]);
    const name = m[2].trim();
    if (idx === 1) return { parent_type: 'genre', name };
    return { parent_type: 'actor', name };
  }
  return { parent_type: opts.defaultType, name: s || null };
}

// FC2-PPV 编号中间还有厂商段（例如 FC2-PPV-739673），不能让通用规则
// 先截成 "FC2"。保留原始大小写和分隔符，便于后续按原编号刮削。
const FC2_CODE_RE = /^(FC2[-_]?PPV[-_]?\d+)/i;
// 编号前缀并不总是“纯字母 + 数字”：
// - S2MBD-016 / 261ARA-417：厂商段本身是字母数字混合；
// - 122813-509-carib：数字开头且带厂商后缀（现由 vendor 规则优先处理）。
// 以 locale、画质 token、方括号或空白作为编号边界，并要求至少含一个数字，
// 避免把普通英文标题的首词误识别成编号。
const CODE_RE = /^((?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*?)(?=-(?:[CcUu])(?=$|\s|\[)|-(?:FHD|UHD|HD|SD|4K)(?=$|\s|\[)|\s|\[|$)/i;
const LOCALE_RE = /^-([CcUu])/;
const TAG_RE = /^\s*\[([^\]]+)\]/;
// 目录末尾常见的画质后缀不是影片标题；只接受明确的独立 token，
// 避免把类似 "-HDsomething" 的真实标题前缀误吞。
const DASH_TAG_RE = /^-(FHD|UHD|HD|SD|4K)(?=$|\s|\[)/i;

interface VendorCodeHit {
  code: string;
  removeStart: number;
  removeEnd: number;
}

/**
 * 关键字驱动的特殊厂商编号：命中后丢弃厂商标记，只保留规范 code。
 * 优先级：carib → 1pon/1pondo → Tokyo Hot；未命中返回 null 走通用规则。
 */
function matchVendorCode(s: string): VendorCodeHit | null {
  const tryPatterns = (patterns: RegExp[], normalize?: (raw: string) => string): VendorCodeHit | null => {
    for (const re of patterns) {
      const m = re.exec(s);
      if (!m?.[1]) continue;
      return {
        code: normalize ? normalize(m[1]) : m[1],
        removeStart: m.index,
        removeEnd: m.index + m[0].length,
      };
    }
    return null;
  };

  // 加勒比：{数字}-{数字}，如 040415-846 / Carib-071419-961
  if (/carib/i.test(s)) {
    const hit = tryPatterns([
      /(\d+-\d+)[-_\s]*carib/i,
      /carib[-_\s]*(\d+-\d+)/i,
    ]);
    if (hit) return hit;
  }

  // 一本道：{数字}_{数字}，1pon 与 1pondo 均识别
  if (/1pon(?:do)?/i.test(s)) {
    const hit = tryPatterns([
      /(\d+_\d+)[-_\s]*1pon(?:do)?/i,
      /1pon(?:do)?[-_\s]*(\d+_\d+)/i,
    ]);
    if (hit) return hit;
  }

  // Tokyo Hot：n{数字}，统一小写（n0917）
  if (/tokyo[-_\s]?hot/i.test(s)) {
    const hit = tryPatterns(
      [
        /tokyo[-_\s]?hot[-_\s]*(n\d+)/i,
        /(n\d+)[-_\s]*tokyo[-_\s]?hot/i,
      ],
      (raw) => raw.toLowerCase(),
    );
    if (hit) return hit;
  }

  return null;
}

export function parseFilmDirName(raw: string): ParsedDir {
  let s = raw.trim();
  let code: string | null = null;
  let locale: Locale = null;
  const tags: string[] = [];

  const vendor = matchVendorCode(s);
  if (vendor) {
    code = vendor.code;
    s = `${s.slice(0, vendor.removeStart)}${s.slice(vendor.removeEnd)}`;
  } else {
    const codeM = FC2_CODE_RE.exec(s) ?? CODE_RE.exec(s);
    if (codeM) {
      // 保留原大小写与分隔符（避免与测试用例不一致：abc_123 不应被改写）
      code = codeM[1];
      s = s.slice(codeM[0].length);
    }
  }

  if (code) {
    const localeM = LOCALE_RE.exec(s);
    if (localeM) {
      locale = localeM[1].toUpperCase() as 'C' | 'U';
      s = s.slice(localeM[0].length);
    }
  }

  while (true) {
    const dashTagM = DASH_TAG_RE.exec(s);
    if (dashTagM) {
      tags.push(dashTagM[1]);
      s = s.slice(dashTagM[0].length);
      continue;
    }
    const tagM = TAG_RE.exec(s);
    if (!tagM) break;
    const v = tagM[1].trim();
    if (v) tags.push(v);
    s = s.slice(tagM[0].length);
  }

  const title = s.trim() || null;

  let status: ScanStatus = 'unknown';
  const hasAny = code || title || tags.length > 0 || locale;
  if (code && title) status = 'parsed';
  else if (hasAny) status = 'partial';

  return { code, locale, tags, title, scan_status: status };
}
