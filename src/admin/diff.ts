/**
 * Structured diff between the published content and the current draft —
 * path-based (like the rest of the editor) instead of a raw text diff, so
 * the owner sees "projects[0].title: 'A' → 'B'" rather than line numbers.
 */

export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

const MAX_DEPTH = 12;

function short(value: unknown): string {
  if (value === undefined) return '∅';
  const json = JSON.stringify(value) ?? String(value);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

export function diffJson(before: unknown, after: unknown, path = '', depth = 0): DiffEntry[] {
  if (depth > MAX_DEPTH || Object.is(before, after)) return [];
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  const bothObjects =
    typeof before === 'object' && before !== null && typeof after === 'object' && after !== null;

  if (!bothObjects) {
    if (before === undefined) return [{ path: path || '(root)', kind: 'added', after }];
    if (after === undefined) return [{ path: path || '(root)', kind: 'removed', before }];
    return [{ path: path || '(root)', kind: 'changed', before, after }];
  }

  const entries: DiffEntry[] = [];
  const keys = new Set([
    ...Object.keys(before as Record<string, unknown>),
    ...Object.keys(after as Record<string, unknown>),
  ]);

  for (const key of keys) {
    const isArrayItem = Array.isArray(before) || Array.isArray(after);
    const childPath = isArrayItem ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    entries.push(
      ...diffJson(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        childPath,
        depth + 1,
      ),
    );
  }
  return entries;
}

export function describeDiff(entry: DiffEntry): string {
  switch (entry.kind) {
    case 'added':
      return `+ ${entry.path} = ${short(entry.after)}`;
    case 'removed':
      return `− ${entry.path} (was ${short(entry.before)})`;
    case 'changed':
      return `~ ${entry.path}: ${short(entry.before)} → ${short(entry.after)}`;
  }
}
