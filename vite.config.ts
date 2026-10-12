import { defineConfig } from 'vitest/config';
import { seoPlugin } from './scripts/seo-plugin.ts';

/**
 * Vite config.
 *
 * `base: './'` makes every asset URL relative, so the same build works on
 * GitHub Pages project URLs (/CV-Web/), Netlify, or opened from any subpath.
 */
export default defineConfig({
  base: './',
  plugins: [seoPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 2048,
    // Public site JS budget is < 50 KB gzipped; edit mode is code-split
    // automatically because it is dynamically imported (#admin). The named
    // "admin" chunk lets scripts/check-budget.mjs exclude it explicitly.
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, '/');
          return normalized.includes('/src/admin/') ? 'admin' : undefined;
        },
      },
    },
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
