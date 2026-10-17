/**
 * Unit tests for the project detail page (#project-<slug> route): the shell
 * the router mounts, the per-project fill (cover, full description, story,
 * chips, links, gallery) and the lightbox wiring.
 */
import { describe, expect, it } from 'vitest';
import {
  clearProjectView,
  fillProjectView,
  projectViewShell,
} from '../../src/render/sections/project-view';
import type { Project } from '../../src/schema/types';

// jsdom doesn't implement dialog.showModal()/close() yet. The lightbox only
// relies on them toggling the `open` property, so stub the minimum here.
{
  const proto = HTMLDialogElement.prototype as HTMLDialogElement;
  if (typeof proto.showModal !== 'function') {
    Object.defineProperty(proto, 'showModal', {
      value: function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
  }
  if (typeof proto.close !== 'function') {
    Object.defineProperty(proto, 'close', {
      value: function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
  }
}

/** Valid strict data URL (safeAssetPath only accepts raster base64 images). */
const PICTURE = 'data:image/jpeg;base64,QUJD';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  title: 'Automated Pet Food Weighing Vending Machine',
  description: 'Line one.\nLine two.',
  role: 'Thesis project — firmware',
  year: '2026',
  tech: ['Arduino', 'C++'],
  links: [{ label: 'Repo', url: 'https://example.com/repo', kind: 'repo' }],
  image: PICTURE,
  gallery: [PICTURE, PICTURE],
  featured: true,
  detail: { problem: 'Problem text', solution: 'Solution text', result: 'Result text' },
  ...overrides,
});

describe('projectViewShell', () => {
  it('starts hidden with a heading and an All projects back link', () => {
    const shell = projectViewShell();
    expect(shell.hidden).toBe(true);
    expect(shell.id).toBe('project-view');
    expect(shell.querySelector('#project-view-title')).not.toBeNull();
    const back = shell.querySelector<HTMLAnchorElement>('.project-back');
    expect(back?.getAttribute('href')).toBe('#projects');
    expect(back?.textContent).toContain('All projects');
  });
});

describe('fillProjectView', () => {
  it('renders the whole project: heading, cover, paragraphs, story, chips, links', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject());
    // Filling never shows the page by itself — the router owns visibility.
    expect(shell.hidden).toBe(true);
    expect(shell.querySelector('#project-view-title')?.textContent).toBe(
      'Automated Pet Food Weighing Vending Machine',
    );

    const body = shell.querySelector('.project-view-body');
    expect(body).not.toBeNull();
    expect(body?.querySelectorAll('.project-summary p')).toHaveLength(2);

    const cover = body?.querySelector<HTMLImageElement>('.project-cover');
    expect(cover?.getAttribute('src')).toBe(PICTURE);
    expect(cover?.alt).toBe('Screenshot of Automated Pet Food Weighing Vending Machine');

    const storyDds = [...(body?.querySelectorAll('.detail-grid dd') ?? [])];
    expect(storyDds.map((dd) => dd.textContent)).toEqual([
      'Problem text',
      'Solution text',
      'Result text',
    ]);
    expect(body?.querySelectorAll('.chip-row .chip')).toHaveLength(2);
    expect(body?.querySelector('.card-links a')?.getAttribute('href')).toBe(
      'https://example.com/repo',
    );
    expect(body?.querySelectorAll('.gallery-thumb')).toHaveLength(2);
    expect(body?.querySelector('dialog.lightbox')).not.toBeNull();
    expect(body?.querySelector('.project-head .chip-accent')?.textContent).toBe('Featured');
  });

  it('omits cover, story and pictures when the project has none', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject({ image: null, gallery: [], detail: null }));
    const body = shell.querySelector('.project-view-body');
    expect(body?.querySelector('.project-cover')).toBeNull();
    expect(body?.querySelector('.project-story')).toBeNull();
    expect(body?.querySelector('.project-pictures')).toBeNull();
  });

  it('drops unsafe picture paths instead of rendering them', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject({ gallery: ['javascript:alert(1)', PICTURE] }));
    expect(shell.querySelectorAll('.gallery-thumb')).toHaveLength(1);
  });

  it('opens the lightbox on a picture click and pages with wrap-around', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject());
    const dialog = shell.querySelector<HTMLDialogElement>('dialog.lightbox');
    const lightboxImg = dialog?.querySelector<HTMLImageElement>('.lightbox-img');
    const thumbs = shell.querySelectorAll<HTMLButtonElement>('.gallery-thumb');
    expect(dialog).not.toBeNull();
    expect(lightboxImg).not.toBeNull();

    thumbs[0]?.click();
    expect(dialog?.open).toBe(true);
    expect(lightboxImg?.getAttribute('alt')).toBe(
      'Automated Pet Food Weighing Vending Machine — picture 1',
    );

    dialog?.querySelector<HTMLButtonElement>('.lightbox-next')?.click();
    expect(lightboxImg?.getAttribute('alt')).toContain('picture 2');

    dialog?.querySelector<HTMLButtonElement>('.lightbox-next')?.click(); // wraps to 1
    expect(lightboxImg?.getAttribute('alt')).toContain('picture 1');

    dialog?.querySelector<HTMLButtonElement>('.lightbox-prev')?.click(); // wraps back to 2
    expect(lightboxImg?.getAttribute('alt')).toContain('picture 2');

    dialog?.querySelector<HTMLButtonElement>('.lightbox-close')?.click();
    expect(dialog?.open).toBe(false);
  });

  it('hides the pager for a single picture', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject({ gallery: [PICTURE] }));
    const dialog = shell.querySelector<HTMLDialogElement>('dialog.lightbox');
    expect(dialog?.querySelector<HTMLButtonElement>('.lightbox-prev')?.hidden).toBe(true);
    expect(dialog?.querySelector<HTMLButtonElement>('.lightbox-next')?.hidden).toBe(true);
    expect(dialog?.querySelector('.lightbox-counter')?.hidden).toBe(true);
  });
});

describe('clearProjectView', () => {
  it('empties the body and the heading again', () => {
    const shell = projectViewShell();
    fillProjectView(shell, makeProject());
    clearProjectView(shell);
    expect(shell.querySelector('#project-view-title')?.textContent).toBe('');
    expect(shell.querySelector('.project-view-body')?.childElementCount).toBe(0);
  });
});
