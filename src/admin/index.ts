/**
 * Placeholder for the built-in edit mode (Phase 4).
 *
 * Keeps the #admin route in main.ts type-safe until the real editor lands;
 * this file is replaced wholesale by the schema-driven editor.
 */
import type { Content } from '../schema/types';

export interface AdminOptions {
  /** Re-render the public site with freshly published content. */
  onPublished: (content: Content) => void;
}

export function initAdmin(_content: Content, _options: AdminOptions): void {
  console.warn('Edit mode is not implemented yet.');
}
