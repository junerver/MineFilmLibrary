// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canRenameParentDir,
  isPathStrictlyUnder,
  isPathUnderOrEqual,
  pathKey,
  replacePathPrefix,
  validateDirName,
} from '../electron/util/pathOps';

describe('pathOps', () => {
  it('validates directory names', () => {
    expect(validateDirName('ABC-001 Title')).toBeNull();
    expect(validateDirName('  ')).toBeTruthy();
    expect(validateDirName('a/b')).toBeTruthy();
    expect(validateDirName('a\\b')).toBeTruthy();
    expect(validateDirName('a:b')).toBeTruthy();
    expect(validateDirName('..')).toBeTruthy();
    expect(validateDirName('ok.')).toBeTruthy();
  });

  it('detects path containment with boundary', () => {
    const parent = path.resolve('F:/A/B');
    const child = path.resolve('F:/A/B/film');
    const sibling = path.resolve('F:/A/B2/film');
    expect(isPathUnderOrEqual(child, parent)).toBe(true);
    expect(isPathStrictlyUnder(child, parent)).toBe(true);
    expect(isPathStrictlyUnder(parent, parent)).toBe(false);
    expect(isPathUnderOrEqual(sibling, parent)).toBe(false);
  });

  it('rewrites abs path prefix', () => {
    const oldP = path.resolve('F:/A/B');
    const newP = path.resolve('F:/A/B_new');
    const film = path.join(oldP, 'AAA-1');
    const file = path.join(film, 'cover.jpg');
    expect(replacePathPrefix(film, oldP, newP)).toBe(path.join(newP, 'AAA-1'));
    expect(replacePathPrefix(file, oldP, newP)).toBe(path.join(newP, 'AAA-1', 'cover.jpg'));
    expect(replacePathPrefix(oldP, oldP, newP)).toBe(newP);
  });

  it('pathKey normalizes for comparison', () => {
    if (process.platform === 'win32') {
      expect(pathKey('C:\\Foo')).toBe(pathKey('c:/foo'));
    } else {
      expect(pathKey('/tmp/a')).toBe(path.resolve('/tmp/a'));
    }
  });

  it('canRenameParentDir rejects filesystem root parent', () => {
    if (process.platform === 'win32') {
      expect(canRenameParentDir('C:\\filmDir')).toBe(false);
      expect(canRenameParentDir('C:\\A\\filmDir')).toBe(true);
    } else {
      expect(canRenameParentDir('/filmDir')).toBe(false);
      expect(canRenameParentDir('/A/filmDir')).toBe(true);
    }
  });
});
