/**
 * Temporary diagnostics (deleted after use): LCP entries, nav integrity,
 * axe violation nodes (light/dark/editor), header hide timeline.
 * Requires the preview server on :4173.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = 'http://localhost:4173';
const browser = await chromium.launch();

const nodeDump = (violations) =>
  JSON.stringify(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        html: n.html.slice(0, 160),
        summary: (n.failureSummary || '').replace(/\n/g, ' ').slice(0, 320),
      })),
    })),
    null,
    1,
  );

// --- 1. public page: LCP + sections + nav integrity + reveal states -------
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log(
  'LCP entries:',
  JSON.stringify(
    await page.evaluate(() =>
      performance.getEntriesByType('largest-contentful-paint').map((e) => ({
        size: Math.round(e.size),
        startTime: Math.round(e.startTime),
        el: e.element
          ? e.element.tagName +
            (e.element.id ? '#' + e.element.id : '') +
            '.' +
            (e.element.className || '')
          : null,
      })),
    ),
    null,
    1,
  ),
);
console.log('#publications-title:', await page.locator('#publications-title').count());
console.log(
  'nav:',
  JSON.stringify(
    await page.evaluate(() => {
      const links = [...document.querySelectorAll('.header-nav a')].map((a) =>
        a.getAttribute('href'),
      );
      const broken = links.filter(
        (h) => h && h.startsWith('#') && h !== '#admin' && !document.getElementById(h.slice(1)),
      );
      return { links, broken };
    }),
  ),
);
console.log(
  'reveal:',
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll('[data-reveal]')].slice(0, 5).map((el) => ({
        id: el.id || String(el.className).slice(0, 30),
        visible: el.classList.contains('is-visible'),
        opacity: getComputedStyle(el).opacity,
      })),
    ),
  ),
);

// --- 2. axe: light theme (default) ---------------------------------------
const light = await new AxeBuilder({ page }).analyze();
console.log(
  'AXE LIGHT serious/critical:',
  nodeDump(light.violations.filter((v) => ['serious', 'critical'].includes(v.impact))),
);
console.log(
  'AXE LIGHT other ids:',
  JSON.stringify(
    light.violations.filter((v) => !['serious', 'critical'].includes(v.impact)).map((v) => v.id),
  ),
);

// --- 3. axe: dark theme ---------------------------------------------------
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
});
const dark = await new AxeBuilder({ page }).analyze();
console.log(
  'AXE DARK serious/critical:',
  nodeDump(dark.violations.filter((v) => ['serious', 'critical'].includes(v.impact))),
);
await page.close();

// --- 4. header hide timeline (replicates the failing test) ----------------
const hp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await hp.goto(BASE + '/', { waitUntil: 'load' });
const t0 = Date.now();
const vis = () => hp.locator('.site-header').evaluate((el) => el.classList.contains('is-visible'));
const samples = [['load', await vis()]];
await hp.mouse.move(600, 4);
await hp.waitForTimeout(250);
samples.push(['hover+250ms', await vis()]);
await hp.mouse.move(600, 400); // leave
for (const at of [400, 700, 1000, 1500, 2400, 3000, 3600]) {
  const wait = t0 + at + 250 + 250 - Date.now(); // rough absolute schedule incl. the 500ms pre-steps
  if (wait > 0) await hp.waitForTimeout(wait);
  samples.push([`load+${Date.now() - t0}ms`, await vis()]);
}
console.log('HEADER timeline:', JSON.stringify(samples));
console.log('sessionStorage:', JSON.stringify(await hp.evaluate(() => ({ ...sessionStorage }))));
await hp.close();

// --- 5. axe: editor -------------------------------------------------------
const ep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await ep.goto(BASE + '/#admin', { waitUntil: 'load' });
await ep.waitForSelector('.admin-root', { timeout: 10000 });
await ep.waitForTimeout(700);
const ed = await new AxeBuilder({ page: ep }).include('.admin-root').analyze();
console.log(
  'AXE EDITOR serious/critical:',
  nodeDump(ed.violations.filter((v) => ['serious', 'critical'].includes(v.impact))),
);
console.log('dialogs open:', await ep.locator('dialog[open]').count());
await ep.close();

console.log('CONSOLE ERRORS:', JSON.stringify(errors));
await browser.close();
