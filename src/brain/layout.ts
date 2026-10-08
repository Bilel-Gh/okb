import type { Localized } from '../templates/builtin.js';

/**
 * A brain (OKB 1.0) is a KB organised the same way whatever it holds: five
 * numbered drawers, subjects inside them, and notes inside subjects. The
 * drawers answer one question each, which is how a note finds its place:
 *
 * 0 Inbox     not filed yet
 * 1 World     what is around (a company's ecosystem, ideas, an overview)
 * 2 Subjects  the main subjects (products, projects, topics)
 * 3 Toolbox   how to do things, reusable everywhere
 * 4 Activity  what I do and did (journal, meetings, career)
 *
 * Folder names depend on the preset and on the language of the names; the
 * structure does not.
 */
export const BRAIN_PRESETS = ['work', 'projects', 'topics', 'career'] as const;
export type BrainPreset = (typeof BRAIN_PRESETS)[number];

export const DRAWERS = ['inbox', 'world', 'subjects', 'toolbox', 'activity'] as const;
export type DrawerId = (typeof DRAWERS)[number];

export type NamesLang = 'fr' | 'en';

const L = (fr: string, en: string): Localized => ({ fr, en });

const DRAWER_LABELS: Record<BrainPreset, Record<DrawerId, Localized>> = {
  work: {
    inbox: L('Entrée', 'Inbox'), world: L('Écosystème', 'Ecosystem'), subjects: L('Produits', 'Products'),
    toolbox: L('Boîte à outils', 'Toolbox'), activity: L('Activité', 'Activity'),
  },
  projects: {
    inbox: L('Entrée', 'Inbox'), world: L('Idées', 'Ideas'), subjects: L('Projets', 'Projects'),
    toolbox: L('Boîte à outils', 'Toolbox'), activity: L('Activité', 'Activity'),
  },
  topics: {
    inbox: L('Entrée', 'Inbox'), world: L('Panorama', 'Overview'), subjects: L('Sujets', 'Topics'),
    toolbox: L('Boîte à outils', 'Toolbox'), activity: L('Activité', 'Activity'),
  },
  career: {
    inbox: L('Entrée', 'Inbox'), world: L('Parcours', 'Path'), subjects: L('Compétences', 'Skills'),
    toolbox: L('Apprentissages', 'Learnings'), activity: L('Histoires', 'Stories'),
  },
};

/** What a subject of the second drawer is called: a product, a project, a topic, a skill. */
const SUBJECT_WORD: Record<BrainPreset, Localized> = {
  work: L('produit', 'product'), projects: L('projet', 'project'), topics: L('sujet', 'topic'), career: L('compétence', 'skill'),
};

/** Fixed sub-folders, so every brain of a preset has the same landmarks. */
export const SUB = {
  company: L('Entreprise', 'Company'),
  market: L('Marché', 'Market'),
  domains: L('Domaines', 'Domains'),
  functional: L('Fonctionnel', 'Functional'),
  architecture: L('Architecture', 'Architecture'),
  code: L('Code', 'Code'),
  tickets: L('Tickets', 'Tickets'),
  tasks: L('Tâches', 'Tasks'),
  support: L('Support', 'Support'),
  components: L('Composants', 'Components'),
  methods: L('Méthodes', 'Methods'),
  recipes: L('Recettes', 'Recipes'),
  concepts: L('Concepts', 'Concepts'),
  tools: L('Outils', 'Tools'),
  teamRules: L('Règles d’équipe', 'Team rules'),
  cheatsheets: L('Antisèches', 'Cheat sheets'),
  journal: L('Journal', 'Journal'),
  career: L('Carrière', 'Career'),
  achievements: L('Réalisations', 'Achievements'),
  goals: L('Objectifs', 'Goals'),
  feedback: L('Retours', 'Feedback'),
  reviews: L('Entretiens', 'Reviews'),
  meetings: L('Réunions', 'Meetings'),
  trainings: L('Formations', 'Trainings'),
  readings: L('Lectures', 'Readings'),
  presentations: L('Présentations', 'Presentations'),
  reports: L('Bilans', 'Reports'),
} as const satisfies Record<string, Localized>;
export type SubId = keyof typeof SUB;

/** Root files every brain has. */
export const ROOT_FILES = {
  home: L('Accueil', 'Home'),
  now: L('Maintenant', 'Now'),
  glossary: L('Glossaire', 'Glossary'),
} as const;

/** The shared pseudo-product that holds repositories used by several products. */
export const SHARED_SUBJECT = L('Socle commun', 'Shared foundation');
/** Where a repository goes until it is given its product. */
export const UNSORTED_SUBJECT = L('À classer', 'To sort');

export type BrainLayout = {
  readonly preset: BrainPreset;
  readonly lang: NamesLang;
};

export function pickName(l: Localized, lang: NamesLang): string {
  return lang === 'fr' ? l.fr : l.en;
}

export function drawerIndex(drawer: DrawerId): number {
  return DRAWERS.indexOf(drawer);
}

export function drawerLabel(layout: BrainLayout, drawer: DrawerId): string {
  return pickName(DRAWER_LABELS[layout.preset][drawer], layout.lang);
}

/** `2 Produits`: the folder of a drawer. */
export function drawerFolder(layout: BrainLayout, drawer: DrawerId): string {
  return `${drawerIndex(drawer)} ${drawerLabel(layout, drawer)}`;
}

export function subName(layout: BrainLayout, sub: SubId): string {
  // Personal projects have tasks where a team has tickets.
  if (sub === 'tickets' && layout.preset === 'projects') return pickName(SUB.tasks, layout.lang);
  return pickName(SUB[sub], layout.lang);
}

export function subjectWord(layout: BrainLayout): string {
  return pickName(SUBJECT_WORD[layout.preset], layout.lang);
}

export function rootFile(layout: BrainLayout, file: keyof typeof ROOT_FILES): string {
  return `${pickName(ROOT_FILES[file], layout.lang)}.md`;
}

/** The drawer a top-level folder is, whatever the language or preset of its name. */
export function drawerOfFolder(layout: BrainLayout, folder: string): DrawerId | null {
  for (const d of DRAWERS) if (folder === drawerFolder(layout, d)) return d;
  return null;
}

export function allDrawerFolders(layout: BrainLayout): string[] {
  return DRAWERS.map((d) => drawerFolder(layout, d));
}

/** Read the layout of a KB config, or null when the KB is not a brain yet. */
export function layoutOf(config: { kb: { brain?: { preset: BrainPreset; names?: NamesLang | undefined } | undefined }; writing?: { language?: string | undefined }; profile?: { answer?: { language?: string } } }): BrainLayout | null {
  const brain = config.kb.brain;
  if (!brain) return null;
  const language = brain.names ?? config.writing?.language ?? config.profile?.answer?.language ?? 'en';
  return { preset: brain.preset, lang: language.startsWith('fr') ? 'fr' : 'en' };
}
