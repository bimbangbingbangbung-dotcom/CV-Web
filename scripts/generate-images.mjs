/**
 * Generate raster assets from the SVG mark and content.json — OG image
 * (1200×630), PWA icons and the apple-touch icon. Uses the Playwright
 * Chromium already installed for E2E tests, so no extra dependencies.
 *
 *   node scripts/generate-images.mjs   (or: npm run gen:assets)
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const content = JSON.parse(await readFile('public/content.json', 'utf8'));
const svg = await readFile('public/favicon.svg', 'utf8');
await mkdir('public/assets', { recursive: true });

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const browser = await chromium.launch();
const page = await browser.newPage();

// --- PWA / favicon PNGs (from the SVG mark) -------------------------------
for (const [file, size, opaque] of [
  ['favicon-192.png', 192, false],
  ['favicon-512.png', 512, false],
  ['apple-touch-icon.png', 180, true], // iOS rejects transparency
]) {
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>*{margin:0}body{background:${opaque ? '#fbfbfa' : 'transparent'}}</style>${sized}`,
  );
  await page.screenshot({
    path: `public/assets/${file}`,
    omitBackground: !opaque,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}

// --- Open Graph image (1200 × 630) ---------------------------------------
const { owner, site, appearance } = content;
const ogHtml = `<!doctype html>
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #fbfbfa; color: #1b1d1c;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    padding: 84px; position: relative; display: flex; flex-direction: column; justify-content: center;
  }
  .rule { position: absolute; top: 64px; left: 84px; width: 72px; height: 8px; border-radius: 4px; background: ${appearance.accent}; }
  .name { font-size: 76px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.05; }
  .role { font-size: 30px; color: ${appearance.accent}; margin-top: 18px; font-weight: 550; }
  .tagline { font-size: 34px; color: #5b5f5d; margin-top: 30px; max-width: 940px; line-height: 1.35; }
  .foot { position: absolute; left: 84px; bottom: 56px; font-size: 22px; color: #8a8f8c; }
</style>
<div class="rule"></div>
<div class="name">${escapeHtml(owner.fullName)}</div>
<div class="role">${escapeHtml(owner.headline)}</div>
<div class="tagline">${escapeHtml(owner.tagline)}</div>
<div class="foot">${escapeHtml(site.title)}</div>`;

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHtml);
await page.screenshot({ path: 'public/assets/og-image.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });

await browser.close();
console.log('generate-images: og-image.png, favicon-192/512.png, apple-touch-icon.png → public/assets/');
void writeFile; // (kept for symmetry with future dynamic writes)
