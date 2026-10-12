/**
 * Publications — optional section; hidden automatically while the list is
 * empty (the schema allows [] and the renderer returns null).
 */
import type { Content } from '../../schema/types';
import { h } from '../../utils/dom';
import { externalLink, labelOf, metaLine, sectionShell } from '../common';

export function renderPublications(content: Content): HTMLElement | null {
  const publications = content.publications ?? [];
  if (publications.length === 0) return null;

  const items = publications.map((pub) =>
    h(
      'li',
      { class: 'achievement-item' },
      externalLink(pub.title, pub.url, 'item-title link-plain'),
      metaLine(pub.publisher, pub.date),
      pub.note ? h('p', { class: 'prose', text: pub.note }) : null,
    ),
  );

  return sectionShell(
    'publications',
    labelOf(content, 'publications'),
    h('ul', { class: 'list-plain' }, ...items),
  );
}
