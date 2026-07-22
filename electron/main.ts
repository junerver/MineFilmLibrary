import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDb } from './db';
import { registerAllIpc } from './ipc/registry';

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
    await win.loadURL('http://localhost:5173');
  } else {
    await win.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
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
