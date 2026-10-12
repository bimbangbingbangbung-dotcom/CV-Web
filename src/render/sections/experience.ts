/**
 * Experience — same timeline grammar as Education, with role type chip and
 * bullet highlights.
 */
import type { Content } from '../schema/types';
import { h } from '../../utils/dom';
import { chip, dateRange, labelOf, sectionShell } from '../common';

export function renderExperience(content: Content): HTMLElement | null {
  if (content.experience.length === 0) return null;

  const items = content.experience.map((job) =>
    h(
      'li',
      { class: 'timeline-item' },
      dateRange(job.start, job.end),
      h(
        'div',
        { class: 'timeline-body' },
        h(
          'div',
          { class: 'card-head' },
          h('h3', { class: 'item-title', text: job.role }),
          job.type ? chip(job.type.replace('-', ' '), 'chip-muted') : null,
        ),
        h('p', { class: 'item-sub', text: job.org }),
        h('p', { class: 'meta-line', text: job.location }),
        h('p', { class: 'prose', text: job.description }),
        (job.highlights?.length ?? 0) > 0
          ? h(
              'ul',
              { class: 'highlight-list' },
              ...(job.highlights ?? []).map((highlight) => h('li', { text: highlight })),
            )
          : null,
      ),
    ),
  );

  return sectionShell(
    'experience',
    labelOf(content, 'experience'),
    h('ul', { class: 'timeline' }, ...items),
  );
}
