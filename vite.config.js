import { defineConfig } from 'vite';
import { catalogPlugin } from './scripts/lib/vite-catalog-plugin.mjs';

export default defineConfig({
  // Relative base so `dist/` works from a file:// path, a GitHub Pages
  // subdirectory or a custom domain without being rebuilt.
  base: './',
  plugins: [catalogPlugin()],
  server: {
    port: 5180,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
  },
});
