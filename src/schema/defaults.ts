/**
 * Built-in fallback content.
 *
 * If public/content.json is missing, malformed AND no last-known-good
 * snapshot exists in localStorage, the site renders this minimal content
 * instead of a blank page — always accompanied by the error banner, so the
 * visitor (and the owner) sees exactly what happened.
 */
import type { Content } from './types';
import { SCHEMA_VERSION } from './types';

export const DEFAULT_CONTENT: Content = {
  meta: { schemaVersion: SCHEMA_VERSION, lastUpdated: '2026-01-01' },
  site: {
    title: 'Curriculum Vitae',
    description: 'Personal curriculum vitae website.',
    canonicalUrl: 'https://example.com/',
    ogImage: './assets/og-image.png',
    lang: 'en',
    themeColor: '#fbfbfa',
    analytics: { provider: 'none', domain: null },
  },
  appearance: { accent: '#0f6d66', accentDark: '#5cc5ba' },
  header: {
    mode: 'autohide',
    hoverZoneHeight: 56,
    hideDelayMs: 500,
    showOnLoadHint: true,
    discoverabilityHint: false,
    showEditLink: true,
  },
  theme: { default: 'system', toggleShortcut: 'T' },
  cv: { path: '/assets/cv.pdf', label: 'Download CV' },
  owner: {
    fullName: 'Your Name',
    headline: 'Computer Engineering Student',
    tagline: 'This page is showing built-in fallback content.',
    shortBio: 'public/content.json could not be loaded. Replace it with your own content to restore the site.',
    location: 'Your City, Country',
    availability: { label: 'Open to opportunities', show: true },
    photo: null,
    languages: [],
    interests: [],
  },
  sections: [
    { id: 'about', label: 'About', enabled: true },
    { id: 'contact', label: 'Contact', enabled: true },
  ],
  education: [],
  skills: [],
  projects: [],
  experience: [],
  achievements: [],
  publications: [],
  references: { show: false, note: 'Available on request.' },
  contact: { email: 'you@example.com', form: { endpoint: null, honeypot: 'company' }, socials: [] },
  admin: { passcodeSha256: null, imageMaxKB: 512 },
  footer: { note: 'Built-in fallback content.' },
};
