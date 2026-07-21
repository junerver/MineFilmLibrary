import type { Locale, ParsedDir, ParsedParent, ParentType, ScanStatus } from '../util/types';

export interface ParentParseOptions {
  defaultType: Extract<ParentType, 'actor' | 'genre'>;
}

export function parseParentDirName(raw: string, opts: ParentParseOptions): ParsedParent {
  const m = /^(\d+)-(.+)$/.exec(raw.trim());
  if (m) {
    const idx = Number(m[1]);
    const name = m[2].trim();
    if (idx === 1) return { parent_type: 'genre', name };
    return { parent_type: 'actor', name };
  }
  const name = raw.trim() || null;
  return { parent_type: opts.defaultType, name };
}

const CODE_RE = /^([A-Za-z]+[-_]?[0-9]+)/;
const LOCALE_RE = /^-([CcUu])/;
const TAG_RE = /^\s*\[([^\]]+)\]/;

export function parseFilmDirName(raw: string): ParsedDir {
  let s = raw.trim();
  let code: string | null = null;
  let locale: Locale = null;
  const tags: string[] = [];

  const codeM = CODE_RE.exec(s);
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
