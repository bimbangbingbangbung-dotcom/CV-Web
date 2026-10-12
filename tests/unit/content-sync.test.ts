/**
 * Drift check: the shipped sample content.json must always validate against
 * content.schema.json, and both must agree with the typed defaults used as
 * the site's last-resort fallback. If someone edits one without the other,
 * this test fails before CI deploys a broken site.
 */
import { describe, it, expect } from 'vitest';
import { validateContent } from '../../src/utils/validate';
import { DEFAULT_CONTENT } from '../../src/schema/defaults';
import { SCHEMA_VERSION } from '../../src/schema/types';
import published from '../../public/content.json';

describe('content / schema sync', () => {
  it('public/content.json validates', () => {
    const result = validateContent(published);
    expect(result.ok).toBe(true);
  });

  it('DEFAULT_CONTENT validates', () => {
    const result = validateContent(DEFAULT_CONTENT);
    expect(result.ok).toBe(true);
  });

  it('schema, published content and defaults share one schemaVersion', () => {
    const publishedVersion = (published as { meta: { schemaVersion: number } }).meta.schemaVersion;
    expect(publishedVersion).toBe(SCHEMA_VERSION);
    expect(DEFAULT_CONTENT.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
