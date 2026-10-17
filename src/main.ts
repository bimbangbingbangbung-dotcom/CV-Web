/**
 * Boot pipeline — the only file that ties everything together.
 *
 *   fetch public/content.json → migrate → validate → (render | fallback)
 *
 * Resilience ladder (the site must NEVER show a blank page):
 *   1. published content.json
 *   2. last known-good snapshot from localStorage
 *   3. built-in defaults
 * Whatever fails after step 1 renders the friendly error banner with the
 * exact broken fields, so content problems are diagnosable without a
 * terminal.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/header.css';
import './styles/print.css';

import type { Content } from './schema/types';
import { DEFAULT_CONTENT } from './schema/defaults';
import { h } from './utils/dom';
import { migrate } from './utils/migrate';
import { validateContent, type FieldError } from './utils/validate';
import { saveSnapshot, loadSnapshot } from './utils/storage';
import { updateDocumentMeta } from './utils/seo';
import { initTheme, hasStoredMode, setMode } from './utils/theme';
import { projectSlugs } from './utils/slug';
import { renderPage } from './render';
import {
  PROJECT_ROUTE_PREFIX,
  clearProjectView,
  fillProjectView,
} from './render/sections/project-view';
import { initHeader } from './components/header';
import { initReveal } from './utils/reveal';
import { icon } from './components/icons';

type ContentSource = 'published' | 'snapshot' | 'defaults';

interface LoadResult {
  content: Content;
  errors: FieldError[];
  source: ContentSource;
}

async function fetchPublishedContent(): Promise<LoadResult> {
  let raw: unknown;
  try {
    const response = await fetch('./content.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  } catch (cause) {
    return {
      content: DEFAULT_CONTENT,
      source: 'defaults',
      errors: [{ path: '/content.json', message: `could not be loaded (${String(cause)})` }],
    };
  }

  const migration = migrate(raw);
  if (!migration.ok) {
    return fallbackAfter(
      migration.reason === 'newer-than-site'
        ? { path: '/meta/schemaVersion', message: 'was written by a newer version of this site' }
        : { path: '/content.json', message: 'is not a valid content object' },
    );
  }

  const result = validateContent(migration.data);
  if (!result.ok) return fallbackAfter(...result.errors);
  return { content: result.content, errors: [], source: 'published' };
}

/** Try the localStorage snapshot; fall back to built-in defaults. */
function fallbackAfter(...errors: FieldError[]): LoadResult {
  const snapshot = loadSnapshot();
  if (snapshot) {
    const migrated = migrate(snapshot);
    if (migrated.ok) {
      const result = validateContent(migrated.data);
      if (result.ok) return { content: result.content, errors, source: 'snapshot' };
    }
  }
  return { content: DEFAULT_CONTENT, errors, source: 'defaults' };
}

/** Friendly, dismissible banner listing exactly which fields are broken. */
function showErrorBanner(errors: FieldError[], source: ContentSource): void {
  const sourceNote =
    source === 'snapshot'
      ? 'Showing your last known-good content instead — fix content.json to update the site.'
      : source === 'defaults'
        ? 'Showing built-in fallback content — the site is only partially populated.'
        : '';

  const list = h(
    'ul',
    { class: 'error-list' },
    ...errors.map((error) => h('li', { text: `${error.path} — ${error.message}` })),
  );

  const banner = h(
    'div',
    { class: 'error-banner', attrs: { role: 'alert' } },
    icon('alert'),
    h(
      'div',
      { class: 'error-body' },
      h('strong', { text: 'Content problem detected' }),
      sourceNote ? h('p', { text: sourceNote }) : null,
      h('details', {}, h('summary', { text: `Details (${errors.length})` }), list),
    ),
    h(
      'button',
      { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Dismiss this message' } },
      icon('close'),
    ),
  );
  banner.querySelector('button')?.addEventListener('click', () => banner.remove());

  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.insertAdjacentElement('afterend', banner);
  else document.body.prepend(banner);
}

/** Hash router for the built-in editor (#admin) — edit mode is code-split. */
let currentContent: Content = DEFAULT_CONTENT;
/** Immutable published baseline (never updated by editor previews). */
let publishedContent: Content = DEFAULT_CONTENT;
let adminOpen = false;
let adminDispose: (() => void) | null = null;

async function routeAdmin(): Promise<void> {
  if (adminOpen) {
    // Hash moved away externally (browser Back): close the editor shell.
    if (location.hash !== '#admin') {
      adminDispose?.();
      adminDispose = null;
      adminOpen = false;
    }
    return;
  }
  if (location.hash !== '#admin') return;
  try {
    const { initAdmin } = await import('./admin/index');
    adminOpen = true;
    adminDispose = initAdmin(publishedContent, {
      // Re-opening the editor restores the session's in-progress draft.
      initialDraft: currentContent,
      // The public page live-previews the draft from inside the editor.
      onPreview: (draft) => {
        currentContent = draft;
        boot(draft, { instant: true });
      },
      onClose: () => {
        adminDispose = null;
        adminOpen = false;
        if (location.hash === '#admin') location.hash = '';
      },
    });
  } catch (cause) {
    console.error('Edit mode failed to load:', cause);
    adminOpen = false;
    location.hash = '';
  }
}

/** Push content.json appearance values into the design-token indirection. */
function applyAppearance(content: Content): void {
  const root = document.documentElement;
  root.style.setProperty('--accent-user', content.appearance.accent);
  root.style.setProperty('--accent-dark-user', content.appearance.accentDark);
}

// --- Project detail route (#project-<slug>) ---------------------------------
// The detail page is a view of the same document with its own URL: entering
// hides every other block (body.route-project), leaving restores them and
// puts the visitor back where they came from (section anchor, or the exact
// scroll position when the previous hash was empty).
let detailActive = false;
let detailReturnScroll: number | null = null;

function applyRoute(options: { initial?: boolean } = {}): void {
  const view = document.getElementById('project-view');
  const wasDetail = detailActive;
  detailActive = false;
  document.body.classList.remove('route-project');
  if (view) {
    view.hidden = true;
    clearProjectView(view);
  }

  const hash = location.hash;
  let slug: string | null = null;
  if (hash.startsWith(PROJECT_ROUTE_PREFIX)) {
    try {
      slug = decodeURIComponent(hash.slice(PROJECT_ROUTE_PREFIX.length));
    } catch {
      slug = ''; // malformed percent-encoding → treated as an unknown slug
    }
  }

  if (slug !== null) {
    const index = projectSlugs(currentContent.projects).indexOf(slug);
    const project = index === -1 ? undefined : currentContent.projects[index];
    if (view && project) {
      fillProjectView(view, project);
      view.hidden = false;
      document.body.classList.add('route-project');
      detailActive = true;
      document.title = `${project.title} — ${currentContent.site.title}`;
      if (!wasDetail) detailReturnScroll = window.scrollY; // where Back lands
      window.scrollTo(0, 0);
      if (!options.initial) view.focus({ preventScroll: true });
      return;
    }
    // Unknown slug (stale link after a rename) — soft-land on the project list.
    document.getElementById('projects')?.scrollIntoView();
    if (wasDetail) document.title = currentContent.site.title;
    return;
  }

  if (!wasDetail) return;

  // Left the project page: restore the document title and the right place.
  document.title = currentContent.site.title;
  const sectionId = hash.startsWith('#') && hash.length > 1 ? hash.slice(1) : '';
  const target = sectionId ? document.getElementById(sectionId) : null;
  if (target) {
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  } else if (!sectionId && detailReturnScroll !== null) {
    window.scrollTo(0, detailReturnScroll);
  }
}

/** Render the public page and wire up the header. Reused when publishing. */
function boot(content: Content, options: { instant?: boolean } = {}): void {
  applyAppearance(content);
  updateDocumentMeta(content);

  // content.theme.default only applies before the visitor picks their own.
  if (!hasStoredMode() && content.theme.default !== 'system') setMode(content.theme.default);

  const main = renderPage(content);
  initHeader(content);
  initReveal(main, { instant: options.instant === true });
  currentContent = content;
  void routeAdmin();
  // Re-apply the current route: on boot this activates a deep-linked
  // #project-<slug>, and after an edit-mode preview it re-fills the page.
  applyRoute({ initial: true });
}

async function start(): Promise<void> {
  initTheme();
  const result = await fetchPublishedContent();

  if (result.source === 'published') saveSnapshot(result.content);
  publishedContent = result.content;
  boot(result.content);

  if (result.errors.length > 0) {
    showErrorBanner(result.errors, result.source);
    console.error('Content validation errors:', result.errors);
  }
}

window.addEventListener('hashchange', () => {
  void routeAdmin();
  applyRoute();
});

// Print: expand every collapsible so no detail is lost on paper.
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('details').forEach((details) => {
    details.open = true;
  });
});

void start();
