/**
 * DOM helpers — especially the XSS guarantee: content values must land in
 * textContent, never as parsed markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { h, clear, initialsFrom } from '../../src/utils/dom';

describe('h()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates elements with class, id and text', () => {
    const el = h('p', { class: 'prose', id: 'x', text: 'hello' });
    expect(el.tagName).toBe('P');
    expect(el.className).toBe('prose');
    expect(el.id).toBe('x');
    expect(el.textContent).toBe('hello');
  });

  it('treats angle brackets in content as literal text (no XSS)', () => {
    const el = h('p', { text: '<img src=x onerror=alert(1)>' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('sets attributes from the attrs map and skips false/null', () => {
    const el = h('a', {
      attrs: { href: '#x', 'aria-current': true, download: null, hidden: false },
    });
    expect(el.getAttribute('href')).toBe('#x');
    expect(el.getAttribute('aria-current')).toBe('');
    expect(el.hasAttribute('download')).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
  });

  it('appends nested children and skips empty placeholders', () => {
    const el = h('ul', {}, h('li', { text: 'a' }), null, false, undefined, 0);
    expect(el.children.length).toBe(1); // only the <li> is an element child
    expect(el.childNodes.length).toBe(2); // li + the "0" text node
    expect(el.textContent).toBe('a0');
  });

  it('clear() empties an element', () => {
    const el = h('div', {}, h('span', {}));
    clear(el);
    expect(el.children.length).toBe(0);
  });
});

describe('initialsFrom', () => {
  it('uses first and last name', () => {
    expect(initialsFrom('Juan Miguel Reyes')).toBe('JR');
  });

  it('handles single words and empty strings', () => {
    expect(initialsFrom('Plato')).toBe('PL');
    expect(initialsFrom('   ')).toBe('?');
  });
});
