# System Architecture — CV Web

> Supersedes the original Next.js draft. The shipped system is **Vite + vanilla
> TypeScript, no UI framework** — chosen for a content-driven single page where
> the framework runtime would dominate the payload (see “Stack rationale”).

## 1. Goals that shape the architecture

1. **All information editable without touching code** — everything renders from
   `public/content.json`, validated against `content.schema.json`.
2. **The header taskbar is hidden by default** and revealed from the top edge.
3. **Never show a blank page** — layered content fallbacks + friendly errors.
4. **WCAG 2.2 AA, Lighthouse ≥ 95, public JS < 50 KB gzipped.**
5. **XSS structurally impossible** — content only ever lands in `textContent` /
   `setAttribute`, URL schemes are allow-listed.

## 2. Stack rationale

| Choice                    | Why                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Vite                      | instant dev server, Rollup production build, native code-splitting for `#admin`, HTML transform for SEO.   |
| Vanilla TS                | the UI is a single page rendered from JSON; React/Vue would add ~40 KB gz for zero interaction complexity. |
| Ajv (standalone)          | schema is the single contract; the validator is compiled to plain JS at build time and tree-shaken.        |
| CSS custom props          | appearance (accent, radii, theme) becomes data-driven at runtime; no CSS-in-JS cost.                       |
| Vitest + Playwright + axe | same Vite pipeline for unit tests; e2e against the real build; axe gates accessibility.                    |
| Geist + JetBrains Mono    | self-hosted variable fonts, no third-party font CDN, no layout shift.                                      |

## 3. Data flow

```
public/content.json ─┐
                     ├─ fetch (cache: no-cache) → migrate() → validateContent()
localStorage snapshot ┘                                │            │
   (last known-good)                            not an object   invalid
                     │                                 │            │
                     ▼                                 ▼            ▼
              renderPage(content)            ──► error banner + fallback ladder
                     │
        applyAppearance → updateDocumentMeta → initHeader → initReveal → applyRoute
```

**Resilience ladder** (in `src/main.ts`):

1. published `content.json` — also written to localStorage as a snapshot;
2. last known-good snapshot (`cvweb:lastValid`);
3. built-in `DEFAULT_CONTENT` from the schema module.

Any failure past step 1 renders a dismissible `role="alert"` banner listing
each broken field (`path — message`), so content problems are diagnosable
without a terminal. The page never renders blank.

**Routing** is hash-only and in-page: `#admin` opens the editor, and
`#project-<slug>` swaps the section list for that project's detail page
(cover, full description, problem/solution/result story, gallery with a
lightbox; header and footer stay visible). Cards link to `#project-<slug>`
(slugs come from the titles via `src/utils/slug.ts`, deduped left-to-right),
Back/Forward work through `hashchange`, leaving the detail view restores the
list's scroll position, and an unknown slug rewrites itself back to
`#projects` — no server involvement, so the static host stays a dumb file
server.

## 4. Rendering rules (security posture)

- `src/utils/dom.ts`'s `h()` is the **only** element factory. It sets
  `textContent`, never `innerHTML` (documented at the top of the file).
- `safeExternalUrl()` allows `http(s)://`, `mailto:`, `tel:` only;
  `safeAssetPath()` allows `/…`, `./…`, `https://…` only.
- External links get `target="_blank" rel="noopener noreferrer"` automatically
  (`externalAnchor()`).
- This makes XSS structurally impossible even if `content.json` is hostile.

## 5. File map

```
content.schema.json          contract: validation, edit-mode forms, tests
public/content.json          the single source of truth (all site content)
scripts/
  generate-validator.mjs     compiles schema → src/utils/content-validator.generated.ts
  validate-content.mjs       node-side content gate (part of `npm run build`)
  seo-plugin.ts              build-time <head> tags, sitemap, robots, manifest
  check-budget.mjs           public-JS gzip budget gate (admin chunk excluded)
  generate-images.mjs        OG image + PWA icons (renders the SVG mark)
  make-cv-placeholder.mjs    valid placeholder PDF for the CV button
src/
  main.ts                    boot pipeline + hash router (#admin, #project-<slug>)
  schema/{types,defaults}.ts typed Content + last-resort fallback
  utils/                     dom, url, validate, migrate, storage, seo,
                             reveal, theme, slug
  render/                    page orchestrator + one file per section
                             (incl. project-view.ts: the #project-<slug> page)
  components/header.ts       auto-hide header, touch menu, shortcuts, scroll-spy
  components/icons.ts        inline SVG path data (Simple Icons CC0 + glyphs)
  styles/                    tokens, base, layout, components, header, print
  admin/                     edit mode (code-split chunk, lazy on #admin)
    state.ts                 DraftStore: history, dirty flag, autosave
    widgets.ts               schema-driven form engine (recursion over $ref)
    panel.ts                 toolbar/tabs/diff/import/export/publish
                             + image widgets (photo / cover / gallery)
    github.ts                Save-to-GitHub: Contents API commit + token storage
    image.ts                 image upload: validate (≤3 MB), EXIF-fix, downscale, re-encode
    crop.ts                  photo cropper: cover/pan/zoom geometry + adjustment dialog
    contrast.ts, diff.ts     WCAG checker + structured draft diff
  content-validator.generated.ts   build artifact (git-ignored from lint)
tests/unit/*.test.ts         Vitest (119 tests)
tests/e2e/*.spec.ts          Playwright (desktop + Pixel 5) + axe
.github/workflows/ci.yml     lint → typecheck → test → build → e2e → lighthouse
.github/workflows/deploy.yml build → GitHub Pages
```

## 6. The auto-hide header

- **Hidden by default with `transform: translateY(-101%)` only** — never
  `display:none`/`visibility:hidden`, so links stay in the tab order and
  assistive tech can reach them at all times.
- Desktop: an invisible `.hover-zone` strip (height from `header.hoverZoneHeight`)
  reveals it; hide is delayed (`header.hideDelayMs`) to avoid flicker.
- `:focus-within` reveals it for keyboard users; focusing a nav link works even
  while hidden.
- Touch / narrow viewports: a pill `.touch-handle` opens a full-screen modal menu
  (`role="dialog"`, focus trap, Escape/backdrop close, focus restore).
- Modes from `content.json`: `autohide` (default), `always-visible`,
  `hidden-until-scroll-up` (rAF-throttled passive scroll listener).
- Shortcuts: `M` toggles the header, `T` toggles theme (overridable via
  `theme.toggleShortcut`), `Esc` closes menu/hides header; ignored while typing.
- First-visit hint reveals the header once per session; optional `edge-hint`
  line fades on first interaction; scroll-spy sets `aria-current` (weight +
  underline + attribute — never color alone).
- `initHeader()` is re-entrant: edit-mode previews re-render the page, so each
  call tears down the previous instance (elements, listeners, observers).

## 7. Edit mode (`#admin`)

- **Code-split**: dynamically imported; excluded from the public budget by the
  named `admin-*` chunk.
- **Schema-driven**: `content.schema.json` is imported into the admin chunk and
  recursively turned into form controls (objects → field groups, enum → select,
  color pattern → picker, arrays → reorderable editors with drag + keyboard
  buttons). Nullable `type: ["string","null"]` fields unwrap to their concrete
  type (they used to render no control at all), and a `customControls` map on
  the form context lets one dotted path opt out of the generic widget —
  `owner.photo`, `projects.N.image` and `projects.N.gallery` use it for
  **image upload widgets** (file picker → `image.ts` validates up to 3 MB and
  decodes EXIF-corrected pixels → for the avatar only, `crop.ts` opens the
  adjust dialog (drag / zoom / arrow-key pan, 3:4 like the hero) and renders
  the crop → `image.ts` downscales/re-encodes to a ≤`admin.imageMaxKB` JPEG
  data URL → live preview; card covers and gallery pictures skip the cropper
  — any aspect works because CSS crops the card). The gallery widget renders
  one row per picture (thumbnail, path/URL field, upload, keyboard
  reorder/remove) plus an _Add picture_ picker.
- **DraftStore**: in-memory draft + localStorage autosave (`cvweb:draft`) with a
  50-step undo/redo stack, dirty flag, and “resume draft?” prompt. localStorage
  is _never_ the published source — it only holds working copies and the
  last-known-good snapshot.
- **Publish = save or download**: two paths out of the editor.
  - **Save to GitHub** (`src/admin/github.ts`, toolbar button): commits
    `public/content.json` through the GitHub Contents API (GET the blob sha →
    PUT). Every draft field still holding an uploaded data URL
    (`owner.photo`, `projects.N.image`, `projects.N.gallery[i]`) is committed
    **first** as a real image file — `assets/photo.jpg`,
    `assets/projects/project-N-cover.jpg`,
    `assets/projects/project-N-picture-M.jpg` — and rewritten to its plain
    `./assets/…` path before content.json is serialized — the published JSON
    stays small, a failed content commit is safe to retry, and Download (the
    token-less path) simply keeps the data URLs inline so the file is
    self-contained.
    Owner/repo/branch/path settings live in localStorage
    (`cvweb:github`) and pre-fill from the deployed/canonical URL; the token
    lives in sessionStorage (localStorage only when “remember on this device”
    is ticked) and is sent **only** to the constant `https://api.github.com`
    origin — host and path parts are validated/encoded before any request.
    After a successful commit, `DraftStore.markSaved()` re-baselines the
    draft (badge flips to “Matches published”; draft pill and `beforeunload`
    guard clear), a transient `.save-toast` confirms the commit on the public
    page, and the panel closes itself — landing the owner on the home page
    where the live preview already shows the change. The deploy workflow then
    rebuilds the site. Failures map to friendly status text (401 bad token,
    403 scope/rate limit, 404 wrong repo/branch/path, 422 concurrent-edit
    race, network) and keep the editor open.
  - **Download content.json** (Help → GitHub publishing — the manual
    alternative; also `Ctrl/⌘+S` when GitHub publishing isn’t configured):
    writes the file; the owner drops it at `public/content.json` and commits.
- **Live preview**: every commit re-renders the public page underneath
  (focus-preserving form rebuilds); a floating “Draft in editor” pill and a
  `beforeunload` guard track unsaved work.
- Other controls: import (validates before accepting), export backup, diff view
  (path-based structured diff), reset draft / reset published (each behind a
  confirmation naming the exact object), sections tab (order, enable/disable,
  rename), appearance tab (accent pickers + 8-pair WCAG contrast table),
  help tab (shortcuts + workflow).
- Optional passcode gate (`admin.passcodeSha256`) — a convenience lock, not
  security (documented as such; a static site cannot keep secrets).

## 8. Theme

- Pre-paint inline script in `index.html` applies the stored/system theme
  before first paint (no flash).
- `src/utils/theme.ts` owns mode state; `applyTheme` dispatches
  `cvweb:themechange` so header/editor buttons stay in sync.
- Accent color runs through an indirection: `--accent: var(--accent-user)` /
  dark `--accent-dark-user`, set at runtime from `content.json`
  (`applyAppearance()`), with hover shades derived via `color-mix()`.
- The editor's contrast checker validates the owner's accent against the fixed
  token pairs on both themes.

## 9. SEO / discovery

- **Runtime** (`src/utils/seo.ts`): title, description, canonical, OG/Twitter,
  JSON-LD `Person`, theme-color, optional analytics (plausible/umami, default
  `none`) — updates live in edit mode.
- **Build time** (`scripts/seo-plugin.ts`): the same values injected into
  `dist/index.html` for crawlers that don't run JS, plus `sitemap.xml`,
  `robots.txt`, `manifest.webmanifest` — all generated from `content.json`
  (one source of truth); dev server serves the three files as middleware.

## 10. Performance & budgets

- Public JS budget: **50 KB gz** enforced by `scripts/check-budget.mjs`
  (excludes the `admin-*` chunk) in CI and before every deploy.
- CSS is split per import; fonts self-hosted with `font-display: swap` and a
  preload; all animation is transform/opacity only; `prefers-reduced-motion`
  collapses transitions.
- Print stylesheet targets a one-column ATS-friendly CV (chrome hidden, URLs
  printed after external links, `break-inside: avoid` on entries).

## 11. Testing strategy

| Layer  | Tool                        | What it gates                                                                                                                                                |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit   | Vitest (jsdom, 119 tests)   | validation, migrations, URL safety, contrast math, DraftStore, DOM/XSS, content-schema sync, form engine, photo data URLs, crop geometry, GitHub commit flow, route slugs, project detail rendering + lightbox |
| E2E    | Playwright (desktop+mobile) | content rendering, header contract, theme, touch menu, print, editor flows                                                                                   |
| A11y   | axe-core in Playwright      | serious/critical violations on public page (both themes), overlay, editor                                                                                    |
| Budget | check-budget.mjs            | public JS gzip budget                                                                                                                                        |
| Perf   | Lighthouse CI (≥ 95 ×4)     | performance, accessibility, best-practices, seo                                                                                                              |

## 12. CI/CD

- `ci.yml` — full gate on push/PR: lint → typecheck → validate content → unit →
  build → budget → Playwright → Lighthouse.
- `deploy.yml` — same verification subset, then `upload-pages-artifact` →
  `deploy-pages` (GitHub Pages, `base: './'` so the project subpath works).

## 13. Extension points

- **Schema evolution**: bump `SCHEMA_VERSION`, add a numbered entry to
  `MIGRATIONS` in `src/utils/migrate.ts`; old exports upgrade on load.
- **Sections**: add an id to the schema enum, a renderer in `src/render/sections/`,
  and a `SECTION_RENDERERS` entry — the form editor follows the schema
  automatically.
- **Analytics**: `site.analytics.provider: plausible | umami` (default `none`,
  no trackers unless opted in).
