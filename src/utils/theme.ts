/**
 * Theme system — light / dark / system with no flash on load.
 *
 * The inline script in index.html applies the resolved theme BEFORE first
 * paint. This module owns everything after that: reading the stored
 * preference, toggling, reacting to OS changes in "system" mode, and keeping
 * the <meta name="theme-color"> in sync.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'cvweb:theme';
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#fbfbfa', dark: '#0e100f' };

/** Read the stored preference; anything unexpected falls back to "system". */
export function getStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* localStorage unavailable (private mode) — "system" is a safe default */
  }
  return 'system';
}

/** Resolve a mode to an actual theme using the OS preference. */
export function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply a resolved theme to <html> and the browser chrome. */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset['theme'] = resolved;
  root.style.colorScheme = resolved;
  const meta = document.createElement === undefined ? null : document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
  // Let interested components (e.g. header theme buttons) re-sync.
  window.dispatchEvent(new CustomEvent('cvweb:themechange', { detail: { theme: resolved } }));
}

/** Persist a mode and apply it. */
export function setMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore — theme still applies for this session */
  }
  applyTheme(resolveMode(mode));
}

/** Toggle between light and dark (used by the header button and shortcut "T"). */
export function toggleTheme(): ThemeMode {
  const current = resolveMode(getStoredMode());
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
  setMode(next);
  return next;
}

let mediaQuery: MediaQueryList | null = null;

/** Wire up OS-change tracking for "system" mode. Called once at boot. */
export function initTheme(): void {
  applyTheme(resolveMode(getStoredMode()));
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = (): void => {
    if (getStoredMode() === 'system') applyTheme(resolveMode('system'));
  };
  // MediaQueryList.addEventListener is supported everywhere relevant (2026).
  mediaQuery.addEventListener('change', onSystemChange);
}
