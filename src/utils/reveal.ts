/**
 * Two small, motion-safe page behaviors:
 *
 * 1. Scroll reveal — major blocks fade in (12px rise, 600ms) the first time
 *    they enter the viewport. Pure CSS classes; IO only toggles a flag.
 *    Disabled entirely under prefers-reduced-motion (see components.css).
 * 2. Scroll-spy — highlights the nav link for the section currently in view.
 */

const REVEAL_SELECTOR = '[data-reveal]';

/** Observer from the previous page render (re-entrancy for edit mode). */
let previousObserver: IntersectionObserver | null = null;

/** Add data-reveal to any block that should animate in. */
export function initReveal(root: HTMLElement, options: { instant?: boolean } = {}): void {
  previousObserver?.disconnect(); // stop observing the previous page's nodes
  previousObserver = null;

  const blocks = root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
  const reduced =
    options.instant === true || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || !('IntersectionObserver' in window)) {
    // Show everything instantly — no animation, no hidden content.
    blocks.forEach((block) => block.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target); // reveal once, then disconnect
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  blocks.forEach((block) => observer.observe(block));
  previousObserver = observer;
}

/**
 * Call onLink when the visible section changes. The header uses this to set
 * aria-current on the matching nav link.
 */
export function initScrollSpy(
  sections: HTMLElement[],
  onLink: (activeId: string) => void,
): () => void {
  if (!('IntersectionObserver' in window) || sections.length === 0) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      // Pick the top-most intersecting entry — IO order isn't guaranteed.
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target.id) onLink(visible.target.id);
    },
    { rootMargin: '-35% 0px -55% 0px', threshold: 0 },
  );
  sections.forEach((section) => observer.observe(section));
  return () => observer.disconnect();
}
