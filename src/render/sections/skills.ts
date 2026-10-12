/**
 * Skills — grouped chips. Proficiency is always spelled out in words
 * ("Advanced"), never encoded in color alone.
 */
import type { Content } from '../../schema/types';
import { h } from '../../utils/dom';
import { chip, labelOf, levelChip, sectionShell } from '../common';

export function renderSkills(content: Content): HTMLElement | null {
  if (content.skills.length === 0) return null;

  const groups = content.skills.map((group) =>
    h(
      'div',
      { class: 'skill-group' },
      h('h3', { class: 'minor-title', text: group.group }),
      h(
        'ul',
        { class: 'chip-row' },
        ...group.items.map((item) => {
          const li = h('li', {}, chip(item.name));
          const level = levelChip(item.level);
          if (level) li.append(level);
          if (item.note) li.append(h('span', { class: 'chip-note', text: item.note }));
          return li;
        }),
      ),
    ),
  );

  return sectionShell(
    'skills',
    labelOf(content, 'skills'),
    h('div', { class: 'skill-groups' }, ...groups),
  );
}
