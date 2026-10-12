/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

/**
 * Vite config.
 *
 * `base: './'` makes every asset URL relative, so the same build works on
 * GitHub Pages project URLs (/CV-Web/), Netlify, or opened from any subpath.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 2048,
    // Public site JS budget is < 50 KB gzipped; edit mode is code-split
    // automatically because it is dynamically imported (#admin).
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/admin/**'],
    },
  },
});
