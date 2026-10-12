/**
 * Migration ladder — current version passes through, newer versions are
 * rejected with a reason (so a newer content.json shows a friendly banner
 * instead of rendering garbage).
 */
import { describe, it, expect } from 'vitest';
import { migrate } from '../../src/utils/migrate';
import { SCHEMA_VERSION } from '../../src/schema/types';
import { DEFAULT_CONTENT } from '../../src/schema/defaults';

describe('migrate', () => {
  it('accepts content at the current schema version', () => {
    const result = migrate(structuredClone(DEFAULT_CONTENT));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(DEFAULT_CONTENT);
  });

  it('registers the current version as 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('rejects content from a newer schema version', () => {
    const future = structuredClone(DEFAULT_CONTENT) as { meta: { schemaVersion: number } };
    future.meta.schemaVersion = SCHEMA_VERSION + 1;
    const result = migrate(future);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('newer-than-site');
  });

  it('rejects non-object input', () => {
    const result = migrate(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unrecognized');
  });
});
