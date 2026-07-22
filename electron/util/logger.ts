/**
 * 主进程日志：控制台 + 按日滚动文件。
 * 路径：userData/logs/mfl-YYYY-MM-DD.log
 * 供刮削等长任务排查（fetch 超时、解析失败等）。
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let logDir: string | null = null;
let currentFile: string | null = null;
let stream: fs.WriteStream | null = null;

function dayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureStream() {
  if (!logDir) return;
  const file = path.join(logDir, `mfl-${dayStamp()}.log`);
  if (stream && currentFile === file) return;
  try { stream?.end(); } catch { /* ignore */ }
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  stream = fs.createWriteStream(file, { flags: 'a' });
  currentFile = file;
}

function fmt(level: LogLevel, tag: string, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  let line = `${ts} [${level.toUpperCase()}] [${tag}] ${msg}`;
  if (extra !== undefined) {
    try {
      const s = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 0);
      line += ` ${s}`;
    } catch {
      line += ` ${String(extra)}`;
    }
  }
  return line;
}

export function initLogger(userDataPath: string) {
  logDir = path.join(userDataPath, 'logs');
  ensureStream();
  info('logger', `log dir ready: ${logDir}`);
}

export function getLogDir(): string | null {
  return logDir;
}

export function getCurrentLogFile(): string | null {
  ensureStream();
  return currentFile;
}

function write(level: LogLevel, tag: string, msg: string, extra?: unknown) {
  const line = fmt(level, tag, msg, extra);
  // 控制台
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  // 文件
  try {
    ensureStream();
    stream?.write(line + '\n');
  } catch {
    // ignore disk errors
  }
}

export function debug(tag: string, msg: string, extra?: unknown) { write('debug', tag, msg, extra); }
export function info(tag: string, msg: string, extra?: unknown) { write('info', tag, msg, extra); }
export function warn(tag: string, msg: string, extra?: unknown) { write('warn', tag, msg, extra); }
export function error(tag: string, msg: string, extra?: unknown) { write('error', tag, msg, extra); }

/** 计时辅助：const done = timed('scrape','download'); ... done('ok'); */
export function timed(tag: string, label: string): (result?: string, extra?: unknown) => number {
  const t0 = Date.now();
  info(tag, `${label} start`);
  return (result = 'done', extra?: unknown) => {
    const ms = Date.now() - t0;
    info(tag, `${label} ${result} (${ms}ms)`, extra);
    return ms;
  };
}
