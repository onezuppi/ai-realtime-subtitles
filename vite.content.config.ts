import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: { entry: resolve(__dirname, 'src/content/overlay.ts'), formats: ['iife'], name: 'SubtitleOverlay', fileName: () => 'content.js' },
  },
});
