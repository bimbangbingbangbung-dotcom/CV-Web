/**
 * Edit mode E2E: the full draft workflow against the real build —
 * open, edit, undo, export, import, reset, reorder, contrast, close.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

const content = JSON.parse(
  readFileSync(new URL('../../public/content.json', import.meta.url), 'utf8'),
) as { owner: { fullName: string } };

test.describe('edit mode', () => {
  test.skip(({ isMobile }) => isMobile, 'editor is desktop-first');

  test('opens at #admin with its tabs and toolbar', async ({ page }) => {
    await page.goto('/#admin');
    await expect(page.locator('.admin-root')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download content.json' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
  });

  test('field edits mark a draft, live-preview and undo restores', async ({ page }) => {
    await page.goto('/#admin');
    const input = page.locator('#f-owner-fullName');
    await expect(input).toHaveValue(content.owner.fullName);

    await input.fill('Test Person');
    await input.blur(); // commits (change event)

    await expect(page.locator('.admin-badge')).toContainText('Draft');
    await expect(page.locator('h1')).toHaveText('Test Person'); // live preview underneath

    await page.locator('button[aria-label="Undo (Ctrl+Z)"]').click();
    await expect(input).toHaveValue(content.owner.fullName);
    await expect(page.locator('h1')).toHaveText(content.owner.fullName);
    await expect(page.locator('.admin-badge')).toContainText('Matches published');
  });

  test('download exports a content.json file', async ({ page }) => {
    await page.goto('/#admin');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download content.json' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('content.json');
  });

  test('import rejects invalid JSON with a visible status', async ({ page }) => {
    await page.goto('/#admin');
    await page.locator('.admin-root input[type="file"]').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ this is not json'),
    });
    await expect(page.locator('.admin-status')).toContainText('Import failed');
  });

  test('reset draft asks for confirmation naming the action', async ({ page }) => {
    await page.goto('/#admin');
    const input = page.locator('#f-owner-fullName');
    await input.fill('Temporary Name');
    await input.blur();
    await expect(page.locator('.admin-badge')).toContainText('Draft');

    await page.locator('.admin-bar-actions').getByRole('button', { name: 'Reset draft' }).click();
    const dialog = page.locator('dialog.admin-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Reset draft to published content?');
    await dialog.getByRole('button', { name: 'Reset draft' }).click();

    await expect(page.locator('.admin-badge')).toContainText('Matches published');
    await expect(input).toHaveValue(content.owner.fullName);
  });

  test('sections tab reorders with the keyboard move buttons', async ({ page }) => {
    await page.goto('/#admin');
    await page.getByRole('tab', { name: 'Sections' }).click();

    const rows = page.locator('.section-row');
    const firstId = await rows.nth(0).locator('.section-id').textContent();
    const secondId = await rows.nth(1).locator('.section-id').textContent();

    await rows.nth(1).locator('button[aria-label^="Move"]').first().click(); // Move <second> up

    await expect(rows.nth(0).locator('.section-id')).toHaveText(secondId ?? '');
    await expect(rows.nth(1).locator('.section-id')).toHaveText(firstId ?? '');

    // The public preview nav follows the new order: the first nav link now
    // matches the heading of the section that moved to the top.
    const newFirstLabel = await page.locator(`#sec-label-${secondId ?? ''}`).inputValue();
    await expect(page.locator('.header-nav a').first()).toHaveText(newFirstLabel);
  });

  test('appearance tab shows the WCAG contrast table', async ({ page }) => {
    await page.goto('/#admin');
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.locator('.contrast-table tbody tr')).toHaveCount(8);
    await expect(page.locator('.contrast-table')).toContainText('Pass');
  });

  test('closing with unsaved changes shows the draft pill on the public page', async ({ page }) => {
    await page.goto('/#admin');
    const input = page.locator('#f-owner-fullName');
    await input.fill('Unsaved Person');
    await input.blur();

    await page.locator('button[aria-label="Close editor"]').click();
    await expect(page.locator('.admin-root')).toHaveCount(0);
    await expect(page.locator('.draft-pill')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Unsaved Person');

    // The pill returns to the editor.
    await page.locator('.draft-pill').click();
    await expect(page.locator('.admin-root')).toBeVisible();
  });

  test('help tab documents the shortcuts', async ({ page }) => {
    await page.goto('/#admin');
    await page.getByRole('tab', { name: 'Help' }).click();
    await expect(page.locator('.shortcut-list kbd').first()).toContainText('Ctrl');
  });

  test('axe: no serious or critical violations inside the editor', async ({ page }) => {
    await page.goto('/#admin');
    await expect(page.locator('.admin-root')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('.admin-root').analyze();
    const bad = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => `${v.id} (${v.impact}): ${v.help}`)).toEqual([]);
  });
});
