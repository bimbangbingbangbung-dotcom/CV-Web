/**
 * Touch-device flows (runs in the Pixel 5 project only):
 * the pill handle replaces hover, the menu is a modal dialog.
 */
import { test, expect } from '@playwright/test';

test.describe('touch menu', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only behavior');

  test('handle is visible and the hover zone is not', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.touch-handle')).toBeVisible();
    await expect(page.locator('.hover-zone')).toBeHidden();
  });

  test('handle opens the modal menu; backdrop tap closes it', async ({ page }) => {
    await page.goto('/');
    const handle = page.locator('.touch-handle');
    const overlay = page.locator('#site-menu');

    await handle.tap();
    await expect(overlay).toBeVisible();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');

    // Tap the dimmed backdrop (outside the panel).
    const box = (await overlay.boundingBox()) ?? { x: 0, y: 0, width: 100, height: 100 };
    await page.mouse.click(box.x + 8, box.y + 8);
    await expect(overlay).toBeHidden();
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
  });

  test('menu links navigate and close the menu', async ({ page }) => {
    await page.goto('/');
    await page.locator('.touch-handle').tap();
    await page.locator('#site-menu .menu-links a[href="#projects"]').click();
    await expect(page.locator('#site-menu')).toBeHidden();
    await expect(page).toHaveURL(/#projects$/);
  });
});
