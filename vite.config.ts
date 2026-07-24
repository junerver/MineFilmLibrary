import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // 固定 IPv4 + 端口，避免：
  // 1) 5173 被占用时静默落到 5174，而 Electron/wait-on 仍盯着 5173
  // 2) 仅监听 ::1 时 Electron/浏览器走 127.0.0.1 连不上
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/actresses/**',
        '**/dist-electron/**',
        '**/dist-renderer/**',
        '**/release/**',
        '**/tmp/**',
      ],
    },
  },
  build: { outDir: 'dist-renderer', emptyOutDir: true },
  // Vite 默认会扫描项目根目录下的所有 HTML。electron-builder 的 release
  // 产物也包含大型 HTML，必须将依赖扫描限制为真正的渲染器入口。
  optimizeDeps: {
    entries: ['index.html'],
    include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-dev-runtime'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
