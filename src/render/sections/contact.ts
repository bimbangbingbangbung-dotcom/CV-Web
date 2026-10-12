/**
 * Contact — email with one-click copy, social links and an optional
 * endpoint-backed form (Formspree/Web3Forms style).
 *
 * No endpoint configured? The form is not rendered at all; a plain mailto
 * CTA is shown instead. The form itself ships with:
 * - honeypot spam field (visually hidden, skipped by keyboards/AT),
 * - inline validation with aria-invalid + aria-describedby,
 * - loading / success / error states announced via role="status".
 */
import type { Content } from '../../schema/types';
import { h, clear } from '../../utils/dom';
import { icon } from '../../components/icons';
import { labelOf, sectionShell } from '../common';

function emailRow(content: Content): HTMLElement {
  const email = content.contact.email;
  const status = h('span', { class: 'copy-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  const copyBtn = h(
    'button',
    { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Copy email address ${email}` } },
    icon('copy'),
  );
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(email);
      clear(copyBtn);
      copyBtn.append(icon('check'));
      status.textContent = 'Copied to clipboard';
      window.setTimeout(() => {
        clear(copyBtn);
        copyBtn.append(icon('copy'));
        status.textContent = '';
      }, 2400);
    } catch {
      // Clipboard blocked (permissions/insecure context) — select the text instead.
      status.textContent = 'Press Ctrl+C to copy';
    }
  });

  return h(
    'div',
    { class: 'email-row' },
    icon('mail'),
    h('a', { class: 'email-link', text: email, attrs: { href: `mailto:${email}` } }),
    copyBtn,
    status,
  );
}

function socialList(content: Content): HTMLElement | null {
  const socials = content.contact.socials;
  if (socials.length === 0) return null;
  return h(
    'ul',
    { class: 'social-row contact-socials' },
    ...socials.map((social) => {
      const isHttps = social.url.startsWith('http');
      const link = h('a', {
        class: 'social-link',
        text: social.label,
        attrs: {
          href: social.url,
          ...(isHttps ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
      });
      if (['github', 'linkedin', 'x'].includes(social.platform)) link.prepend(icon(social.platform));
      else if (social.platform === 'email') link.prepend(icon('mail'));
      return h('li', {}, link);
    }),
  );
}

interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea';
  autocomplete?: string;
}

const FORM_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', autocomplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
  { name: 'message', label: 'Message', type: 'textarea' },
];

function contactForm(content: Content): HTMLElement {
  const endpoint = content.contact.form.endpoint;
  const honeypot = content.contact.form.honeypot || 'company';
  const status = h('p', { class: 'form-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  const errorEls: Record<string, HTMLElement> = {};

  const fieldEls = FORM_FIELDS.map((spec) => {
    const input =
      spec.type === 'textarea'
        ? h('textarea', { attrs: { id: `cf-${spec.name}`, name: spec.name, rows: '5', required: true } })
        : h('input', {
            attrs: {
              id: `cf-${spec.name}`,
              name: spec.name,
              type: spec.type,
              required: true,
              ...(spec.autocomplete ? { autocomplete: spec.autocomplete } : {}),
            },
          });
    inputs[spec.name] = input;
    const error = h('p', { class: 'field-error', id: `cf-${spec.name}-error` });
    errorEls[spec.name] = error;
    input.setAttribute('aria-describedby', `cf-${spec.name}-error`);
    return h(
      'div',
      { class: 'field' },
      h('label', { text: spec.label, attrs: { for: `cf-${spec.name}` } }),
      input,
      error,
    );
  });

  const submit = h('button', { class: 'btn btn-primary', text: 'Send message', attrs: { type: 'submit' } });

  const form = h(
    'form',
    { class: 'contact-form', attrs: { novalidate: true } },
    ...fieldEls,
    // Honeypot: hidden from eyes, keyboards and screen readers.
    h(
      'div',
      { class: 'honeypot', attrs: { 'aria-hidden': 'true' } },
      h('label', { text: 'Leave this field empty', attrs: { for: 'cf-website' } }),
      h('input', { attrs: { id: 'cf-website', name: honeypot, type: 'text', tabindex: '-1', autocomplete: 'off' } }),
    ),
    status,
    submit,
  );

  const validate = (): boolean => {
    let ok = true;
    for (const spec of FORM_FIELDS) {
      const input = inputs[spec.name]!;
      const value = input.value.trim();
      let message = '';
      if (!value) message = `${spec.label} is required`;
      else if (spec.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = 'Enter a valid email address';
      if (message) {
        ok = false;
        input.setAttribute('aria-invalid', 'true');
        errorEls[spec.name]!.textContent = message;
      } else {
        input.removeAttribute('aria-invalid');
        errorEls[spec.name]!.textContent = '';
      }
    }
    return ok;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!endpoint) return;
    if (!validate()) {
      status.textContent = 'Please fix the highlighted fields.';
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';
    status.textContent = '';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Success state: replace the form so nobody submits twice.
      const panel = h(
        'div',
        { class: 'form-success' },
        icon('check'),
        h('h3', { class: 'item-title', text: 'Message sent' }),
        h('p', { class: 'prose', text: 'Thanks for reaching out — I will get back to you soon.' }),
      );
      form.replaceWith(panel);
      panel.setAttribute('tabindex', '-1');
      panel.focus();
    } catch {
      submit.disabled = false;
      submit.textContent = 'Send message';
      status.textContent = `Something went wrong — please email me directly at ${content.contact.email}.`;
    }
  });

  return form;
}

export function renderContact(content: Content): HTMLElement {
  const hasForm = Boolean(content.contact.form.endpoint);
  return sectionShell(
    'contact',
    labelOf(content, 'contact'),
    h(
      'div',
      { class: 'contact-grid' },
      h(
        'div',
        { class: 'contact-main' },
        h('p', { class: 'prose', text: 'The fastest way to reach me:' }),
        emailRow(content),
        socialList(content),
      ),
      hasForm ? contactForm(content) : null,
    ),
  );
}
