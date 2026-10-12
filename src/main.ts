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
import { renderPage } from './render';
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
      h(
        'details',
        {},
        h('summary', { text: `Details (${errors.length})` }),
        list,
      ),
    ),
    h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Dismiss this message' } }, icon('close')),
  );
  banner.querySelector('button')?.addEventListener('click', () => banner.remove());

  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.insertAdjacentElement('afterend', banner);
  else document.body.prepend(banner);
}

/** Hash router for the built-in editor (#admin) — edit mode is code-split. */
let currentContent: Content = DEFAULT_CONTENT;

async function routeAdmin(): Promise<void> {
  if (location.hash !== '#admin') return;
  try {
    const { initAdmin } = await import('./admin/index');
    initAdmin(currentContent, { onPublished: boot });
  } catch (cause) {
    console.error('Edit mode failed to load:', cause);
    location.hash = '';
  }
}

/** Push content.json appearance values into the design-token indirection. */
function applyAppearance(content: Content): void {
  const root = document.documentElement;
  root.style.setProperty('--accent-user', content.appearance.accent);
  root.style.setProperty('--accent-dark-user', content.appearance.accentDark);
}

/** Render the public page and wire up the header. Reused when publishing. */
function boot(content: Content): void {
  applyAppearance(content);
  updateDocumentMeta(content);

  // content.theme.default only applies before the visitor picks their own.
  if (!hasStoredMode() && content.theme.default !== 'system') setMode(content.theme.default);

  const main = renderPage(content);
  initHeader(content, main);
  initReveal(main);
  currentContent = content;
  void routeAdmin();
}

async function start(): Promise<void> {
  initTheme();
  const result = await fetchPublishedContent();

  if (result.source === 'published') saveSnapshot(result.content);
  boot(result.content);

  if (result.errors.length > 0) {
    showErrorBanner(result.errors, result.source);
    console.error('Content validation errors:', result.errors);
  }
}

window.addEventListener('hashchange', () => void routeAdmin());

// Print: expand every collapsible so no detail is lost on paper.
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('details').forEach((details) => {
    details.open = true;
  });
});

void start();
