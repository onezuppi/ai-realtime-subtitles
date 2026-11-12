import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Pages, service worker and audio worklet. The content script is built separately (vite.content.config.ts)
// because it must be a single classic script.
export default defineConfig({
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'capture-worklet': resolve(__dirname, 'src/offscreen/capture-worklet.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
        // Development only: BENCH=1 pnpm run build adds a page that measures the browser models.
        ...(process.env.BENCH ? { bench: resolve(__dirname, 'src/dev/bench.html') } : {}),
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
});
