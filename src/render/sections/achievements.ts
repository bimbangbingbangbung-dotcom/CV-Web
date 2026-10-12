/**
 * Achievements — compact rows: title, issuer · date, category chip and an
 * optional credential-verification link.
 */
import type { Content } from '../schema/types';
import { h } from '../../utils/dom';
import { chip, externalLink, labelOf, metaLine, sectionShell } from '../common';

export function renderAchievements(content: Content): HTMLElement | null {
  if (content.achievements.length === 0) return null;

  const items = content.achievements.map((item) =>
    h(
      'li',
      { class: 'achievement-item' },
      h(
        'div',
        { class: 'card-head' },
        h('h3', { class: 'item-title', text: item.title }),
        chip(item.category, 'chip-muted'),
      ),
      metaLine(item.issuer, item.date),
      item.url ? externalLink('Verify credential', item.url, 'card-link') : null,
    ),
  );

  return sectionShell(
    'achievements',
    labelOf(content, 'achievements'),
    h('ul', { class: 'list-plain' }, ...items),
  );
}
