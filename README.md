# CV Web

A minimalist, fast, accessible personal CV / portfolio site for a computer
engineering student — built with **Vite + vanilla TypeScript** (no UI
framework), driven entirely by **`public/content.json`**.

- **Everything editable without touching code** — edit the JSON directly, or
  use the built-in editor at `/#admin` (schema-driven forms, live preview,
  undo/redo, WCAG contrast checker, import/export).
- **Header taskbar hidden by default**, revealed from the top edge (hover /
  focus / touch pill), with shortcuts (`M`, `T`, `Esc`).
- **Never a blank page** — content falls back from `content.json` →
  last-known-good localStorage snapshot → built-in defaults, with a friendly
  `role="alert"` banner naming the broken fields.
- **WCAG 2.2 AA**, light/dark/system themes with no flash, print stylesheet
  for a one-page ATS-friendly CV, SEO/OG/JSON-LD/sitemap/robots/manifest
  generated from the same JSON.
- **No frameworks, no trackers** — content renders via `textContent` only
  (XSS-safe by construction); external links get `rel="noopener noreferrer"`;
  only `http(s)`/`mailto`/`tel` schemes allowed.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Open `http://localhost:5173/#admin` to edit content in the browser.

## Commands

| Command                    | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `npm run dev`              | Dev server with HMR                                      |
| `npm run build`            | Generate validator → validate content → typecheck → build |
| `npm run preview`          | Serve the production build locally                       |
| `npm run typecheck`        | `tsc --noEmit`                                           |
| `npm run lint`             | ESLint, zero warnings allowed                            |
| `npm run format:check`     | Prettier check                                           |
| `npm run validate:content` | Validate `public/content.json` against the schema        |
| `npm test`                 | Unit tests (Vitest + jsdom)                              |
| `npm run test:e2e`         | E2E + accessibility (Playwright + axe, desktop + mobile) |
| `npm run lighthouse`       | Lighthouse CI (≥ 95 on all four categories)              |
| `npm run check:budget`     | Public JS gzip budget (< 50 KB; editor chunk excluded)   |
| `npm run gen:assets`       | Regenerate OG image, PWA icons, placeholder CV PDF       |
| `npm run ci`               | The full local gate (what CI runs)                       |

## Editing your content

Two ways — see **[CONTENT-GUIDE.md](./CONTENT-GUIDE.md)** for the full
field-by-field reference:

1. **Editor**: visit `/#admin`, edit, press **Download content.json**, replace
   `public/content.json`, commit.
2. **Directly**: edit `public/content.json` and run `npm run validate:content`.

The contract between the two is `content.schema.json` — validation, the
generated form UI, and the tests all read it.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to
**GitHub Pages** on every push to `main` (enable it once: repo → Settings →
Pages → Source: *GitHub Actions*). `ci.yml` runs the full gate
(lint → typecheck → content validation → unit → build → budget → e2e →
Lighthouse) on every push and PR.

## Project structure

```
content.schema.json      single contract: validation, edit forms, tests
public/content.json      all site content (edit this)
scripts/                 validator codegen, SEO build plugin, budget gate, asset gen
src/
  main.ts                boot pipeline (fetch → migrate → validate → render) + #admin router
  schema/                typed Content + defaults
  render/                section renderers (one file each)
  components/            header (auto-hide), icons
  admin/                 edit mode (code-split, lazy-loaded on #admin)
  styles/                tokens, base, layout, components, header, print
  utils/                 dom, url (safe schemes), validate, migrate, storage, seo, theme
tests/unit/              Vitest
tests/e2e/               Playwright + axe
.github/workflows/       ci.yml, deploy.yml
```

## Architecture & docs

- **[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md)** — data flow, header
  design, edit-mode internals, security posture, testing strategy, budgets.
- **[CONTENT-GUIDE.md](./CONTENT-GUIDE.md)** — how to edit everything without
  touching code.
- **[PLAN.md](./PLAN.md)** — the original build plan (7 phases).

## Auto-sync

Changes made in OpenCode are automatically committed and pushed to GitHub.
