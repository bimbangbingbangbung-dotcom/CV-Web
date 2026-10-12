/**
 * About — long bio, "Now" mini-block and quick facts.
 * Hidden automatically when there is nothing to show.
 */
import type { Content } from '../schema/types';
import { h } from '../utils/dom';
import { chip, factRow, sectionShell } from '../common';

export function renderAbout(content: Content): HTMLElement | null {
  const { owner } = content;
  const hasNow = (owner.now?.length ?? 0) > 0;
  const hasFacts = owner.location || owner.languages.length > 0 || owner.interests.length > 0;
  if (!owner.longBio && !hasNow && !hasFacts) return null;

  const paragraphs = (owner.longBio ?? '')
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .map((text) => h('p', { class: 'prose', text: text.trim() }));

  const nowBlock = hasNow
    ? h(
        'div',
        { class: 'now-block' },
        h('h3', { class: 'minor-title', text: 'Now' }),
        h(
          'ul',
          { class: 'now-list' },
          ...(owner.now ?? []).map((item) => h('li', { text: item.text })),
        ),
      )
    : null;

  const facts = h(
    'dl',
    { class: 'facts' },
    owner.location ? factRow('Location', owner.location) : null,
    owner.languages.length > 0
      ? factRow('Languages', ...owner.languages.map((l) => chip(l, 'chip-muted')))
      : null,
    owner.interests.length > 0
      ? factRow('Interests', ...owner.interests.map((i) => chip(i, 'chip-muted')))
      : null,
  );

  return sectionShell(
    'about',
    content.sections.find((s) => s.id === 'about')?.label ?? 'About',
    h(
      'div',
      { class: 'about-grid' },
      h('div', { class: 'about-main' }, ...paragraphs, nowBlock),
      hasFacts ? h('aside', { class: 'about-facts' }, facts) : null,
    ),
  );
}
