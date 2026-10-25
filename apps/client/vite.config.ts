import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// `vite build` produces the web bundle served by Workers Static Assets.
// `vite build --mode desktop` produces the bundle embedded in the Tauri app.
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    plugins: [react()],
    base: desktop ? './' : '/',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __PLATFORM__: JSON.stringify(desktop ? 'desktop' : 'web'),
    },
    build: {
      outDir: desktop ? 'dist-desktop' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !desktop && mode === 'production' ? false : true,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin API in development so cookies behave as in production.
      proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    },
    clearScreen: false,
  };
});
