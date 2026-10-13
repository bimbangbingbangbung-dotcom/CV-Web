# Build plan — CV Web (7 phases)

The original plan for this repository, kept as a record. Every phase is
**complete**; see [README.md](./README.md) for usage and
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md) for how the pieces fit
together.

## Goal

A minimalist, fast, accessible personal CV / portfolio site for a computer
engineering student with two core requirements:

1. **All information editable without touching code** — `public/content.json`
   plus a built-in editor at `/#admin`.
2. **Header taskbar hidden by default**, revealed from the top edge (hover /
   focus / touch), never `display: none` while on screen.

## Phases

| #   | Phase           | Scope                                                                     | Status |
| --- | --------------- | ------------------------------------------------------------------------- | ------ |
| 1   | **PLAN**        | Requirements, stack choice, architecture, this document                   | ✅     |
| 2   | **SCAFFOLD**    | Vite + strict TypeScript, ESLint/Prettier, Vitest, Playwright, LHCI, CI   | ✅     |
| 3   | **PUBLIC SITE** | Content pipeline, 11 section renderers, auto-hide header, all stylesheets | ✅     |
| 4   | **EDIT MODE**   | Schema-driven `/#admin` editor: forms, undo/redo, drafts, diff, export    | ✅     |
| 5   | **HARDENING**   | XSS/scheme/storage audit, WCAG fixes, LCP fix, fallback ladder review     | ✅     |
| 6   | **TESTS / CI**  | 43 unit tests, 58 E2E (desktop + mobile, axe), Lighthouse ≥ 95, Actions   | ✅     |
| 7   | **DOCS**        | README, CONTENT-GUIDE, SYSTEM-ARCHITECTURE                                | ✅     |

## Key decisions

- **Stack**: Vite + vanilla TypeScript, no UI framework — zero runtime
  dependencies, every byte of the public bundle stays well under budget.
- **Single contract**: `content.schema.json` drives validation, the generated
  editor forms and the tests. The browser validator is generated from the
  schema (Ajv standalone) at build time.
- **Font**: Geist (self-hosted, `font-display: swap`).
- **GitHub Pages**: Vite `base: './'` so a project-path URL works; canonical
  URL lives in `content.json`; robots/sitemap/manifest are emitted by
  `scripts/seo-plugin.ts` at build.
- **Rendering**: only `textContent` / `setAttribute` — XSS-safe by
  construction; scheme allow-list (`http(s)`, `mailto`, `tel`);
  `rel="noopener noreferrer"` on every external link.
- **Auto-hide header**: transform-only hiding, invisible hover zone, ~500 ms
  hide delay, focus reveal, `M`/`T`/`Esc` shortcuts, touch pill with
  focus-trapped overlay; `display: none` only in `@media print`.
- **Above-fold content never starts hidden**: the hero deliberately has no
  `data-reveal` — an opacity fade on the LCP element suppresses the browser's
  largest-contentful-paint entry (Lighthouse `NO_LCP`).
- **Budgets**: public JS < 50 KB gzipped (admin chunk excluded, it only loads
  on `/#admin`); Lighthouse ≥ 0.95 on performance, accessibility,
  best-practices and SEO.
- **npm audit**: 0 production vulnerabilities; 17 dev-only advisories all from
  `@lhci/cli` — `audit fix --force` would downgrade it to 0.1.0, deliberately
  not run.

## Verification (final state)

- Prettier clean · ESLint 0 problems · `tsc --noEmit` clean
- 68/68 unit tests · 44 passed / 18 skipped / 0 failed E2E
- Lighthouse ×3: 99 / 100 / 100 / 100, LCP ≈ 1.8 s (score-curve
  variance with the now-active web font; gate is ≥ 95)
- Public JS 9.64 KB gz / 50 KB budget

## Post-plan additions (2026-10-13)

1. **Font wiring bug (debug pass)** — the preload hint existed but no
   `@font-face` rule did anywhere in the project, so Geist was fetched and
   never used (exactly what Chromium's "preloaded … but not used" warning
   said) and all text silently fell back to the system UI font. Fixed with
   document-relative `@font-face` rules in `index.html`: they resolve in dev
   and on GitHub Pages project paths, and match the preload URL, so the font
   is still fetched once. Verified in-browser: face loads, and 400 vs 900
   weights render distinctly (variable font confirmed).
2. **Save to GitHub** — new primary toolbar action backed by
   `src/admin/github.ts`: commits `public/content.json` through the GitHub
   Contents API (GET blob sha → PUT). Owner/repo/branch/path settings live in
   `cvweb:github` (localStorage) and pre-fill from the deployed/canonical
   URL; the token lives in sessionStorage (localStorage only when "remember"
   is ticked) and is sent only to the constant `api.github.com` origin. The
   Help tab gained a **GitHub publishing** setup section with **Test
   connection**; `Ctrl/⌘ + S` routes to save when configured, download
   otherwise. On success `DraftStore.markSaved()` re-baselines the draft so
   the badge/pill/unload-guard clear. Covered by 24 new unit tests and 2 E2E
   tests (API mocked incl. CORS preflight); the real-API error path was
   verified manually (friendly 401 message, button re-enabled).
