/**
 * Page orchestrator: builds the whole document from validated content.
 *
 * Rendering order = the owner's `sections` order; disabled sections and
 * sections with no data return null and disappear entirely (see the
 * per-section renderers). The hero and footer always render.
 */
import type { Content, SectionId } from '../schema/types';
import { h, clear } from '../utils/dom';
import { renderHero } from './sections/hero';
import { renderAbout } from './sections/about';
import { renderEducation } from './sections/education';
import { renderSkills } from './sections/skills';
import { renderProjects } from './sections/projects';
import { renderExperience } from './sections/experience';
import { renderAchievements } from './sections/achievements';
import { renderPublications } from './sections/publications';
import { renderReferences } from './sections/references';
import { renderContact } from './sections/contact';
import { renderFooter } from './sections/footer';

type SectionRenderer = (content: Content) => HTMLElement | null;

const SECTION_RENDERERS: Record<SectionId, SectionRenderer> = {
  about: renderAbout,
  education: renderEducation,
  skills: renderSkills,
  projects: renderProjects,
  experience: renderExperience,
  achievements: renderAchievements,
  publications: renderPublications,
  references: renderReferences,
  contact: renderContact,
};

/** Mount the page. Returns the <main> element (the header needs it). */
export function renderPage(content: Content): HTMLElement {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app mount point is missing from index.html');
  clear(app);

  const main = h('main', { id: 'main', attrs: { tabindex: '-1' } });
  main.append(renderHero(content));

  for (const entry of content.sections) {
    if (!entry.enabled) continue;
    const renderer = SECTION_RENDERERS[entry.id];
    if (!renderer) continue;
    const section = renderer(content);
    if (section) main.append(section);
  }

  app.append(main, renderFooter(content));
  return main;
}
