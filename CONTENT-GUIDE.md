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
3. Press **Download content.json** (or `Ctrl/⌘ + S`).
4. Replace `public/content.json` in the repo with the downloaded file and
   commit. CI verifies it, then GitHub Pages redeploys automatically.

> The editor keeps an autosaved **draft** in your browser (localStorage). It is
> only a working copy — the published site changes **only** when you commit the
> downloaded file. Closing the tab with unsaved work asks for confirmation.

### Editor tabs

- **Content** — every data section (site, header, theme, CV, owner, education,
  skills, projects, experience, achievements, publications, references,
  contact, admin, footer) plus _Meta → Last updated_ (set automatically when
  you download).
- **Appearance** — accent colors for both themes, with a live **WCAG contrast
  table** (keep every row at “Pass”; text says Pass/Fail, not just color).
- **Sections** — reorder (drag or Move up/down buttons), enable/disable, and
  rename headings. This drives the header nav _and_ the page order.
- **Help** — shortcut reference.

### Shortcuts

| Keys                 | Action                  |
| -------------------- | ----------------------- |
| `Ctrl/⌘ + Z`         | Undo                    |
| `Ctrl/⌘ + Shift + Z` | Redo                    |
| `Ctrl/⌘ + Y`         | Redo (Windows)          |
| `Ctrl/⌘ + S`         | Download content.json   |
| `Esc`                | Close dialogs           |
| `M` (public site)    | Toggle the header       |
| `T` (public site)    | Toggle light/dark theme |

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
