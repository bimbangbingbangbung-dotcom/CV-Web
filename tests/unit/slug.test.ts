/**
 * Project detail route slugs — the link a card renders and the route the
 * router matches must come from the same function, so these tests pin the
 * behaviour both sides rely on.
 */
import { describe, expect, it } from 'vitest';
import { projectSlugs, slugify } from '../../src/utils/slug';

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('Automated Pet Food Weighing Vending Machine')).toBe(
      'automated-pet-food-weighing-vending-machine',
    );
  });

  it('collapses punctuation and whitespace runs into single hyphens', () => {
    expect(slugify('  Miniature House — 2024!  ')).toBe('miniature-house-2024');
    expect(slugify('Solar-Powered / Mobile: Charging?')).toBe(
      'solar-powered-mobile-charging',
    );
  });

  it('strips accents through NFKD normalization', () => {
    expect(slugify('Café R&D')).toBe('cafe-r-d');
  });

  it('falls back to "project" when no ASCII survives', () => {
    expect(slugify('???')).toBe('project');
    expect(slugify('')).toBe('project');
  });
});

describe('projectSlugs', () => {
  it('keeps unique titles as-is', () => {
    expect(projectSlugs([{ title: 'Solar-Powered Mobile Charging System' }])).toEqual([
      'solar-powered-mobile-charging-system',
    ]);
  });

  it('dedupes duplicate titles left to right with numeric suffixes', () => {
    expect(projectSlugs([{ title: 'Site' }, { title: 'Site' }, { title: 'Site' }])).toEqual([
      'site',
      'site-2',
      'site-3',
    ]);
  });

  it('returns one slug per project even for an empty list', () => {
    expect(projectSlugs([])).toEqual([]);
  });
});
