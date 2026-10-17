/**
 * Project detail page — the "#project-<slug>" route a project card opens.
 *
 * renderPage() mounts this section once (hidden); main.ts's hash router fills
 * it when the route matches and clears it again otherwise, so a single-file
 * site still behaves like a separate page: own URL, deep-linkable, browser
 * Back/Forward works.
 *
 * It shows everything a card cannot: the cover picture, the full description,
 * problem → solution → result, tech, links and the picture gallery — clicking
 * a gallery picture opens a modal lightbox (native <dialog>, so Escape,
 * backdrop clicks and the focus trap come for free).
 */
import type { Project } from '../../schema/types';
import { h, clear, appendChildren } from '../../utils/dom';
import { safeAssetPath } from '../../utils/url';
import { icon } from '../../components/icons';
import { chip, externalLink, metaLine } from '../common';

/** Prefix of the detail route; main.ts derives and matches the same slugs. */
export const PROJECT_ROUTE_PREFIX = '#project-';

/**
 * The hidden shell: back link + heading persist, the body is refilled on
 * every route entry (and emptied again on exit).
 */
export function projectViewShell(): HTMLElement {
  const back = h('a', {
    class: 'btn btn-ghost btn-sm project-back',
    text: 'All projects',
    attrs: { href: '#projects' },
  });
  back.prepend(icon('arrow-left'));

  return h(
    'section',
    {
      class: 'section project-view',
      id: 'project-view',
      attrs: {
        hidden: true,
        tabindex: '-1',
        'aria-labelledby': 'project-view-title',
      },
    },
    back,
    h('h2', { class: 'section-title', id: 'project-view-title' }),
    h('div', { class: 'project-view-body' }),
  );
}

/** Modal picture viewer for one project's gallery (built per fill). */
function buildLightbox(pictures: string[], title: string): {
  dialog: HTMLDialogElement;
  open: (index: number, opener: HTMLElement) => void;
} {
  const img = h('img', { class: 'lightbox-img', attrs: { alt: '' } });
  const counter = h('span', {
    class: 'lightbox-counter mono',
    attrs: { 'aria-hidden': 'true' },
  });
  const closeBtn = h(
    'button',
    { class: 'icon-btn lightbox-close', attrs: { type: 'button', 'aria-label': 'Close pictures' } },
    icon('close'),
  );
  const prevBtn = h(
    'button',
    {
      class: 'icon-btn lightbox-prev',
      attrs: { type: 'button', 'aria-label': 'Previous picture' },
    },
    icon('arrow-left'),
  );
  const nextBtn = h(
    'button',
    {
      class: 'icon-btn lightbox-next',
      attrs: { type: 'button', 'aria-label': 'Next picture' },
    },
    icon('arrow-right'),
  );

  const dialog = h('dialog', {
    class: 'lightbox',
    attrs: { 'aria-label': `${title} — pictures` },
  });

  // One picture has nothing to page through — keep only the close button.
  if (pictures.length < 2) {
    prevBtn.hidden = true;
    nextBtn.hidden = true;
    counter.hidden = true;
  }

  let opener: HTMLElement | null = null;
  let index = 0;

  const show = (next: number): void => {
    index = (next + pictures.length) % pictures.length; // wraps both ways
    const src = pictures[index];
    if (src) img.setAttribute('src', src);
    img.setAttribute('alt', `${title} — picture ${index + 1}`);
    counter.textContent = `${index + 1} / ${pictures.length}`;
  };

  closeBtn.addEventListener('click', () => dialog.close());
  prevBtn.addEventListener('click', () => show(index - 1));
  nextBtn.addEventListener('click', () => show(index + 1));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close(); // dimmed backdrop
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + 1);
    }
  });
  dialog.addEventListener('close', () => opener?.focus()); // focus returns to the thumb

  dialog.append(closeBtn, prevBtn, img, nextBtn, counter);
  return {
    dialog,
    open: (at, from) => {
      opener = from;
      show(at);
      dialog.showModal();
    },
  };
}

/** Fill the shell with one project's page. Called by the hash router. */
export function fillProjectView(shell: HTMLElement, project: Project): void {
  const heading = shell.querySelector('#project-view-title');
  const body = shell.querySelector('.project-view-body');
  if (!body) return;

  const title = project.title;
  if (heading) heading.textContent = title;
  clear(body);

  const links = project.links
    .map((link) => externalLink(link.label, link.url, 'card-link'))
    .filter((el): el is HTMLAnchorElement => el !== null);

  const coverSrc = project.image ? safeAssetPath(project.image) : null;
  const paragraphs = project.description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pictures = (project.gallery ?? [])
    .map((raw) => safeAssetPath(raw))
    .filter((src): src is string => src !== null);

  const detail = project.detail;
  const lightbox = pictures.length > 0 ? buildLightbox(pictures, title) : null;

  appendChildren(body, [
    h(
      'header',
      { class: 'project-head' },
      metaLine(
        project.role,
        project.year,
        project.featured ? chip('Featured', 'chip-accent') : null,
      ),
      links.length > 0 ? h('div', { class: 'card-links' }, ...links) : null,
    ),
    coverSrc
      ? h('img', {
          class: 'project-cover',
          attrs: { src: coverSrc, alt: `Screenshot of ${title}`, decoding: 'async' },
        })
      : null,
    h('div', { class: 'prose project-summary' }, ...paragraphs.map((text) => h('p', { text }))),
    detail
      ? h(
          'div',
          { class: 'project-story' },
          h('h3', { class: 'project-subtitle', text: 'Problem · Solution · Result' }),
          h(
            'dl',
            { class: 'detail-grid' },
            h('dt', { text: 'Problem' }),
            h('dd', { text: detail.problem }),
            h('dt', { text: 'Solution' }),
            h('dd', { text: detail.solution }),
            h('dt', { text: 'Result' }),
            h('dd', { text: detail.result }),
          ),
        )
      : null,
    project.tech.length > 0
      ? h('div', { class: 'chip-row' }, ...project.tech.map((t) => chip(t, 'chip-muted')))
      : null,
    lightbox
      ? h(
          'div',
          { class: 'project-pictures' },
          h('h3', { class: 'project-subtitle', text: 'Pictures' }),
          h(
            'ul',
            { class: 'project-gallery' },
            ...pictures.map((src, index) => {
              const button = h(
                'button',
                { class: 'gallery-thumb', attrs: { type: 'button' } },
                h('img', {
                  attrs: {
                    src,
                    alt: `${title} — picture ${index + 1}`,
                    loading: 'lazy',
                    decoding: 'async',
                  },
                }),
              );
              button.addEventListener('click', () => lightbox.open(index, button));
              return h('li', {}, button);
            }),
          ),
          lightbox.dialog,
        )
      : null,
  ]);
}

/** Empty the shell again (route exit) — the heading goes blank with it. */
export function clearProjectView(shell: HTMLElement): void {
  const heading = shell.querySelector('#project-view-title');
  const body = shell.querySelector('.project-view-body');
  if (heading) heading.textContent = '';
  if (body) clear(body);
}
