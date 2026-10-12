/**
 * Snapshot persistence for resilience.
 *
 * After every successful load, the validated content is saved to
 * localStorage. If a future edit/import breaks content.json, the site falls
 * back to this last known-good copy instead of going blank. This is a
 * convenience cache — the published source of truth remains
 * public/content.json.
 */
import type { Content } from '../schema/types';

const SNAPSHOT_KEY = 'cvweb:lastValid';

export function saveSnapshot(content: Content): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(content));
  } catch {
    /* storage full or unavailable — resilience just degrades gracefully */
  }
}

/** Returns the last known-good content, or null when none exists. */
export function loadSnapshot(): unknown | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
