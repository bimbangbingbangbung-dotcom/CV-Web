/**
 * Footer — copyright (year auto-generated), last-updated date from JSON,
 * note, back-to-top and the subtle Edit link.
 */
import type { Content } from '../../schema/types';
import { h } from '../../utils/dom';
import { icon } from '../../components/icons';

export function renderFooter(content: Content): HTMLElement {
  const year = new Date().getFullYear();
  const lastUpdated = h('time', {
    class: 'mono',
    text: content.meta.lastUpdated,
    attrs: { datetime: content.meta.lastUpdated },
  });

  const backToTop = h(
    'button',
    { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Back to top' } },
    icon('arrow-up'),
  );
  backToTop.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  });

  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'footer-inner' },
      h(
        'p',
        { class: 'footer-meta' },
        `© ${year} ${content.owner.fullName}`,
        h('span', { class: 'meta-dot', text: '·', attrs: { 'aria-hidden': 'true' } }),
        h('span', {}, 'Last updated ', lastUpdated),
      ),
      h('p', { class: 'footer-note', text: content.footer.note }),
      h(
        'div',
        { class: 'footer-actions' },
        content.header.showEditLink
          ? h('a', { class: 'footer-edit', text: 'Edit', attrs: { href: '#admin' } })
          : null,
        backToTop,
      ),
    ),
  );
}
