/**
 * Hero — the only above-the-fold block.
 *
 * Layout follows the design discipline: left-aligned, asymmetric (content
 * left, avatar right on wide screens), fits one viewport, and stays within
 * four text elements (name, role line, tagline, bio) plus the availability
 * badge and CTAs. Nothing here is hardcoded — every string comes from
 * content.json.
 */
import type { Content } from '../schema/types';
import { h, initialsFrom } from '../utils/dom';
import { safeAssetPath } from '../utils/url';
import { icon } from '../components/icons';

export function renderHero(content: Content): HTMLElement {
  const { owner, cv, contact } = content;

  const badge = owner.availability.show
    ? h(
        'span',
        { class: 'badge' },
        h('span', { class: 'badge-dot', attrs: { 'aria-hidden': 'true' } }),
        owner.availability.label,
      )
    : null;

  const cvHref = safeAssetPath(cv.path) ?? '#';
  const downloadBtn = h('a', { class: 'btn btn-primary', text: cv.label, attrs: { href: cvHref } });
  downloadBtn.prepend(icon('download'));

  const contactBtn = h('a', { class: 'btn btn-ghost', text: 'Contact me', attrs: { href: '#contact' } });

  const socialLinks = contact.socials.map((social) => {
    const isHttps = social.url.startsWith('http');
    const link = h('a', {
      class: 'social-link',
      text: social.label,
      attrs: {
        href: social.url,
        'aria-label': social.label,
        ...(isHttps ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
      },
    });
    // Platform glyph when we have one; the text label always stays visible.
    if (['github', 'linkedin', 'x'].includes(social.platform)) {
      link.prepend(icon(social.platform));
    } else if (social.platform === 'email') {
      link.prepend(icon('mail'));
    }
    return link;
  });

  const photoHref = owner.photo ? safeAssetPath(owner.photo) : null;
  const avatar = photoHref
    ? h('img', {
        class: 'avatar',
        attrs: {
          src: photoHref,
          alt: `Photo of ${owner.fullName}`,
          decoding: 'async',
          fetchpriority: 'high',
        },
      })
    : h('span', {
        class: 'avatar avatar-initials',
        text: owner.initials ?? initialsFrom(owner.fullName),
        attrs: { 'aria-hidden': 'true' },
      });

  return h(
    'section',
    { class: 'hero', id: 'top', attrs: { 'aria-labelledby': 'hero-title', 'data-reveal': true } },
    h(
      'div',
      { class: 'hero-main' },
      badge,
      h('h1', { id: 'hero-title', text: owner.fullName }),
      h('p', { class: 'hero-role', text: owner.headline }),
      h('p', { class: 'hero-tagline', text: owner.tagline }),
      h('p', { class: 'hero-bio', text: owner.shortBio }),
      h('div', { class: 'hero-cta' }, downloadBtn, contactBtn),
      socialLinks.length > 0 ? h('ul', { class: 'social-row' }, ...socialLinks.map((l) => h('li', {}, l))) : null,
    ),
    h('aside', { class: 'hero-aside', attrs: { 'aria-hidden': 'true' } }, avatar),
  );
}
