/**
 * Minimal DOM helpers.
 *
 * Rendering rule for this whole project: content from content.json is ONLY
 * ever inserted via textContent or setAttribute — never innerHTML. That makes
 * XSS structurally impossible even though content travels through JSON.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  /** Sets textContent (safe by construction). */
  text?: string | number;
  id?: string;
  /** Attribute map — names like aria-*, data-*, role, href, type… */
  attrs?: Record<string, string | boolean | null | undefined>;
}

/** Create an element with optional class/text/attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = String(props.text);
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  appendChildren(el, children);
  return el;
}

/** Append children, skipping empty placeholders. */
export function appendChildren(parent: ParentNode, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    // ParentNode.append() takes string | Node — normalize numbers to text.
    parent.append(typeof child === 'number' ? String(child) : child);
  }
}

/** Remove every child of an element. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Derive 1–3 uppercase initials from a full name ("Juan Miguel Reyes" → "JMR"). */
export function initialsFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
