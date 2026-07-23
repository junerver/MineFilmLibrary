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
const CODE_RE = /^([A-Za-z]+[-_]?[0-9]+)/;
const LOCALE_RE = /^-([CcUu])/;
const TAG_RE = /^\s*\[([^\]]+)\]/;
// 目录末尾常见的画质后缀不是影片标题；只接受明确的独立 token，
// 避免把类似 "-HDsomething" 的真实标题前缀误吞。
const DASH_TAG_RE = /^-(FHD|UHD|HD|4K)(?=$|\s|\[)/i;

export function parseFilmDirName(raw: string): ParsedDir {
  let s = raw.trim();
  let code: string | null = null;
  let locale: Locale = null;
  const tags: string[] = [];

  const codeM = FC2_CODE_RE.exec(s) ?? CODE_RE.exec(s);
  if (codeM) {
    // 保留原大小写与分隔符（避免与测试用例不一致：abc_123 不应被改写）
    code = codeM[1];
    s = s.slice(codeM[0].length);

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
