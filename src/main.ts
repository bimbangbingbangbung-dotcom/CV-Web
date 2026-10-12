/**
 * Application entry point.
 *
 * Boot order matters: theme is already applied by the inline script in
 * index.html (before paint); here we (1) finish theme wiring, (2) load and
 * validate content.json, (3) render the page — or show the friendly error
 * fallback if content is broken. The site must NEVER render a blank page.
 *
 * Phase 3 wires the fetch/validate/render pipeline; Phase 4 lazily loads the
 * editor when the URL hash is #admin.
 */

import '../styles/tokens.css';
import '../styles/base.css';
import { initTheme } from './utils/theme';

initTheme();

// Phase 3: loadContent() -> validate() -> renderPage() / showFallback().
export {};
