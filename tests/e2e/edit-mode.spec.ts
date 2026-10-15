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

/**1×1 PNG — a valid, tiny photo for the upload tests. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('edit mode', () => {
  test.skip(({ isMobile }) => isMobile, 'editor is desktop-first');

  test('opens at #admin with its tabs and toolbar', async ({ page }) => {
    await page.goto('/#admin');
    await expect(page.locator('.admin-root')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to GitHub' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    // Download lives in Help → GitHub publishing (the manual alternative), not the toolbar.
    await expect(
      page.locator('.admin-bar').getByRole('button', { name: 'Download content.json' }),
    ).toHaveCount(0);
  });

  test('Edit links are invisible but still open the editor', async ({ page }) => {
    await page.goto('/');
    const edit = page.locator('.site-header .header-edit');
    await expect(edit).toHaveCount(1);
    await expect(edit).toHaveCSS('opacity', '0'); // invisible…
    await expect(edit).toHaveAttribute('href', '#admin'); // …but it still knows where to go

    // The footer carries the same affordance, equally invisible.
    const footerEdit = page.locator('.footer-edit');
    await expect(footerEdit).toHaveCount(1);
    await expect(footerEdit).toHaveCSS('opacity', '0');
    await expect(footerEdit).toHaveAttribute('href', '#admin');

    await page.mouse.move(600, 4); // reveal the auto-hidden header
    await edit.click();
    await expect(page.locator('.admin-root')).toBeVisible();
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
    await page.getByRole('tab', { name: 'Help' }).click(); // manual alternative lives here
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download content.json' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('content.json');
  });

  test('Save to GitHub without setup routes to the Help configuration', async ({ page }) => {
    await page.goto('/#admin');
    await page.getByRole('button', { name: 'Save to GitHub' }).click();
    await expect(page.locator('.admin-status')).toContainText('GitHub publishing needs setup');
    await expect(page.getByRole('tab', { name: 'Help' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#f-gh-owner')).toBeVisible();
    await expect(page.locator('#f-gh-token')).toBeVisible();
  });

  test('Save to GitHub commits content.json through the API', async ({ page }) => {
    const puts: string[] = [];
    let authHeader = '';
    await page.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (request.method() === 'OPTIONS') {
        // CORS preflight for the authenticated PUT.
        await route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers':
              'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
          },
        });
        return;
      }
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({ message: 'Not Found' }),
        });
        return;
      }
      authHeader = request.headers()['authorization'] ?? '';
      puts.push(request.postData() ?? '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify({ commit: { sha: 'c0ffee' } }),
      });
    });

    await page.goto('/#admin');

    // A real edit → the badge must start dirty, then clear after the save.
    const input = page.locator('#f-owner-fullName');
    await input.fill('Saved Person');
    await input.blur();
    await expect(page.locator('.admin-badge')).toContainText('Draft');

    // Configure publishing in Help (settings persist on each change event).
    await page.getByRole('tab', { name: 'Help' }).click();
    await page.locator('#f-gh-owner').fill('octo-cat');
    await page.locator('#f-gh-repo').fill('CV-Web');
    await page.locator('#f-gh-branch').fill('main');
    await page.locator('#f-gh-path').fill('public/content.json');
    await page.locator('#f-gh-token').fill('ghp_test_token');
    await page.locator('#f-gh-token').blur();

    await page.getByRole('button', { name: 'Save to GitHub' }).click();
    // Success closes the editor and lands on the home page, with a toast
    // confirming the commit (the live preview already showed the changes).
    await expect(page.locator('.save-toast')).toContainText('Saved to octo-cat/CV-Web');
    await expect(page.locator('.admin-root')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveText('Saved Person');
    await expect(page).toHaveURL(/\/#?$/); // back on the home page, editor gone

    // The commit carried the edit and the configured target + credentials.
    expect(puts).toHaveLength(1);
    const committed = JSON.parse(puts[0] ?? '{}') as Record<string, unknown>;
    expect(committed.branch).toBe('main');
    const decoded = Buffer.from(String(committed.content), 'base64').toString('utf8');
    expect(JSON.parse(decoded).owner.fullName).toBe('Saved Person');
    expect(authHeader).toBe('Bearer ghp_test_token');
  });

  test('photo upload live-previews and commits the image to the repo', async ({ page }) => {
    const puts: Array<{ path: string; body: Record<string, unknown> }> = [];
    let authHeader = '';
    await page.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers':
              'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
          },
        });
        return;
      }
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({ message: 'Not Found' }),
        });
        return;
      }
      authHeader = request.headers()['authorization'] ?? '';
      puts.push({
        path: new URL(request.url()).pathname,
        body: JSON.parse(request.postData() ?? '{}') as Record<string, unknown>,
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify({ commit: { sha: 'c0ffee' } }),
      });
    });

    await page.goto('/#admin');

    // Pick a (tiny, valid) PNG — the editor opens the cropper for it.
    await page.locator('#f-owner-photo-file').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // The adjustment step comes first: drag to reposition (the photo starts
    // centred) and slide to zoom, then apply the crop.
    const cropDialog = page.locator('dialog.crop-dialog');
    await expect(cropDialog).toBeVisible();
    await expect(cropDialog.locator('.crop-canvas')).toBeVisible();
    await cropDialog.locator('input[type="range"]').fill('2');
    await expect(cropDialog.locator('.crop-zoom-value')).toHaveText('200%');
    await cropDialog.getByRole('button', { name: 'Apply photo' }).click();
    await expect(cropDialog).toHaveCount(0);

    // The field, the badge and the page behind the editor all update.
    await expect(page.locator('#f-owner-photo')).toHaveValue(/^data:image\/jpeg;base64,/);
    await expect(page.locator('.admin-badge')).toContainText('Draft');
    await expect(page.locator('.admin-status')).toContainText('Photo updated');
    await expect(page.locator('.hero .avatar')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);

    // Configure publishing in Help (same as the plain content commit test).
    await page.getByRole('tab', { name: 'Help' }).click();
    await page.locator('#f-gh-owner').fill('octo-cat');
    await page.locator('#f-gh-repo').fill('CV-Web');
    await page.locator('#f-gh-branch').fill('main');
    await page.locator('#f-gh-path').fill('public/content.json');
    await page.locator('#f-gh-token').fill('ghp_test_token');
    await page.locator('#f-gh-token').blur();

    await page.getByRole('button', { name: 'Save to GitHub' }).click();
    await expect(page.locator('.save-toast')).toContainText('Saved to octo-cat/CV-Web');
    await expect(page.locator('.save-toast')).toContainText('public/assets/photo.jpg');
    await expect(page.locator('.admin-root')).toHaveCount(0);

    // Two commits, image FIRST so content.json never points at a missing file.
    expect(puts.map((p) => p.path)).toEqual([
      '/repos/octo-cat/CV-Web/contents/public/assets/photo.jpg',
      '/repos/octo-cat/CV-Web/contents/public/content.json',
    ]);
    expect(authHeader).toBe('Bearer ghp_test_token');
    const imageBytes = Buffer.from(String(puts[0]?.body['content']), 'base64');
    expect(imageBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic
    const committedContent = Buffer.from(String(puts[1]?.body['content']), 'base64').toString(
      'utf8',
    );
    const committed = JSON.parse(committedContent) as { owner: { photo: string } };
    expect(committed.owner.photo).toBe('./assets/photo.jpg');

    // Back home, the hero points at the committed file (live again after redeploy).
    await expect(page.locator('.hero .avatar')).toHaveAttribute('src', './assets/photo.jpg');
  });

  test('import rejects invalid JSON with a visible status', async ({ page }) => {
    await page.goto('/#admin');
    await page.locator('#admin-import-input').setInputFiles({
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
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id} (${v.impact}): ${v.help}`)).toEqual([]);
  });
});
