# Content Guide — how to edit everything without touching code

Everything on this site comes from **one file**: `public/content.json`.
There are two ways to edit it. Both end the same way: the file is committed and
the site rebuilds itself.

| Way                      | Best for                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| **Edit mode** (`#admin`) | Fast edits with live preview, undo, and a WCAG checker — no file browsing. |
| **Direct JSON editing**  | Bulk changes, version-control workflows, scripting.                        |

---

## 1. Edit mode (recommended)

1. Open the site and go to **`/#admin`** (or click _Edit_ in the header menu).
2. Edit fields on the **Content** tab — the page behind updates live.
3. Publish with whichever path you set up:

   - **Save to GitHub** (toolbar, or `Ctrl/⌘ + S`) — commits
     `public/content.json` straight to the repository; GitHub Actions then
     redeploys the site in ~1–2 minutes. One-time setup below.
   - **Download content.json** — the manual path: replace
     `public/content.json` in the repo and commit. CI verifies it, then
     GitHub Pages redeploys automatically.

> The editor keeps an autosaved **draft** in your browser (localStorage). It is
> only a working copy — the published site changes **only** after a save or a
> commit. Closing the tab with unsaved work asks for confirmation.

### Save to GitHub — one-time setup

1. Create a token: GitHub → Settings → **Developer settings** → Personal
   access tokens → **Fine-grained tokens**, scoped to this repository with
   **Contents: Read and write** (a classic token with the `public_repo`
   scope works too).
2. In the editor, open the **Help** tab → **GitHub publishing**.
3. _Owner_ and _Repository_ are pre-filled from the deployed URL — check
   _Branch_ (usually `main`) and _File path_ (`public/content.json`).
4. Paste the token (optionally tick _Remember token on this device_) and
   press **Test connection** — the status should read
   `Connected to <owner>/<repo> ✓`.
5. From now on, **Save to GitHub** (or `Ctrl/⌘ + S`) publishes. The
   _Draft_ badge flips to _Matches published_ and the footer shows the new
   date; the live site follows once Actions finishes (~1–2 minutes).

Notes:

- The token never leaves your browser except to `api.github.com`, and is
  kept in session storage only (localStorage when “remember” is ticked).
- **Forget saved token** clears it; the Download path keeps working with no
  token configured at all.

### Editor tabs

- **Content** — every data section (site, header, theme, CV, owner, education,
  skills, projects, experience, achievements, publications, references,
  contact, admin, footer) plus _Meta → Last updated_ (set automatically when
  you download).
- **Appearance** — accent colors for both themes, with a live **WCAG contrast
  table** (keep every row at “Pass”; text says Pass/Fail, not just color).
- **Sections** — reorder (drag or Move up/down buttons), enable/disable, and
  rename headings. This drives the header nav _and_ the page order.
- **Help** — shortcut reference and the one-time **GitHub publishing**
  setup (repository settings + token for the Save-to-GitHub button).

### Shortcuts

| Keys                 | Action                                                        |
| -------------------- | ------------------------------------------------------------- |
| `Ctrl/⌘ + Z`         | Undo                                                          |
| `Ctrl/⌘ + Shift + Z` | Redo                                                          |
| `Ctrl/⌘ + Y`         | Redo (Windows)                                                |
| `Ctrl/⌘ + S`         | Save to GitHub (Download when GitHub publishing isn’t set up) |
| `Esc`                | Close dialogs                                                 |
| `M` (public site)    | Toggle the header                                             |
| `T` (public site)    | Toggle light/dark theme                                       |

### Other buttons

- **Export backup** — download a dated backup of the current draft.
- **Import** — load a `content.json`; it is schema-validated first and rejected
  with a readable error if broken.
- **View changes** — structured diff of draft vs published file.
- **Reset draft** — throw away draft edits, return to the published content.
- **Reset published content** — delete the local draft and reload the site from
  the committed `content.json`.

---

## 2. Direct JSON editing

Edit `public/content.json` in any editor, then validate before committing:

```bash
npm run validate:content
```

If the file is invalid, the site **still renders** (using your browser's
last-known-good copy or built-in defaults) and shows a red banner listing
exactly which fields are broken — but CI will block the deploy until it is
fixed, so validate first.

---

## 3. Field guide (most-used)

### `site`

- `title` — browser tab, OG/Twitter title, JSON-LD.
- `description` — meta description (aim ≤ 160 characters).
- `canonicalUrl` — the production URL (used for OG + sitemap).
- `ogImage` — social preview image (`./assets/og-image.png` default).
- `lang` — `<html lang>` and locale.
- `analytics` — `provider`: `none` (default) | `plausible` | `umami`, plus
  `domain`/`siteId`. **No trackers load unless you opt in.**

### `owner` (hero + about)

`fullName`, `initials` (optional — derived from the name otherwise),
`headline`, `tagline`, `shortBio`, `longBio`, `location`, `availability`,
`photo` (`./assets/photo.jpg` — square crop, alt text is generated from your
name), `facts` (label/value rows), `now` (current-focus bullets).

### `sections`

The master list — order, heading text, and `enabled: false` to remove a
section from nav and page at once.

### `cv` / `header` / `theme`

- `cv.path` — PDF location (default `./assets/cv.pdf`), `cv.label` — button text.
- `header.mode` — `autohide` (default) | `always-visible` | `hidden-until-scroll-up`;
  `hideDelayMs`, `hoverZoneHeight`, `showEditLink`, `showOnLoadHint`,
  `discoverabilityHint`.
- `theme.default` — `system` | `light` | `dark` (first-visit default; the
  visitor's own choice wins afterwards).

### `contact`

- `email`, `socials` (platform: `github | linkedin | x | email | other`).
- `form` — leave `endpoint: ""` to hide the form (mailto is the fallback).
  To enable it, paste a **Formspree** (`https://formspree.io/f/XXXX`) or
  **Web3Forms** access URL; `honeypot` names the spam field. Status states
  (sending/success/error) and inline validation are built in.

### `appearance`

- `accent` (light theme) and `accentDark` (dark theme) — 6-digit hex.
  Check the **Appearance** tab contrast table after changing them.

### `admin`

- `passcodeSha256` — `null` (default, gate off) or a SHA-256 lowercase hex of
  your passcode. Generate one:
  ```bash
  powershell -Command "[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes('your-passphrase'))).Replace('-','').ToLower()"
  ```
  This is a casual lock, **not security** — anyone can read the site's source.

### `footer` / `meta`

- `footer.note`, `builtWithLabel` — footer text; `meta.lastUpdated` — shown in
  the footer and sitemap (editor sets it on download).

---

## 4. Images & assets

Put files in `public/assets/`:

| File                                    | Used for                                              |
| --------------------------------------- | ----------------------------------------------------- |
| `cv.pdf`                                | “Download CV” button (placeholder ships — replace it) |
| `photo.jpg`/`.png`                      | hero avatar (square; alt text = your name)            |
| `og-image.png`                          | link previews (regenerate: `npm run gen:assets`)      |
| `favicon-*.png`, `apple-touch-icon.png` | PWA/icon variants                                     |

Regenerate all derived art after changing the mark or name:

```bash
npm run gen:assets
```

---

## 5. What happens when something breaks

| Situation                   | Result                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `content.json` fails schema | Red `role="alert"` banner + field list; fallback content renders (site never blank); CI blocks the deploy. |
| File missing (bad deploy)   | Browser's last-known-good copy is used, banner explains it.                                                |
| Nothing available           | Built-in defaults render, banner explains it.                                                              |

Validate any time with `npm run validate:content`.

## 6. Keyboard access (public site)

- `Tab` reaches the header even while it is hidden (it reveals on focus).
- Skip link is the first tab stop; sections are focusable landmarks for nav.
- All interactions are operable without a mouse; the touch menu is a proper
  focus-trapped dialog.
