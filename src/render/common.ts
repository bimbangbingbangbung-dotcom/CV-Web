/**
 * Shared building blocks for section renderers.
 *
 * Everything here produces semantic, keyboard-friendly markup with a single
 * visual rhythm: section → h2 → content list. Section spacing, hairline
 * separators and heading styles live in layout.css so every section looks
 * identical by construction.
 */
import { h } from '../utils/dom';
import { icon } from '../components/icons';
import { externalAnchor } from '../utils/url';
import { LEVEL_LABELS, type SkillLevel } from '../schema/types';

/** Resolve the owner-defined heading for a section (nav label = section title). */
export function labelOf(content: { sections: { id: string; label: string }[] }, id: string): string {
  return content.sections.find((s) => s.id === id)?.label ?? id;
}

/** The standard section shell: <section> with its heading and reveal hook. */
export function sectionShell(id: string, label: string, ...children: (Node | null)[]): HTMLElement {
  const body = children.filter((child): child is Node => child !== null);
  return h(
    'section',
    { class: 'section', id, attrs: { 'aria-labelledby': `${id}-title`, tabindex: '-1', 'data-reveal': true } },
    h('h2', { class: 'section-title', id: `${id}-title`, text: label }),
    ...body,
  );
}

/** Small rounded chip (tech tags, skills, categories). */
export function chip(text: string, class_ = ''): HTMLElement {
  return h('span', { class: `chip${class_ ? ` ${class_}` : ''}`, text });
}

/** Proficiency chip — text label, never color alone. */
export function levelChip(level: SkillLevel | null | undefined): HTMLElement | null {
  if (!level) return null;
  return chip(LEVEL_LABELS[level], 'chip-muted');
}

/** "Start – End" rendered in the mono accent style. */
export function dateRange(start: string, end: string): HTMLElement {
  return h('span', { class: 'mono date-range', text: `${start} – ${end}` });
}

/** A muted meta line with "·" separators between parts. */
export function metaLine(...parts: (string | HTMLElement | null)[]): HTMLElement {
  const line = h('p', { class: 'meta-line' });
  parts.filter((p): p is string | HTMLElement => p !== null).forEach((part, i) => {
    if (i > 0) line.append(h('span', { class: 'meta-dot', text: '·', attrs: { 'aria-hidden': 'true' } }));
    line.append(typeof part === 'string' ? h('span', { text: part }) : part);
  });
  return line;
}

/** Safe external link with the ↗ glyph; returns null for disallowed URLs. */
export function externalLink(label: string, url: string, class_ = ''): HTMLAnchorElement | null {
  return externalAnchor(label, url, icon, { class: class_, withGlyph: true });
}

/** Icon-only element (used inside buttons/links that carry their own labels). */
export function iconEl(name: string, class_ = 'icon'): SVGSVGElement {
  return icon(name, class_);
}

/** Simple definition-style fact row (About quick facts). */
export function factRow(term: string, ...values: (string | HTMLElement)[]): HTMLElement {
  return h(
    'div',
    { class: 'fact-row' },
    h('dt', { class: 'fact-term', text: term }),
    h('dd', { class: 'fact-value' }, ...values),
  );
}
