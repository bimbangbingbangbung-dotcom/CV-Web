/**
 * References — a single honest line ("Available on request") when enabled.
 */
import type { Content } from '../../schema/types';
import { h } from '../../utils/dom';
import { labelOf, sectionShell } from '../common';

export function renderReferences(content: Content): HTMLElement | null {
  if (!content.references.show) return null;
  return sectionShell(
    'references',
    labelOf(content, 'references'),
    h('p', { class: 'prose', text: content.references.note }),
  );
}
