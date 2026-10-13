/**
 * Draft state for the edit mode (#admin).
 *
 * Rules (from the brief):
 * - The draft lives in memory + localStorage ("cvweb:draft") as a WORKING
 *   copy. Published content stays in public/content.json — localStorage is
 *   never treated as the published source of truth.
 * - Undo/redo keeps up to 50 steps (brief requires 20+).
 * - Every mutation emits to subscribers; `external` marks changes that need
 *   a full form re-render (undo/import/reset) vs. field edits that don't.
 */
import type { Content } from '../schema/types';
import { validateContent } from '../utils/validate';

const DRAFT_KEY = 'cvweb:draft';
const HISTORY_LIMIT = 50;

export interface EmitMeta {
  dirty: boolean;
  /** true = the whole draft was swapped (undo/redo/import/reset): re-render forms. */
  external: boolean;
}

export type DraftListener = (draft: Content, meta: EmitMeta) => void;

export function isPersistedDraft(value: unknown): value is { savedAt: string; data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'savedAt' in value &&
    typeof (value as { savedAt: unknown }).savedAt === 'string'
  );
}

/** Read the persisted draft (returns null when missing/corrupt). */
export function loadPersistedDraft(): { savedAt: string; data: unknown } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isPersistedDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPersistedDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Immutably set a value at a path like ['projects', 0, 'title']. */
function deepSet(target: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(target)) {
    const copy = [...target];
    copy[key as number] = deepSet(copy[key as number] ?? null, rest, value);
    return copy;
  }
  const copy = { ...(target as Record<string, unknown>) };
  copy[String(key)] = deepSet(copy[String(key)] ?? null, rest, value);
  return copy;
}

export class DraftStore {
  private draftValue: Content;
  private publishedJson: string;
  private past: Content[] = [];
  private future: Content[] = [];
  private listeners: DraftListener[] = [];
  private persistTimer: number | null = null;

  /**
   * @param published the last known published content (dirty baseline)
   * @param initial an in-progress draft to open with (e.g. when the editor
   *   is reopened in the same session); defaults to the published content
   */
  constructor(published: Content, initial?: Content) {
    this.draftValue = initial ?? published;
    this.publishedJson = JSON.stringify(published);
  }

  get draft(): Content {
    return this.draftValue;
  }

  get dirty(): boolean {
    return JSON.stringify(this.draftValue) !== this.publishedJson;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  subscribe(listener: DraftListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(external: boolean): void {
    const meta: EmitMeta = { dirty: this.dirty, external };
    for (const listener of this.listeners) listener(this.draftValue, meta);
    this.schedulePersist();
  }

  private pushHistory(): void {
    this.past.push(structuredClone(this.draftValue));
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      try {
        if (this.dirty) {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({ savedAt: new Date().toISOString(), data: this.draftValue }),
          );
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        /* storage unavailable — the draft simply won't survive a reload */
      }
    }, 400);
  }

  /** Commit a single field edit (history entry per edit). */
  set(path: (string | number)[], value: unknown): void {
    this.pushHistory();
    this.draftValue = deepSet(this.draftValue, path, value) as Content;
    this.emit(false);
  }

  /** Swap the entire draft (reorder, import, resume). */
  replace(next: Content, options: { history?: boolean } = {}): void {
    if (options.history !== false) this.pushHistory();
    this.draftValue = next;
    this.emit(true);
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(structuredClone(this.draftValue));
    this.draftValue = previous;
    this.emit(true);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(structuredClone(this.draftValue));
    this.draftValue = next;
    this.emit(true);
    return true;
  }

  /** Reset draft back to the published content (keeps history for undo). */
  resetToPublished(): void {
    this.replace(JSON.parse(this.publishedJson) as Content);
  }

  /**
   * Re-baseline after a successful publish (Save to GitHub): the draft IS
   * the published copy now, so the badge flips to "Matches published", the
   * draft pill/unsafe-close guard clear, and localStorage drops the draft.
   */
  markSaved(): void {
    this.publishedJson = JSON.stringify(this.draftValue);
    this.emit(false);
  }

  /** Validate an arbitrary object as content (used by import/resume). */
  static parseContent(data: unknown): ReturnType<typeof validateContent> {
    return validateContent(data);
  }
}
