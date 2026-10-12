import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the REAL production build (vite preview), so what
 * is tested is what ships. Two projects:
 * - desktop: hover/keyboard header behavior, editor, a11y
 * - mobile (Pixel 5 emulation, touch): the touch menu handle flow
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
});
