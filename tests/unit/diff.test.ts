/**
 * Structured diff between published content and draft.
 */
import { describe, it, expect } from 'vitest';
import { diffJson, describeDiff } from '../../src/admin/diff';

describe('diffJson', () => {
  it('returns no entries for equal objects', () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toHaveLength(0);
  });

  it('detects changed primitives with paths', () => {
    const entries = diffJson({ owner: { fullName: 'A' } }, { owner: { fullName: 'B' } });
    expect(entries).toEqual([{ path: 'owner.fullName', kind: 'changed', before: 'A', after: 'B' }]);
  });

  it('detects added and removed keys', () => {
    const entries = diffJson({ old: 1 }, { neu: 2 });
    expect(entries.map((e) => e.kind).sort()).toEqual(['added', 'removed']);
  });

  it('indexes arrays', () => {
    const entries = diffJson({ xs: ['a'] }, { xs: ['a', 'b'] });
    expect(entries[0]?.path).toBe('xs[1]');
    expect(entries[0]?.kind).toBe('added');
  });

  it('describeDiff renders a readable line', () => {
    const [entry] = diffJson({ a: 1 }, { a: 2 });
    expect(describeDiff(entry!)).toContain('a: 1 → 2');
  });

  it('summarizes uploaded images instead of dumping base64', () => {
    const [entry] = diffJson(
      { owner: { photo: './assets/photo.jpg' } },
      { owner: { photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='.repeat(10) } },
    );
    const line = describeDiff(entry!);
    expect(line).toContain('[uploaded image]');
    expect(line).not.toContain('base64');
  });
});
