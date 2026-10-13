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
- 43/43 unit tests · 42 passed / 16 skipped / 0 failed E2E
- Lighthouse ×3: 100 / 100 / 100 / 100, LCP ≈ 1.5 s
- Public JS 9.63 KB gz / 50 KB budget
