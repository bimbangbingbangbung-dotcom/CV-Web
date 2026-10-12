/**
 * Temporary diagnostic (deleted after use): axe violation node details for
 * the public page (light/dark), touch overlay, and the #admin editor.
 * Requires the preview server on :4173.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = 'http://localhost:4173';
const browser = await chromium.launch();

const dump = (violations) =>
  JSON.stringify(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        html: n.html.slice(0, 160),
        summary: (n.failureSummary || '').replace(/\n/g, ' ').slice(0, 340),
      })),
    })),
    null,
    1,
  );

// --- 1. public page, light theme ------------------------------------------
const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx1.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const light = await new AxeBuilder({ page }).analyze();
console.log('AXE LIGHT serious/critical:', dump(light.violations.filter((v) => ['serious', 'critical'].includes(v.impact))));
console.log(
  'AXE LIGHT minor:',
  JSON.stringify(light.violations.filter((v) => !['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact})`)),
);

// --- 2. public page, dark theme -------------------------------------------
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
const dpage = await ctx2.newPage();
await dpage.goto(BASE + '/', { waitUntil: 'networkidle' });
const dark = await new AxeBuilder({ page: dpage }).analyze();
console.log(
  'AXE DARK serious/critical:',
  dump(dark.violations.filter((v) => ['serious', 'critical'].includes(v.impact))),
);

// --- 3. touch menu overlay (mobile) ---------------------------------------
const ctx3 = await browser.newContext({ viewport: { width: 412, height: 823 }, hasTouch: true, isMobile: true });
const mpage = await ctx3.newPage();
await mpage.goto(BASE + '/', { waitUntil: 'networkidle' });
await mpage.locator('.touch-handle').click();
await mpage.waitForSelector('#site-menu.is-open, #site-menu:not([hidden])');
const overlay = await new AxeBuilder({ page: mpage }).include('#site-menu').analyze();
console.log('AXE OVERLAY serious/critical:', dump(overlay.violations.filter((v) => ['serious', 'critical'].includes(v.impact))));

// --- 4. editor -------------------------------------------------------------
const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ep = await ctx4.newPage();
await ep.goto(BASE + '/#admin', { waitUntil: 'load' });
await ep.waitForSelector('.admin-root', { timeout: 10000 });
await ep.waitForTimeout(700);
console.log('dialogs open:', await ep.locator('dialog[open]').count());
const ed = await new AxeBuilder({ page: ep }).include('.admin-root').analyze();
console.log('AXE EDITOR serious/critical:', dump(ed.violations.filter((v) => ['serious', 'critical'].includes(v.impact))));
console.log(
  'AXE EDITOR minor:',
  JSON.stringify(ed.violations.filter((v) => !['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact})`)),
);

for (const c of [ctx1, ctx2, ctx3, ctx4]) await c.close();
await browser.close();
