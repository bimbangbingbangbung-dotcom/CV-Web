/**
 * WCAG 2.1 relative-luminance contrast math for the editor's
 * accessibility-friendly accent color checker.
 *
 * The checker exists because the accent color is owner-editable: every
 * published combination must still pass AA on both themes.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channel(value8: number): number {
  const c = value8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors (1 = same, 21 = black/white). */
export function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const la = relativeLuminance(ra);
  const lb = relativeLuminance(rb);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastCheck {
  label: string;
  ratio: number;
  /** AA body text (4.5:1) */
  aa: boolean;
  /** AA large text / UI components (3:1) */
  aaLarge: boolean;
}

/**
 * The fixed token pairs that ship with the site, evaluated against the
 * owner's chosen accents (values from src/styles/tokens.css).
 */
export function checkAccentPairs(accentLight: string, accentDark: string): ContrastCheck[] {
  const pairs: [string, string, string][] = [
    ['Body text on page (light)', '#1b1d1c', '#fbfbfa'],
    ['Muted text on page (light)', '#5b5f5d', '#fbfbfa'],
    ['Accent link on page (light)', accentLight, '#fbfbfa'],
    ['Button text on accent (light)', '#ffffff', accentLight],
    ['Body text on page (dark)', '#e9eae7', '#0e100f'],
    ['Muted text on page (dark)', '#a3a8a4', '#0e100f'],
    ['Accent link on page (dark)', accentDark, '#0e100f'],
    ['Button text on accent (dark)', '#06231f', accentDark],
  ];
  return pairs.map(([label, fg, bg]) => {
    const ratio = contrastRatio(fg, bg) ?? 0;
    return { label, ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3 };
  });
}
