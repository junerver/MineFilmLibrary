import path from 'node:path';

/** Windows 路径大小写不敏感比较用的标准化 key。 */
export function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** abs 是否位于 parent 之下（含等于 parent）。 */
export function isPathUnderOrEqual(abs: string, parent: string): boolean {
  const a = pathKey(abs);
  const p = pathKey(parent);
  if (a === p) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return a.startsWith(prefix);
}

/** abs 是否严格位于 parent 之下（不含等于 parent）。 */
export function isPathStrictlyUnder(abs: string, parent: string): boolean {
  return isPathUnderOrEqual(abs, parent) && pathKey(abs) !== pathKey(parent);
}

/**
 * 将 abs 中的 oldPrefix 前缀替换为 newPrefix。
 * 匹配按 pathKey（Windows 忽略大小写），输出保留 path.resolve 形态。
 */
export function replacePathPrefix(abs: string, oldPrefix: string, newPrefix: string): string {
  const resolvedAbs = path.resolve(abs);
  const resolvedOld = path.resolve(oldPrefix);
  const resolvedNew = path.resolve(newPrefix);
  if (pathKey(resolvedAbs) === pathKey(resolvedOld)) return resolvedNew;
  if (!isPathStrictlyUnder(resolvedAbs, resolvedOld)) {
    throw new Error(`路径不在前缀下: ${abs}`);
  }
  const rel = path.relative(resolvedOld, resolvedAbs);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`无法计算相对路径: ${abs}`);
  }
  return path.join(resolvedNew, rel);
}

/** 校验目录名是否适合作为单层目录名（不含路径分隔符）。 */
export function validateDirName(name: string): string | null {
  const t = name.trim();
  if (!t) return '名称不能为空';
  if (t === '.' || t === '..') return '名称非法';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(t)) return '名称包含非法字符';
  // Windows 不允许以点或空格结尾
  if (/[. ]$/.test(t)) return '名称不能以点或空格结尾';
  return null;
}

/** 影片路径的父目录是否允许重命名（非盘符/文件系统根）。 */
export function canRenameParentDir(filmAbsPath: string): boolean {
  const resolved = path.resolve(filmAbsPath);
  const parent = path.dirname(resolved);
  const root = path.parse(resolved).root;
  return pathKey(parent) !== pathKey(root);
}

export function parentAbsOfFilm(filmAbsPath: string): string {
  return path.dirname(path.resolve(filmAbsPath));
}
