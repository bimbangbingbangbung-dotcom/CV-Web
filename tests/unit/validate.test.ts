/**
 * Unit tests for the runtime content validator wrapper.
 */
import { describe, it, expect } from 'vitest';
import { validateContent } from '../../src/utils/validate';
import { DEFAULT_CONTENT } from '../../src/schema/defaults';

/** Deep-clone the default content so mutations don't leak between tests. */
const validContent = (): unknown => structuredClone(DEFAULT_CONTENT);

describe('validateContent', () => {
  it('accepts well-formed content', () => {
    const result = validateContent(validContent());
    expect(result.ok).toBe(true);
  });

  it('rejects non-objects', () => {
    const result = validateContent('not content');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports missing required fields with friendly wording', () => {
    const broken = validContent() as Record<string, unknown>;
    delete broken['owner'];
    const result = validateContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('missing required field'))).toBe(true);
    }
  });

  it('reports enum problems as a list of allowed values', () => {
    const broken = validContent() as {
      sections: { id: string; label: string; enabled: boolean }[];
    };
    broken.sections[0] = { id: 'nope', label: 'X', enabled: true };
    const result = validateContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('must be one of'))).toBe(true);
    }
  });

  it('flags duplicate section ids (semantic check beyond the schema)', () => {
    const broken = validContent() as { sections: unknown[] };
    broken.sections.push(structuredClone(broken.sections[0]));
    const result = validateContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.path === '/sections' && e.message.includes('duplicate')),
      ).toBe(true);
    }
  });

  it('accepts project cover and gallery pictures as data URLs or paths', () => {
    const content = validContent() as { projects: unknown[] };
    content.projects.push({
      title: 'Project X',
      description: 'A project.',
      role: 'Creator',
      year: '2026',
      tech: ['Arduino'],
      links: [],
      image: 'data:image/jpeg;base64,QUJD',
      gallery: ['data:image/png;base64,QUJD', './assets/pic.jpg'],
      featured: false,
      detail: null,
    });
    expect(validateContent(content).ok).toBe(true);
  });

  it('rejects an unsafe scheme in a project picture', () => {
    const content = validContent() as { projects: unknown[] };
    content.projects.push({
      title: 'Project X',
      description: 'A project.',
      role: 'Creator',
      year: '2026',
      tech: ['Arduino'],
      links: [],
      image: 'javascript:alert(1)',
      featured: false,
      detail: null,
    });
    const result = validateContent(content);
    expect(result.ok).toBe(false);
  });

  it('rejects a project gallery with more than 30 pictures', () => {
    const content = validContent() as { projects: unknown[] };
    content.projects.push({
      title: 'Project X',
      description: 'A project.',
      role: 'Creator',
      year: '2026',
      tech: ['Arduino'],
      links: [],
      gallery: Array.from({ length: 31 }, (_, i) => `./assets/pic-${i}.jpg`),
      featured: false,
      detail: null,
    });
    const result = validateContent(content);
    expect(result.ok).toBe(false);
  });
});
