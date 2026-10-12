/**
 * URL safety.
 *
 * Content JSON could (after an import) contain hostile values like
 * `javascript:alert(1)`. Every URL that reaches the DOM passes through here:
 * only http(s), mailto and tel schemes survive, and external links always get
 * `rel="noopener noreferrer"`.
 */

const EXTERNAL_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

/** Returns the URL if it uses an allowed scheme, otherwise null. */
export function safeExternalUrl(raw: string): string | null {
  return EXTERNAL_SCHEME.test(raw.trim()) ? raw.trim() : null;
}

/** Local asset path (/…, ./…) or absolute http(s) URL — for images and the CV file. */
export function safeAssetPath(raw: string): string | null {
  const value = raw.trim();
  if (/^(https?:\/\/|\/|\.\/)/.test(value)) return value;
  return null;
}

export interface ExternalLinkOptions {
  /** Extra class for the anchor. */
  class?: string;
  /** Show a small ↗ glyph after the label. */
  withGlyph?: boolean;
}

/**
 * Build a safe anchor for an external URL. http(s) links open in a new tab
 * with noopener; mailto/tel stay in the same tab.
 */
export function externalAnchor(
  label: string,
  rawUrl: string,
  iconFn: (name: string) => SVGSVGElement,
  opts: ExternalLinkOptions = {},
): HTMLAnchorElement | null {
  const url = safeExternalUrl(rawUrl);
  if (!url) {
    console.warn(`Skipped link with disallowed URL scheme: ${rawUrl}`);
    return null;
  }
  const anchor = document.createElement('a');
  anchor.textContent = label;
  anchor.href = url;
  if (opts.class) anchor.className = opts.class;
  if (/^https?:\/\//i.test(url)) {
    anchor.rel = 'noopener noreferrer';
    anchor.target = '_blank';
  }
  if (opts.withGlyph) anchor.append(iconFn('external'));
  return anchor;
}
