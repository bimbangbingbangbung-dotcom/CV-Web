/**
 * Education — vertical timeline: mono date range left, details right.
 */
import type { Content } from '../schema/types';
import { h } from '../utils/dom';
import { chip, dateRange, labelOf, sectionShell } from '../common';

export function renderEducation(content: Content): HTMLElement | null {
  if (content.education.length === 0) return null;

  const items = content.education.map((edu) =>
    h(
      'li',
      { class: 'timeline-item' },
      dateRange(edu.start, edu.end),
      h(
        'div',
        { class: 'timeline-body' },
        h('h3', { class: 'item-title', text: edu.institution }),
        h('p', { class: 'item-sub', text: edu.degree }),
        h('p', { class: 'meta-line', text: edu.location }),
        edu.gpa ? h('p', { class: 'meta-line', text: `GPA: ${edu.gpa}` }) : null,
        (edu.coursework?.length ?? 0) > 0
          ? h(
              'div',
              { class: 'chip-row' },
              ...(edu.coursework ?? []).map((course) => chip(course, 'chip-muted')),
            )
          : null,
        (edu.honors?.length ?? 0) > 0
          ? h('ul', { class: 'honor-list' }, ...(edu.honors ?? []).map((honor) => h('li', { text: honor })))
          : null,
      ),
    ),
  );

  return sectionShell('education', labelOf(content, 'education'), h('ul', { class: 'timeline' }, ...items));
}
