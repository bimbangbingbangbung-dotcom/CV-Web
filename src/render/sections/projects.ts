/**
 * Projects — cards with tag filtering, a "Featured" flag and an optional
 * expandable problem → solution → result detail view (<details>, so it works
 * without JavaScript and with keyboards out of the box).
 */
import type { Content, Project } from '../../schema/types';
import { h } from '../../utils/dom';
import { safeAssetPath } from '../../utils/url';
import { chip, externalLink, labelOf, metaLine, sectionShell } from '../common';

function detailBlock(project: Project): HTMLElement | null {
  const d = project.detail;
  if (!d) return null;
  return h(
    'details',
    { class: 'project-detail' },
    h('summary', { text: 'Problem · Solution · Result' }),
    h(
      'dl',
      { class: 'detail-grid' },
      h('dt', { text: 'Problem' }),
      h('dd', { text: d.problem }),
      h('dt', { text: 'Solution' }),
      h('dd', { text: d.solution }),
      h('dt', { text: 'Result' }),
      h('dd', { text: d.result }),
    ),
  );
}

function projectCard(project: Project): HTMLElement {
  const links = project.links
    .map((link) => externalLink(link.label, link.url, 'card-link'))
    .filter((el): el is HTMLAnchorElement => el !== null);

  const imageHref = project.image ? safeAssetPath(project.image) : null;

  return h(
    'li',
    { class: 'card project-card', attrs: { 'data-tech': project.tech.join('|').toLowerCase() } },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { class: 'item-title', text: project.title }),
      project.featured ? chip('Featured', 'chip-accent') : null,
    ),
    metaLine(project.role, project.year),
    h('p', { class: 'prose', text: project.description }),
    project.tech.length > 0
      ? h('div', { class: 'chip-row' }, ...project.tech.map((t) => chip(t, 'chip-muted')))
      : null,
    links.length > 0 ? h('div', { class: 'card-links' }, ...links) : null,
    imageHref
      ? h('img', {
          class: 'project-image',
          attrs: {
            src: imageHref,
            alt: `Screenshot of ${project.title}`,
            loading: 'lazy',
            decoding: 'async',
          },
        })
      : null,
    detailBlock(project),
  );
}

export function renderProjects(content: Content): HTMLElement | null {
  if (content.projects.length === 0) return null;

  // Featured first, everything else keeps its authored order (stable sort).
  const ordered = [...content.projects].sort((a, b) => Number(b.featured) - Number(a.featured));
  const cards = ordered.map(projectCard);

  // Tag filter row — only worth showing with a few projects and real tags.
  const tags = [...new Set(ordered.flatMap((p) => p.tech))].sort((a, b) => a.localeCompare(b));
  const filterRow =
    ordered.length > 1 && tags.length > 1
      ? (() => {
          const buttons: HTMLButtonElement[] = [];
          const makeFilter = (label: string, tag: string | null): HTMLButtonElement => {
            const btn = h('button', {
              class: 'chip filter-chip',
              text: label,
              attrs: { type: 'button', 'aria-pressed': tag === null ? 'true' : 'false' },
            });
            btn.addEventListener('click', () => {
              for (const other of buttons) other.setAttribute('aria-pressed', 'false');
              btn.setAttribute('aria-pressed', 'true');
              cards.forEach((card, i) => {
                const cardTags = (ordered[i]?.tech ?? []).map((t) => t.toLowerCase());
                const show = tag === null || cardTags.includes(tag.toLowerCase());
                card.classList.toggle('is-filtered-out', !show);
              });
            });
            buttons.push(btn);
            return btn;
          };
          return h(
            'div',
            {
              class: 'filter-row',
              attrs: { role: 'group', 'aria-label': 'Filter projects by technology' },
            },
            makeFilter('All', null),
            ...tags.map((tag) => makeFilter(tag, tag)),
          );
        })()
      : null;

  return sectionShell(
    'projects',
    labelOf(content, 'projects'),
    filterRow,
    h('ul', { class: 'card-grid' }, ...cards),
  );
}
