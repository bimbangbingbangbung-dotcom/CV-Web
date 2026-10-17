/**
 * The TypeScript mirror of content.schema.json.
 *
 * These interfaces are the contract every renderer and the edit mode code
 * against. When you add a field to the schema, add it here too (the unit
 * tests flag drift between the two).
 */

export const SCHEMA_VERSION = 1;

export interface Meta {
  schemaVersion: number;
  lastUpdated: string;
}

export interface Analytics {
  provider: 'none' | 'plausible' | 'umami';
  domain: string | null;
}

export interface Site {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImage: string;
  lang: string;
  themeColor?: string;
  analytics: Analytics;
}

export interface Appearance {
  accent: string;
  accentDark: string;
}

export type HeaderMode = 'autohide' | 'always-visible' | 'hidden-until-scroll-up';

export interface HeaderConfig {
  mode: HeaderMode;
  hoverZoneHeight: number;
  hideDelayMs: number;
  showOnLoadHint: boolean;
  discoverabilityHint: boolean;
  showEditLink: boolean;
}

export interface ThemeConfig {
  default: 'system' | 'light' | 'dark';
  toggleShortcut?: string | null;
}

export interface CvConfig {
  path: string;
  label: string;
}

export interface Availability {
  label: string;
  show: boolean;
}

export interface Owner {
  fullName: string;
  headline: string;
  tagline: string;
  shortBio: string;
  longBio?: string | null;
  location: string;
  availability: Availability;
  photo?: string | null;
  initials?: string;
  languages: string[];
  interests: string[];
  now?: { text: string }[];
}

export type SectionId =
  | 'about'
  | 'education'
  | 'skills'
  | 'projects'
  | 'experience'
  | 'achievements'
  | 'publications'
  | 'references'
  | 'contact';

export interface SectionEntry {
  id: SectionId;
  label: string;
  enabled: boolean;
}

export interface Education {
  institution: string;
  degree: string;
  location: string;
  start: string;
  end: string;
  gpa?: string | null;
  coursework?: string[];
  honors?: string[];
}

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** Text labels for skill levels — proficiency is never conveyed by color alone. */
export const LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Working',
  advanced: 'Advanced',
  expert: 'Expert',
};

export interface SkillItem {
  name: string;
  level?: SkillLevel | null;
  note?: string | null;
}

export interface SkillGroup {
  group: string;
  items: SkillItem[];
}

export interface ProjectLink {
  label: string;
  url: string;
  kind?: 'repo' | 'demo' | 'case-study' | 'slides' | 'other';
}

export interface ProjectDetail {
  problem: string;
  solution: string;
  result: string;
}

export interface Project {
  title: string;
  description: string;
  role: string;
  year: string;
  tech: string[];
  links: ProjectLink[];
  image?: string | null;
  /** Extra pictures on the project's detail page (paths or uploaded data: URLs). */
  gallery?: string[];
  featured: boolean;
  detail?: ProjectDetail | null;
}

export type ExperienceType =
  | 'internship'
  | 'part-time'
  | 'full-time'
  | 'freelance'
  | 'volunteer'
  | 'leadership'
  | 'organization';

export interface Experience {
  org: string;
  role: string;
  location: string;
  start: string;
  end: string;
  type?: ExperienceType;
  description: string;
  highlights?: string[];
}

export interface Achievement {
  title: string;
  issuer: string;
  date: string;
  category: 'award' | 'certification' | 'honor' | 'competition';
  url?: string | null;
}

export interface Publication {
  title: string;
  publisher: string;
  date: string;
  url: string;
  note?: string | null;
}

export interface References {
  show: boolean;
  note: string;
}

export interface ContactForm {
  endpoint: string | null;
  honeypot: string;
}

export interface Social {
  platform: 'github' | 'linkedin' | 'x' | 'facebook' | 'kaggle' | 'email' | 'other';
  label: string;
  url: string;
}

export interface Contact {
  email: string;
  form: ContactForm;
  socials: Social[];
}

export interface Admin {
  passcodeSha256: string | null;
  imageMaxKB: number;
}

export interface Footer {
  note: string;
}

export interface Content {
  meta: Meta;
  site: Site;
  appearance: Appearance;
  header: HeaderConfig;
  theme: ThemeConfig;
  cv: CvConfig;
  owner: Owner;
  sections: SectionEntry[];
  education: Education[];
  skills: SkillGroup[];
  projects: Project[];
  experience: Experience[];
  achievements: Achievement[];
  publications?: Publication[];
  references: References;
  contact: Contact;
  admin: Admin;
  footer: Footer;
}
