/**
 * Schema-version migration.
 *
 * content.json carries `meta.schemaVersion`. When the schema evolves, add a
 * numbered migration below and bump SCHEMA_VERSION — old exports (including
 * edit-mode backups from months ago) then upgrade automatically on load
 * instead of erroring out.
 *
 * v1 → v1: identity (nothing to do yet — this is the first schema).
 */
import { SCHEMA_VERSION } from '../schema/types';

export type MigrationResult =
  { ok: true; data: unknown } | { ok: false; reason: 'unreadable' | 'newer-than-site' };

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades version n to n+1. */
const MIGRATIONS: Record<number, Migration> = {
  // Example for the future:
  // 1: (data) => ({ ...data, meta: { ...(data.meta as object), schemaVersion: 2 }, /* renames… */ }),
};

export function migrate(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'unreadable' };

  let data = input as Record<string, unknown>;
  const meta = data['meta'] as { schemaVersion?: unknown } | undefined;
  const version = meta?.schemaVersion;

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'unreadable' };
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-than-site' };
  }

  for (let from = version; from < SCHEMA_VERSION; from++) {
    const step = MIGRATIONS[from];
    if (step) data = step(data);
  }
  return { ok: true, data };
}
