/**
 * Temporary diagnostic (deleted after use): does this page ever emit
 * largest-contentful-paint entries? Buffered observer installed at
 * document_start, tested with and without the reveal animation.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const browser = await chromium.launch();

const INSTALL = `
  window.__lcp = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__lcp.push({
          size: Math.round(e.size),
          start: Math.round(e.startTime),
          el: e.element ? e.element.tagName + (e.element.id ? '#' + e.element.id : '') + '.' + String(e.element.className).slice(0, 40) : null,
        });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (err) { window.__lcp = ['observer error: ' + err]; }
`;

async function probe(label, { disableReveal = false, theme } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 823 } });
  await context.addInitScript(INSTALL);
  if (disableReveal) {
    await context.addInitScript(`
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '[data-reveal]{opacity:1 !important;transform:none !important;transition:none !important}';
        document.documentElement.append(s);
      }, { once: true });
    `);
  }
  const page = await context.newPage();
  if (theme === 'dark') {
    await page.emulateMedia({ colorScheme: 'dark' });
  }
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => ({
    lcp: window.__lcp,
    fcp: performance
      .getEntriesByType('paint')
      .map((p) => ({ name: p.name, start: Math.round(p.startTime) })),
    hero: (() => {
      const h = document.querySelector('.hero');
      if (!h) return null;
      const cs = getComputedStyle(h);
      return {
        opacity: cs.opacity,
        display: cs.display,
        visible: h.classList.contains('is-visible'),
      };
    })(),
  }));
  console.log(label, JSON.stringify(data));
  await context.close();
}

await probe('baseline           ');
await probe('reveal-disabled    ', { disableReveal: true });
await probe('dark               ', { theme: 'dark' });

await browser.close();
