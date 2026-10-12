/**
 * Document-level SEO and discoverability, driven entirely by content.json.
 *
 * The production build additionally injects these tags into index.html at
 * build time (see vite.config.ts) so social crawlers that don't run
 * JavaScript still see them. This runtime pass keeps dev mode in sync and
 * covers the theme-color/lang edges.
 */
import type { Content } from '../schema/types';

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.append(tag);
  }
  tag.setAttribute('content', content);
}

function setLink(rel: string, href: string): void {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.append(tag);
  }
  tag.setAttribute('href', href);
}

/** Person structured data for search engines. */
function personJsonLd(content: Content): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: content.owner.fullName,
    jobTitle: content.owner.headline,
    description: content.owner.tagline,
    url: content.site.canonicalUrl,
    email: `mailto:${content.contact.email}`,
    address: content.owner.location,
    sameAs: content.contact.socials.map((s) => s.url).filter((u) => u.startsWith('http')),
  });
}

function injectJsonLd(json: string): void {
  let script = document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    document.head.append(script);
  }
  // JSON in a script tag is inert (not executed); textContent keeps it escaped.
  script.textContent = json;
}

/** Privacy-friendly analytics — only injected when content opts in. */
function applyAnalytics(content: Content): void {
  const { provider, domain } = content.site.analytics;
  if (provider === 'none' || !domain) return;
  if (document.head.querySelector('script[data-analytics]')) return;

  const script = document.createElement('script');
  script.setAttribute('data-analytics', provider);
  script.defer = true;
  if (provider === 'plausible') {
    script.src = 'https://plausible.io/js/script.js';
    script.dataset['domain'] = domain;
  } else {
    script.src = 'https://cloud.umami.is/script.js';
    script.dataset['websiteId'] = domain;
  }
  document.head.append(script);
}

/** Apply every content-driven document setting. Called once at boot. */
export function updateDocumentMeta(content: Content): void {
  document.title = content.site.title;
  document.documentElement.lang = content.site.lang;
  setMeta('name', 'description', content.site.description);
  setMeta('property', 'og:title', content.site.title);
  setMeta('property', 'og:description', content.site.description);
  setMeta('property', 'og:url', content.site.canonicalUrl);
  setMeta(
    'property',
    'og:image',
    new URL(content.site.ogImage, content.site.canonicalUrl).toString(),
  );
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', content.site.title);
  setMeta('name', 'twitter:description', content.site.description);
  setLink('canonical', content.site.canonicalUrl);
  injectJsonLd(personJsonLd(content));
  applyAnalytics(content);
}
