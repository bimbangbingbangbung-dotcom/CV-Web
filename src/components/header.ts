/**
 * The auto-hide header ("task bar") and its touch-device companion.
 *
 * Design rules that shape this file (from the brief):
 * - The header is hidden by DEFAULT with transform only — never
 *   display:none/visibility:hidden — so its links stay in the tab order and
 *   assistive tech can always reach them. Focus entering the header reveals
 *   it automatically (:focus-within + JS below).
 * - Desktop: an invisible hover zone at the top edge reveals it; hiding is
 *   delayed so nothing flickers.
 * - Touch (no hover): a small pill handle at the top opens a full-screen
 *   menu; outside click / Escape / link choice closes it.
 * - Shortcuts: M toggles the header, Escape hides it. The theme shortcut
 *   (default T) is handled here too since the toggle lives in the header.
 * - No layout shift: everything is position:fixed and animated with
 *   transform/opacity only.
 */
import type { Content, SectionEntry } from '../schema/types';
import { h, clear, initialsFrom } from '../utils/dom';
import { safeAssetPath } from '../utils/url';
import { icon } from './icons';
import { toggleTheme } from '../utils/theme';
import { initScrollSpy } from '../utils/reveal';

const HINT_SESSION_KEY = 'cvweb:hinted';

interface HeaderHandles {
  header: HTMLElement;
  overlay: HTMLElement;
}

/** True when the event target is a text-entry surface (shortcuts must not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function initHeader(content: Content): HeaderHandles {
  const cfg = content.header;
  const root = document.documentElement;
  root.dataset['headerMode'] = cfg.mode;
  root.style.setProperty('--hover-zone-height', `${cfg.hoverZoneHeight}px`);

  const navSections = content.sections.filter((s: SectionEntry) => s.enabled);
  const initials = content.owner.initials ?? initialsFrom(content.owner.fullName);

  // --- Theme buttons (header + overlay share one sync function) ---
  const themeButtons: HTMLButtonElement[] = [];
  const syncThemeButtons = (): void => {
    const dark = root.dataset['theme'] === 'dark';
    for (const btn of themeButtons) {
      clear(btn);
      btn.append(icon(dark ? 'moon' : 'sun'));
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      btn.setAttribute('aria-pressed', String(dark));
    }
  };
  const makeThemeButton = (): HTMLButtonElement => {
    const btn = h('button', { class: 'icon-btn', attrs: { type: 'button' } });
    btn.addEventListener('click', () => {
      toggleTheme();
      syncThemeButtons();
    });
    themeButtons.push(btn);
    return btn;
  };
  window.addEventListener('cvweb:themechange', syncThemeButtons);

  // --- CV button + edit link (shared markup for header and overlay) ---
  const cvHref = safeAssetPath(content.cv.path) ?? '#';
  const makeCvButton = (class_: string): HTMLAnchorElement => {
    const link = h('a', { class: class_, text: content.cv.label, attrs: { href: cvHref } });
    link.prepend(icon('download'));
    return link;
  };
  const makeNavLink = (section: SectionEntry): HTMLAnchorElement =>
    h('a', { text: section.label, attrs: { href: `#${section.id}` } });
  const makeEditLink = (): HTMLAnchorElement | null =>
    cfg.showEditLink
      ? h('a', { class: 'header-edit', text: 'Edit', attrs: { href: '#admin' } })
      : null;

  // --- Build the header ---
  const navLinks = navSections.map(makeNavLink);
  const themeBtn = makeThemeButton();
  const editLink = makeEditLink();

  const header = h(
    'header',
    { class: 'site-header', id: 'site-header', attrs: { tabindex: '-1' } },
    h(
      'a',
      {
        class: 'header-brand',
        attrs: { href: '#top', 'aria-label': `${content.owner.fullName} — back to top` },
      },
      h('span', { class: 'header-initials', text: initials, attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'header-name', text: content.owner.fullName }),
    ),
    h(
      'nav',
      { class: 'header-nav', attrs: { 'aria-label': 'Primary' } },
      h('ul', {}, ...navLinks.map((link) => h('li', {}, link))),
    ),
    h(
      'div',
      { class: 'header-actions' },
      themeBtn,
      makeCvButton('btn btn-primary btn-sm'),
      editLink,
    ),
  );

  // --- Hover zone (desktop) ---
  const hoverZone = h('div', { class: 'hover-zone', attrs: { 'aria-hidden': 'true' } });

  // --- Touch handle + full-screen menu ---
  const overlayLinks = navSections.map(makeNavLink);
  const overlay = h(
    'div',
    {
      class: 'menu-overlay',
      id: 'site-menu',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Site menu', hidden: true },
    },
    h(
      'div',
      { class: 'menu-panel' },
      h(
        'div',
        { class: 'menu-head' },
        h('span', { class: 'menu-title', text: content.owner.fullName }),
        h(
          'button',
          { class: 'icon-btn menu-close', attrs: { type: 'button', 'aria-label': 'Close menu' } },
          icon('close'),
        ),
      ),
      h(
        'nav',
        { attrs: { 'aria-label': 'Primary' } },
        h('ul', { class: 'menu-links' }, ...overlayLinks.map((l) => h('li', {}, l))),
      ),
      h(
        'div',
        { class: 'menu-actions' },
        makeThemeButton(),
        makeCvButton('btn btn-primary'),
        editLink?.cloneNode(true) ?? null,
      ),
    ),
  );
  const handle = h(
    'button',
    {
      class: 'touch-handle',
      attrs: {
        type: 'button',
        'aria-label': 'Open menu',
        'aria-expanded': 'false',
        'aria-controls': 'site-menu',
      },
    },
    icon('menu'),
  );

  // --- Optional edge hint (thin accent line until first interaction) ---
  const edgeHint = cfg.discoverabilityHint
    ? h('div', { class: 'edge-hint', attrs: { 'aria-hidden': 'true' } })
    : null;

  document.body.append(hoverZone, header, handle, overlay, ...(edgeHint ? [edgeHint] : []));

  // --- Visibility state machine ---
  const mode = cfg.mode;
  let visible = false;
  let hideTimer: number | null = null;

  const cancelHide = (): void => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const setVisible = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    header.classList.toggle('is-visible', next);
  };
  const show = (): void => {
    cancelHide();
    setVisible(true);
  };
  const hide = (): void => {
    cancelHide();
    setVisible(false);
  };
  const scheduleHide = (delay = cfg.hideDelayMs): void => {
    cancelHide();
    hideTimer = window.setTimeout(() => setVisible(false), delay);
  };

  // Hover reveal + delayed hide (autohide and scroll-up modes both use it).
  const hoverBound = mode !== 'always-visible';
  if (hoverBound) {
    for (const zone of [hoverZone, header]) {
      zone.addEventListener('pointerenter', show);
      zone.addEventListener('pointerleave', () => {
        // On touch devices a tap on the handle shouldn't race the timer.
        scheduleHide();
      });
    }
    // Keyboard: focus inside reveals; focus leaving hides after the delay.
    header.addEventListener('focusin', show);
    header.addEventListener('focusout', (event) => {
      const to = event.relatedTarget;
      if (to instanceof Node && header.contains(to)) return;
      scheduleHide();
    });
  }

  // --- Touch menu ---
  let lastFocused: HTMLElement | null = null;
  const overlayFocusables = (): HTMLElement[] =>
    Array.from(overlay.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  const openOverlay = (): void => {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    handle.setAttribute('aria-expanded', 'true');
    show(); // keep the underlying header state consistent
    overlayFocusables()[0]?.focus();
  };
  const closeOverlay = (): void => {
    overlay.classList.remove('is-open');
    handle.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!overlay.classList.contains('is-open')) overlay.hidden = true;
    }, 200);
    (lastFocused ?? handle).focus();
  };
  handle.addEventListener('click', () => (overlay.hidden ? openOverlay() : closeOverlay()));
  overlay.querySelector('.menu-close')?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (event) => {
    // Tap on the dimmed backdrop (not the panel) closes the menu.
    if (event.target === overlay) closeOverlay();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    // Minimal focus trap while the modal menu is open.
    const items = overlayFocusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // --- Nav link behavior (header + overlay): close menu, set focus target ---
  const onNavClick = (event: Event): void => {
    const link = event.currentTarget as HTMLAnchorElement;
    const id = link.getAttribute('href')?.slice(1);
    if (!id) return;
    if (!overlay.hidden) closeOverlay();
    const target = document.getElementById(id);
    if (target) {
      // Move keyboard focus with the click, without a double-scroll jump.
      target.focus({ preventScroll: true });
    }
  };
  for (const link of [...navLinks, ...overlayLinks]) link.addEventListener('click', onNavClick);
  header.querySelector('.header-brand')?.addEventListener('click', onNavClick);

  // --- Keyboard shortcuts: Escape hides, M toggles ---
  window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.key === 'Escape') {
      if (!overlay.hidden) {
        closeOverlay();
      } else if (hoverBound && visible) {
        hide();
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    if (event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!hoverBound) return;
      if (visible) {
        hide();
      } else {
        show();
        navLinks[0]?.focus(); // keyboard users land in the nav, ready to Tab
      }
    }
  });

  // --- Scroll-up mode: reveal when scrolling up near/away from the top ---
  if (mode === 'hidden-until-scroll-up') {
    let lastY = window.scrollY;
    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          const delta = y - lastY;
          lastY = y;
          if (y < 64)
            setVisible(false); // top of the page stays clean
          else if (delta < -4) show();
          else if (delta > 4) scheduleHide(200);
          ticking = false;
        });
      },
      { passive: true },
    );
  }

  // --- First-visit hint: reveal briefly so visitors discover the header ---
  if (mode === 'autohide' && cfg.showOnLoadHint) {
    let hinted = false;
    try {
      hinted = sessionStorage.getItem(HINT_SESSION_KEY) === '1';
    } catch {
      /* private mode — hint every visit is fine */
    }
    if (!hinted) {
      try {
        sessionStorage.setItem(HINT_SESSION_KEY, '1');
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        show();
        window.setTimeout(() => {
          const hovered = header.matches(':hover');
          const focused = header.contains(document.activeElement);
          if (!hovered && !focused) scheduleHide(400);
        }, 2200);
      }, 350);
    }
  }

  // --- Edge hint: fades away on first interaction, forever ---
  if (edgeHint) {
    const dismiss = (): void => {
      edgeHint.classList.add('is-gone');
      window.removeEventListener('pointermove', dismiss);
      window.removeEventListener('scroll', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
    window.addEventListener('pointermove', dismiss, { once: true });
    window.addEventListener('scroll', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
  }

  // --- Scroll-spy: mark the current section in both navs ---
  const sections = navSections
    .map((s) => document.getElementById(s.id))
    .filter((el): el is HTMLElement => el !== null);
  initScrollSpy(sections, (activeId) => {
    for (const link of [...navLinks, ...overlayLinks]) {
      if (link.getAttribute('href') === `#${activeId}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  });

  syncThemeButtons();
  return { header, overlay };
}
