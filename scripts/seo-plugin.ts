/**
 * SEO/discovery build plugin.
 *
 * Reads public/content.json at build time and:
 *  1. injects title/description/canonical/OG/Twitter/JSON-LD into index.html
 *     (so crawlers that don't run JavaScript see real values),
 *  2. writes sitemap.xml, robots.txt and manifest.webmanifest with the same
 *     values (single source of truth — nothing is hardcoded twice),
 *  3. serves those three files in dev mode so nothing 404s while developing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

interface SeoContent {
  site: {
    title: string;
    description: string;
    canonicalUrl: string;
    ogImage: string;
    lang: string;
    themeColor?: string;
  };
  owner: { fullName: string; headline: string; tagline: string; location: string };
  contact: { email: string; socials: { url: string }[] };
  meta: { lastUpdated: string };
}

/** Escape a value for an HTML attribute / text node. */
const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON safe to embed inside a <script> tag (no "</" sequences). */
const jsonLd = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

function buildMetaTags(c: SeoContent): string {
  const abs = (path: string): string => new URL(path, c.site.canonicalUrl).toString();
  const image = abs(c.site.ogImage);
  const tags = [
    `<link rel="canonical" href="${esc(c.site.canonicalUrl)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(c.site.title)}" />`,
    `<meta property="og:title" content="${esc(c.site.title)}" />`,
    `<meta property="og:description" content="${esc(c.site.description)}" />`,
    `<meta property="og:url" content="${esc(c.site.canonicalUrl)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:locale" content="${esc(c.site.lang.replace('-', '_'))}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(c.site.title)}" />`,
    `<meta name="twitter:description" content="${esc(c.site.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  return tags.join('\n    ');
}

function buildJsonLd(c: SeoContent): string {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: c.owner.fullName,
    jobTitle: c.owner.headline,
    description: c.owner.tagline,
    url: c.site.canonicalUrl,
    email: `mailto:${c.contact.email}`,
    address: c.owner.location,
    sameAs: c.contact.socials.map((s) => s.url).filter((u) => u.startsWith('http')),
  });
}

function injectIntoHtml(html: string, c: SeoContent): string {
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(c.site.title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(c.site.description)}" />`,
  );
  const block = `    ${buildMetaTags(c)}\n    <script type="application/ld+json">${buildJsonLd(c)}</script>\n  </head>`;
  return out.replace('</head>', block);
}

function buildSitemap(c: SeoContent): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${esc(c.site.canonicalUrl)}</loc>`,
    `    <lastmod>${esc(c.meta.lastUpdated)}</lastmod>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

function buildRobots(c: SeoContent): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', c.site.canonicalUrl).toString()}\n`;
}

function buildManifest(c: SeoContent): string {
  return `${JSON.stringify(
    {
      name: c.site.title,
      short_name: c.owner.fullName,
      description: c.site.description,
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: c.site.themeColor ?? '#fbfbfa',
      theme_color: c.site.themeColor ?? '#fbfbfa',
      icons: [{ src: './favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    null,
    2,
  )}\n`;
}

export function seoPlugin(): Plugin {
  let config: ResolvedConfig;
  let isBuild = false;

  const loadContent = async (root: string): Promise<SeoContent> =>
    JSON.parse(await readFile(join(root, 'public', 'content.json'), 'utf8')) as SeoContent;

  return {
    name: 'cv-seo',

    configResolved(resolved) {
      config = resolved;
      isBuild = resolved.command === 'build';
    },

    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        if (!isBuild) return html; // dev relies on the runtime pass in seo.ts
        return injectIntoHtml(html, await loadContent(config.root));
      },
    },

    async closeBundle() {
      if (!isBuild) return;
      const content = await loadContent(config.root);
      const outDir = join(config.root, config.build.outDir);
      await Promise.all([
        writeFile(join(outDir, 'sitemap.xml'), buildSitemap(content)),
        writeFile(join(outDir, 'robots.txt'), buildRobots(content)),
        writeFile(join(outDir, 'manifest.webmanifest'), buildManifest(content)),
      ]);
    },

    configureServer(server) {
      // Dev parity: the same generated files without a build step.
      server.middlewares.use((req, res, next) => {
        const route = (req.url ?? '').split('?')[0];
        if (route !== '/manifest.webmanifest' && route !== '/robots.txt' && route !== '/sitemap.xml') {
          next();
          return;
        }
        void loadContent(config.root)
          .then((content) => {
            res.setHeader('Content-Type', route.endsWith('.xml') ? 'application/xml' : 'application/json');
            if (route === '/robots.txt') {
              res.setHeader('Content-Type', 'text/plain');
              res.end(buildRobots(content));
            } else if (route === '/sitemap.xml') {
              res.end(buildSitemap(content));
            } else {
              res.end(buildManifest(content));
            }
          })
          .catch(() => next());
      });
    },
  };
}
