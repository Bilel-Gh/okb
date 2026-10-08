import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The new web app: built into web/app, served by OKB's own local server (no CDN, no inline script).
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, '..', 'web', 'app'),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5317, proxy: { '/api': 'http://127.0.0.1:4317', '/vendor': 'http://127.0.0.1:4317' } },
});
