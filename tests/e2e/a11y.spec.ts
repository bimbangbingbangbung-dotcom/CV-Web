/**
 * Accessibility gate: axe-core against the public page in both themes.
 * Serious/critical violations fail the suite (moderate/minor are reported
 * by the Lighthouse CI run instead).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { projectSlugs } from '../../src/utils/slug';

const content = JSON.parse(
  readFileSync(new URL('../../public/content.json', import.meta.url), 'utf8'),
) as { projects: { title: string }[] };

const badViolations = (
  violations: { impact?: string | null; id: string; help: string }[],
): string[] =>
  violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help}`);

test.describe('axe accessibility', () => {
  test('public page (light theme)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).analyze();
    expect(badViolations(results.violations)).toEqual([]);
  });

  test('public page (dark theme)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const results = await new AxeBuilder({ page }).analyze();
    expect(badViolations(results.violations)).toEqual([]);
  });

  test('touch menu overlay', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'overlay opens via the touch handle');
    await page.goto('/');
    await page.locator('.touch-handle').tap();
    await expect(page.locator('#site-menu')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('#site-menu').analyze();
    expect(badViolations(results.violations)).toEqual([]);
  });
});
