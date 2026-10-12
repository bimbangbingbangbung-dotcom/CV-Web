/**
 * WCAG contrast math used by the editor's accent checker.
 */
import { describe, it, expect } from 'vitest';
import { contrastRatio, hexToRgb, checkAccentPairs } from '../../src/admin/contrast';

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#0f6d66')).toEqual([15, 109, 102]);
  });

  it('expands 3-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });

  it('rejects invalid values', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black vs white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#0f6d66', '#0f6d66')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456') ?? 0, 5);
  });
});

describe('checkAccentPairs', () => {
  it('passes with the shipped default accents', () => {
    const checks = checkAccentPairs('#0f6d66', '#5cc5ba');
    expect(checks.length).toBe(8);
    for (const check of checks) expect(check.aa, `${check.label} (${check.ratio})`).toBe(true);
  });

  it('fails AA for a low-contrast accent choice', () => {
    const checks = checkAccentPairs('#cccccc', '#dddddd');
    expect(checks.some((c) => !c.aa)).toBe(true);
  });
});
