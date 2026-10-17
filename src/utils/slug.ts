/**
 * URL slugs for the project detail routes (`#project-<slug>`).
 *
 * The slug is derived from the project title, so content.json needs no extra
 * field and links keep working while projects are reordered. Duplicate titles
 * get a numeric suffix — cards and the router both resolve through
 * projectSlugs(), so the href a card renders and the route the hash matches
 * can never disagree. Renaming a project changes its slug; stale links then
 * fall back to the projects list (see main.ts).
 */

/** Lowercase, ASCII-safe, hyphenated slug; 'project' when nothing survives. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents left by NFKD (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** Slugs for a project list, deduped left-to-right ('site', 'site-2', …). */
export function projectSlugs(projects: { title: string }[]): string[] {
  const seen = new Map<string, number>();
  return projects.map((project) => {
    const base = slugify(project.title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}
