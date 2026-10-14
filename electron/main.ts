import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDb } from './db';
import { registerAllIpc } from './ipc/registry';
import { initLogger, info } from './util/logger';

const isDev = process.env.NODE_ENV === 'development';

let win: BrowserWindow | null = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) {
    // 与 vite.config server.host/port 对齐；勿用 localhost（可能解析到仅 IPv6 的 ::1）
    await win.loadURL('http://127.0.0.1:5199');
  } else {
    await win.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
  initLogger(app.getPath('userData'));
  info('main', `app ready dev=${isDev} userData=${app.getPath('userData')}`);
  getDb();
  registerAllIpc();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
