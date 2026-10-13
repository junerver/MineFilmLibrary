import type Database from 'better-sqlite3';
import path from 'node:path';

/**
 * 盘符映射：数据库与界面始终使用「库盘符」（虚拟盘符），
 * 所有磁盘访问（扫描 / 文件操作 / 封面 / 刮削写图）在主进程入口处
 * 换成「真实盘符」。典型场景：磁盘盘符从 F 变为 G 后，不重指向
 * 扫描根目录，避免与已有记录碰撞产生重复。
 */
export interface DriveMapping {
  /** 库盘符（虚拟），如 'F:' */
  from: string;
  /** 真实盘符（磁盘），如 'G:' */
  to: string;
}

export const DRIVE_MAPPINGS_KEY = 'drive_mappings';

/** 把用户输入规范成 'X:' 形式；非法输入返回 null。 */
export function normalizeDriveLetter(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const t = input.trim().replace(/[\\/]+$/, '');
  if (!/^[A-Za-z]:?$/.test(t)) return null;
  return `${t[0].toUpperCase()}:`;
}

/** 解析 settings 里存的 JSON；坏数据一律当作无映射，不影响正常使用。 */
export function parseDriveMappings(raw: string | null | undefined): DriveMapping[] {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: DriveMapping[] = [];
    for (const m of arr) {
      const from = normalizeDriveLetter((m as any)?.from);
      const to = normalizeDriveLetter((m as any)?.to);
      if (from && to && from !== to) out.push({ from, to });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeDriveMappings(mappings: DriveMapping[]): string {
  return JSON.stringify(mappings);
}

export function loadDriveMappings(db: Database.Database): DriveMapping[] {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(DRIVE_MAPPINGS_KEY) as
      | { value: string }
      | undefined;
    return parseDriveMappings(row?.value);
  } catch {
    return [];
  }
}

function driveRootOf(p: string): string | null {
  // UNC（\\server\share）与非法路径没有盘符概念，不做映射。
  const root = path.parse(path.resolve(p)).root;
  return /^[A-Za-z]:/.test(root) ? root.slice(0, 2).toUpperCase() : null;
}

function swapDrive(p: string, drive: string): string {
  const resolved = path.resolve(p);
  return drive + resolved.slice(2);
}

/** 库内虚拟路径 -> 磁盘真实路径（所有 fs / shell 访问前调用）。 */
export function virtualToReal(p: string, mappings: DriveMapping[]): string {
  if (!mappings.length || !p) return p;
  const drive = driveRootOf(p);
  if (!drive) return p;
  for (const m of mappings) {
    if (m.from === drive) return swapDrive(p, m.to);
  }
  return p;
}

/** 磁盘真实路径 -> 库内虚拟路径（扫描结果 / 文件清单入库前调用）。 */
export function realToVirtual(p: string, mappings: DriveMapping[]): string {
  if (!mappings.length || !p) return p;
  const drive = driveRootOf(p);
  if (!drive) return p;
  for (const m of mappings) {
    if (m.to === drive) return swapDrive(p, m.from);
  }
  return p;
}
