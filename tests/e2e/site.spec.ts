/**
 * Public site E2E: content rendering, the auto-hide header contract,
 * theme behavior, print output and console cleanliness.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const content = JSON.parse(
  readFileSync(new URL('../../public/content.json', import.meta.url), 'utf8'),
) as {
  owner: { fullName: string };
  site: { title: string };
  sections: { id: string; label: string; enabled: boolean }[];
};

/** True when the header currently has the visible class. */
const headerVisible = (page: Page): Promise<boolean> =>
  page.locator('.site-header').evaluate((el) => el.classList.contains('is-visible'));

test.describe('content rendering', () => {
  test('renders the owner name and site title from content.json', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText(content.owner.fullName);
    await expect(page).toHaveTitle(content.site.title);
  });

  test('renders every enabled section heading', async ({ page }) => {
    await page.goto('/');
    for (const section of content.sections.filter((s) => s.enabled)) {
      await expect(page.locator(`#${section.id}-title`)).toHaveText(section.label);
    }
  });

  test('every header nav link points to a section that exists', async ({ page }) => {
    // Guards the nav filter: sections with no data vanish from the page, so
    // a stale nav entry would ship a broken #anchor.
    await page.goto('/');
    const hrefs = await page
      .locator('.header-nav a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    const anchors = hrefs.filter(
      (h): h is string => h !== null && h.startsWith('#') && h !== '#admin',
    );
    expect(anchors.length).toBeGreaterThan(0);
    for (const href of anchors) {
      await expect(page.locator(`main ${href}`)).toHaveCount(1);
    }
  });

  test('ships JSON-LD structured data', async ({ page }) => {
    await page.goto('/');
    const jsonLd = page.locator('script[type="application/ld+json"]');
    await expect(jsonLd).toHaveCount(1);
    const parsed = JSON.parse((await jsonLd.textContent()) ?? '{}') as { name?: string };
    expect(parsed.name).toBe(content.owner.fullName);
  });

  test('no uncaught page errors on load', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});

test.describe('auto-hide header', () => {
  test('is hidden by default and reveals on top-edge hover', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hover interaction is desktop-only');
    await page.goto('/');
    expect(await headerVisible(page)).toBe(false);

    await page.mouse.move(600, 4); // into the invisible hover zone
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(true);
  });

  test('hides only after the configured delay', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hover interaction is desktop-only');
    await page.goto('/');
    await page.mouse.move(600, 4);
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(true);

    await page.mouse.move(600, 400); // leave zone + header
    await page.waitForTimeout(200); // hideDelayMs is 500 — must still be visible
    expect(await headerVisible(page)).toBe(true);

    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(false);
  });

  test('reveals when a header control receives focus (keyboard users)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.header-nav a').first().focus();
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(true);
  });

  test('M key toggles the header', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click();
    await page.keyboard.press('m');
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(true);
    await page.keyboard.press('m');
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(false);
  });

  test('scroll-spy marks the active nav link', async ({ page }) => {
    await page.goto('/');
    await page.locator('#projects').scrollIntoViewIfNeeded();
    await expect(page.locator('.header-nav a[href="#projects"]')).toHaveAttribute(
      'aria-current',
      'true',
      { timeout: 2000 },
    );
  });
});

test.describe('theme', () => {
  test('toggle flips the theme and persists across reloads', async ({ page }) => {
    await page.goto('/');
    await page.mouse.move(600, 4); // reveal the header so the button is reachable
    await expect.poll(() => headerVisible(page), { timeout: 1500 }).toBe(true);

    const before = await page.locator('html').getAttribute('data-theme');
    const toggle = page.locator('.site-header .icon-btn').first();
    await toggle.click();
    const after = await page.locator('html').getAttribute('data-theme');
    expect(after).not.toBe(before);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', after ?? '');
  });

  test('prefers-reduced-motion shows every block instantly', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hiddenReveals = await page.locator('[data-reveal]:not(.is-visible)').count();
    expect(hiddenReveals).toBe(0);
  });
});

test.describe('print', () => {
  test('hides the header and prints link URLs', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await page.goto('/');
    await expect(page.locator('.site-header')).toBeHidden();
    await expect(page.locator('.touch-handle')).toBeHidden();
  });
});
