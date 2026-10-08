import type { Localized } from '../templates/builtin.js';
import type { BrainPreset, DrawerId, SubId } from './layout.js';

/**
 * The register of note types: one table decides, for every kind of note, its
 * drawer and level, its sub-folder, its name, its template, its category, how
 * fast it reads and what it usually costs to write. Claude picks the type and
 * the subject; this table (and src/brain/address.ts) decides the place.
 */
export type Level = 'root' | 'drawer' | 'domain' | 'product' | 'repo';

export type Place = {
  readonly level: Level;
  /** Drawer, for `root` none, for `drawer`/`domain` the drawer used; product and repo live in `subjects`. */
  readonly drawer?: DrawerId;
  /** Sub-folder path inside the level (one or two fixed sub-folders). */
  readonly sub?: readonly SubId[];
};

/**
 * How the file is named:
 * - `hub`: the subject's own page, named like its folder (`Produit A/Produit A.md`);
 * - `subject-type`: `repo2 — Démarrer.md` (one per subject);
 * - `title`: the note's title, prefixed by its subject when the name is taken elsewhere;
 * - `ref-title`: `ABC-123 — Export CSV.md`;
 * - `date-title`: `2026-10-06 Réunion d’architecture.md`;
 * - `year` / `month` / `week`: `2026.md`, `2026-10 Bilan.md`, `2026-S41.md`;
 * - `fixed`: a fixed name (`Grille.md`).
 */
export type NameRule = 'hub' | 'subject-type' | 'title' | 'ref-title' | 'date-title' | 'year' | 'month' | 'week' | 'fixed';

/** Reading speed: 30 seconds, a one-minute card, a five-minute page, or the detail. */
export type Speed = 'brief' | 'card' | 'five' | 'detail';
/** Usual writing cost: a small note (≈2k tokens), a medium one (≈6k), a large one that reads code or sources (≈20k). */
export type Cost = 'small' | 'medium' | 'large';

export type NoteType = {
  readonly id: string;
  readonly label: Localized;
  /** Places this type may take, the default first. */
  readonly places: readonly Place[];
  readonly name: NameRule;
  /** Label used by `subject-type`, `fixed` and `month` names. */
  readonly nameLabel?: Localized;
  /** Filed in a `<year>/` folder (tickets, cases, meetings): big folders stay readable. */
  readonly yearly?: boolean;
  /** Note template (src/templates); null when written freely. */
  readonly template: string | null;
  /** Note category (src/categories). */
  readonly category: string;
  readonly speed: Speed;
  readonly cost: Cost;
  /** Presets where the type exists; absent means every preset. */
  readonly presets?: readonly BrainPreset[];
  /** Computed by OKB without AI (dashboards): never suggested for writing. */
  readonly view?: boolean;
};

const L = (fr: string, en: string): Localized => ({ fr, en });
const at = (level: Level, sub?: SubId | readonly SubId[], drawer?: DrawerId): Place => ({
  level, ...(drawer ? { drawer } : {}), ...(sub ? { sub: Array.isArray(sub) ? sub : [sub as SubId] } : {}),
});
const W = 'world' as const;
const T = 'toolbox' as const;
const A = 'activity' as const;
const WORK: readonly BrainPreset[] = ['work'];
const CODE: readonly BrainPreset[] = ['work', 'projects'];

const def = (id: string, label: Localized, places: Place[], name: NameRule, template: string | null, category: string, speed: Speed, cost: Cost, extra: Partial<NoteType> = {}): NoteType => ({
  id, label, places, name, template, category, speed, cost, ...extra,
});

export const NOTE_TYPES: readonly NoteType[] = [
  // ---- root and hubs ----
  def('home', L('Accueil du cerveau', 'Brain home'), [at('root')], 'fixed', 'subject-five', 'guide', 'five', 'medium', { nameLabel: L('Accueil', 'Home') }),
  def('world-hub', L('Le monde autour en 5 min', 'The world around in 5 min'), [at('drawer', undefined, W)], 'hub', 'subject-five', 'guide', 'five', 'medium'),
  def('domain-hub', L('Domaine en 5 min', 'Domain in 5 min'), [at('domain')], 'hub', 'subject-five', 'guide', 'five', 'medium'),
  def('product-hub', L('Produit en 5 min', 'Product in 5 min'), [at('product')], 'hub', 'subject-five', 'guide', 'five', 'large'),
  def('repo-hub', L('Repo en 5 min', 'Repository in 5 min'), [at('repo')], 'hub', 'repo-overview', 'guide', 'five', 'large', { presets: CODE }),
  def('career-hub', L('Ma carrière en 5 min', 'My career in 5 min'), [at('drawer', 'career', A)], 'fixed', 'subject-five', 'guide', 'five', 'medium', { nameLabel: L('Carrière', 'Career') }),

  // ---- concepts: one-minute cards ----
  def('concept', L('Fiche concept', 'Concept card'), [at('drawer', 'concepts', T), at('domain'), at('product', 'functional')], 'title', 'concept', 'concept', 'card', 'small'),
  def('acronym', L('Sigle', 'Acronym'), [at('drawer', 'concepts', T), at('domain'), at('product', 'functional')], 'title', 'concept', 'concept', 'card', 'small'),

  // ---- 1 World ----
  def('company', L('L’entreprise', 'The company'), [at('drawer', 'company', W)], 'title', 'guide', 'guide', 'five', 'medium', { presets: WORK }),
  def('process', L('Processus interne', 'Internal process'), [at('drawer', 'company', W)], 'title', 'process', 'process', 'detail', 'medium', { presets: WORK }),
  def('internal-tool', L('Outil interne', 'Internal tool'), [at('drawer', 'company', W)], 'title', 'tool', 'process', 'detail', 'small', { presets: WORK }),
  def('team', L('Équipe : qui sait quoi', 'Team: who knows what'), [at('drawer', 'company', W)], 'title', 'team', 'process', 'detail', 'small', { presets: WORK }),
  def('client', L('Client', 'Client'), [at('drawer', 'market', W)], 'title', 'client', 'case', 'detail', 'small', { presets: WORK }),
  def('competitor', L('Concurrent', 'Competitor'), [at('drawer', 'market', W)], 'title', 'competitor', 'guide', 'detail', 'medium', { presets: WORK }),
  def('partner', L('Partenaire', 'Partner'), [at('drawer', 'market', W)], 'title', 'guide', 'guide', 'detail', 'small', { presets: WORK }),
  def('trend', L('Tendance', 'Trend'), [at('drawer', 'market', W)], 'title', 'guide', 'guide', 'detail', 'small', { presets: WORK }),
  def('comparison', L('Comparatif', 'Comparison'), [at('drawer', 'market', W), at('drawer', 'tools', T)], 'title', 'comparison', 'guide', 'detail', 'medium'),
  def('business-rule', L('Règle métier', 'Business rule'), [at('product', 'functional'), at('domain')], 'title', 'business-rule', 'guide', 'detail', 'small'),
  def('idea', L('Idée de projet', 'Project idea'), [at('drawer', undefined, W)], 'title', 'idea', 'guide', 'detail', 'small', { presets: ['projects'] }),
  def('overview', L('Panorama', 'Overview'), [at('drawer', undefined, W)], 'title', 'guide', 'guide', 'five', 'medium', { presets: ['topics'] }),

  // ---- 2 Subjects: product, functional side ----
  def('feature', L('Fonctionnalité', 'Feature'), [at('product', 'functional')], 'title', 'feature', 'guide', 'detail', 'medium'),
  def('user-journey', L('Parcours utilisateur', 'User journey'), [at('product', 'functional')], 'title', 'user-journey', 'guide', 'detail', 'medium'),
  def('config', L('Paramétrage', 'Configuration'), [at('product', 'functional')], 'title', 'procedure', 'howto', 'detail', 'medium', { presets: WORK }),
  def('faq', L('FAQ du produit', 'Product FAQ'), [at('product', 'functional')], 'subject-type', 'guide', 'guide', 'detail', 'small', { nameLabel: L('FAQ', 'FAQ') }),
  def('roadmap', L('Roadmap', 'Roadmap'), [at('product', 'functional')], 'subject-type', 'guide', 'guide', 'detail', 'small', { nameLabel: L('Roadmap', 'Roadmap') }),
  def('first-week', L('Première semaine', 'First week'), [at('product')], 'subject-type', 'first-week', 'path', 'five', 'medium', { nameLabel: L('Première semaine', 'First week'), presets: WORK }),
  def('guide', L('Guide : comprendre un sujet', 'Guide: understand a topic'), [at('product'), at('drawer', undefined, W)], 'title', 'guide', 'guide', 'detail', 'medium'),
  def('path', L('Parcours de lecture', 'Reading path'), [at('product'), at('drawer', undefined, W)], 'title', 'path', 'path', 'five', 'small'),
  def('tutorial', L('Tutoriel', 'Tutorial'), [at('product'), at('drawer', 'methods', T)], 'title', 'tutorial', 'howto', 'detail', 'medium'),

  // ---- 2 Subjects: product, architecture side ----
  def('context', L('Contexte et place', 'Context and place'), [at('product', 'architecture')], 'subject-type', 'arch-context', 'guide', 'five', 'large', { nameLabel: L('Contexte et place', 'Context and place') }),
  def('containers', L('Conteneurs', 'Containers'), [at('product', 'architecture')], 'subject-type', 'arch-containers', 'guide', 'detail', 'large', { nameLabel: L('Conteneurs', 'Containers') }),
  def('flow', L('Flux', 'Flow'), [at('product', 'architecture'), at('repo')], 'title', 'flow', 'guide', 'detail', 'medium'),
  def('data-model', L('Modèle de données', 'Data model'), [at('product', 'architecture'), at('repo')], 'title', 'data-model', 'guide', 'detail', 'medium'),
  def('lifecycle', L('Cycle de vie', 'Lifecycle'), [at('product', 'architecture')], 'title', 'lifecycle', 'guide', 'detail', 'medium'),
  def('decision', L('Décision', 'Decision'), [at('product', 'architecture'), at('repo'), at('drawer', 'teamRules', T)], 'title', 'decision', 'decision', 'detail', 'small'),
  def('strengths', L('Forces et défauts', 'Strengths and weaknesses'), [at('product', 'architecture')], 'subject-type', 'strengths', 'guide', 'detail', 'medium', { nameLabel: L('Forces et défauts', 'Strengths and weaknesses') }),
  def('environments', L('Environnements et accès', 'Environments and access'), [at('product', 'architecture')], 'subject-type', 'environments', 'howto', 'detail', 'medium', { nameLabel: L('Environnements et accès', 'Environments and access'), presets: WORK }),
  def('roles', L('Droits et rôles', 'Permissions and roles'), [at('product', 'architecture')], 'subject-type', 'guide', 'guide', 'detail', 'medium', { nameLabel: L('Droits et rôles', 'Permissions and roles'), presets: WORK }),
  def('timeline', L('Frise et versions', 'Timeline and versions'), [at('product')], 'subject-type', 'guide', 'guide', 'detail', 'small', { nameLabel: L('Frise et versions', 'Timeline and versions') }),

  // ---- 2 Subjects: support ----
  def('known-error', L('Erreur connue', 'Known error'), [at('product', 'support'), at('repo')], 'title', 'known-error', 'case', 'card', 'small', { presets: CODE }),
  def('client-case', L('Cas client', 'Client case'), [at('product', 'support')], 'ref-title', 'client-case', 'case', 'detail', 'medium', { yearly: true, presets: WORK }),
  def('incident', L('Incident et post-mortem', 'Incident and post-mortem'), [at('product', 'support')], 'date-title', 'experience', 'case', 'detail', 'medium', { yearly: true, presets: CODE }),

  // ---- 2 Subjects: a repository ----
  def('repo-start', L('Démarrer', 'Getting started'), [at('repo')], 'subject-type', 'repo-start', 'howto', 'detail', 'large', { nameLabel: L('Démarrer', 'Getting started'), presets: CODE }),
  def('repo-test', L('Tester', 'Testing'), [at('repo')], 'subject-type', 'repo-test', 'howto', 'detail', 'large', { nameLabel: L('Tester', 'Testing'), presets: CODE }),
  def('repo-debug', L('Déboguer', 'Debugging'), [at('repo')], 'subject-type', 'repo-debug', 'howto', 'detail', 'large', { nameLabel: L('Déboguer', 'Debugging'), presets: CODE }),
  def('repo-codemap', L('Carte du code', 'Code map'), [at('repo')], 'subject-type', 'repo-codemap', 'guide', 'detail', 'large', { nameLabel: L('Carte du code', 'Code map'), presets: CODE }),
  def('repo-delivery', L('Livrer et exploiter', 'Deliver and operate'), [at('repo')], 'subject-type', 'repo-delivery', 'howto', 'detail', 'large', { nameLabel: L('Livrer', 'Delivery'), presets: CODE }),
  def('repo-architecture', L('Architecture du repo', 'Repository architecture'), [at('repo')], 'subject-type', 'repo-architecture', 'guide', 'detail', 'large', { nameLabel: L('Architecture', 'Architecture'), presets: CODE }),
  def('repo-interfaces', L('Interfaces', 'Interfaces'), [at('repo')], 'subject-type', 'repo-interfaces', 'guide', 'detail', 'large', { nameLabel: L('Interfaces', 'Interfaces'), presets: CODE }),
  def('repo-questions', L('Questions ouvertes', 'Open questions'), [at('repo')], 'subject-type', null, 'guide', 'detail', 'small', { nameLabel: L('Questions ouvertes', 'Open questions'), presets: CODE }),
  def('component', L('Composant', 'Component'), [at('repo', 'components')], 'title', 'component', 'guide', 'detail', 'medium', { presets: CODE }),
  def('key-file', L('Fichier clé', 'Key file'), [at('repo', 'components')], 'title', 'key-file', 'guide', 'detail', 'small', { presets: CODE }),
  def('simplification', L('Pistes de simplification', 'Simplification ideas'), [at('repo')], 'title', 'simplification', 'guide', 'detail', 'medium', { presets: CODE }),
  def('tech-debt', L('Dette technique', 'Technical debt'), [at('repo')], 'subject-type', 'guide', 'guide', 'detail', 'medium', { nameLabel: L('Dette technique', 'Technical debt'), presets: CODE }),
  def('conventions', L('Conventions du repo', 'Repository conventions'), [at('repo')], 'subject-type', 'process', 'process', 'detail', 'small', { nameLabel: L('Conventions', 'Conventions'), presets: CODE }),
  def('dependencies', L('Dépendances', 'Dependencies'), [at('repo')], 'subject-type', 'guide', 'guide', 'detail', 'medium', { nameLabel: L('Dépendances', 'Dependencies'), presets: CODE }),
  def('ticket', L('Ticket', 'Ticket'), [at('repo', 'tickets'), at('product', 'tickets')], 'ref-title', 'ticket', 'ticket', 'detail', 'medium', { yearly: true, presets: CODE }),
  def('investigation', L('Journal d’enquête', 'Investigation log'), [at('repo', 'tickets'), at('product', 'tickets')], 'ref-title', 'investigation', 'ticket', 'detail', 'medium', { yearly: true, presets: CODE }),

  // ---- 3 Toolbox ----
  def('method', L('Méthode', 'Method'), [at('drawer', 'methods', T)], 'title', 'method', 'howto', 'detail', 'small'),
  def('procedure', L('Procédure', 'Procedure'), [at('drawer', 'methods', T), at('product', 'functional'), at('repo')], 'title', 'procedure', 'howto', 'detail', 'medium'),
  def('recipe', L('Recette', 'Recipe'), [at('drawer', 'recipes', T), at('repo')], 'title', 'recipe', 'howto', 'card', 'small'),
  def('tool', L('Outil', 'Tool'), [at('drawer', 'tools', T)], 'title', 'tool', 'process', 'detail', 'small'),
  def('automation', L('Automatisation', 'Automation'), [at('drawer', 'tools', T)], 'title', 'automation', 'process', 'detail', 'small'),
  def('team-rule', L('Règle d’équipe', 'Team rule'), [at('drawer', 'teamRules', T)], 'title', 'team-rule', 'process', 'card', 'small', { presets: WORK }),
  def('review-lessons', L('Leçons de revue de code', 'Code review lessons'), [at('drawer', 'teamRules', T)], 'title', 'team-rule', 'process', 'detail', 'small', { presets: CODE }),
  def('checklist', L('Checklist', 'Checklist'), [at('drawer', 'cheatsheets', T)], 'title', 'checklist', 'howto', 'card', 'small'),
  def('cheatsheet', L('Antisèche', 'Cheat sheet'), [at('drawer', 'cheatsheets', T)], 'title', 'cheatsheet', 'howto', 'card', 'small'),

  // ---- 4 Activity ----
  def('week', L('Semaine', 'Week'), [at('drawer', 'journal', A)], 'week', null, 'source', 'brief', 'small', { yearly: true, view: true }),
  def('meeting', L('Réunion', 'Meeting'), [at('drawer', 'meetings', A)], 'date-title', 'meeting', 'source', 'detail', 'small', { yearly: true }),
  def('training', L('Formation', 'Training'), [at('drawer', 'trainings', A)], 'title', 'training', 'source', 'detail', 'medium'),
  def('reading', L('Lecture ou vidéo', 'Reading or video'), [at('drawer', 'readings', A)], 'title', 'reading', 'source', 'detail', 'small'),
  def('presentation', L('Présentation', 'Presentation'), [at('drawer', 'presentations', A)], 'date-title', 'presentation', 'source', 'detail', 'medium'),
  def('month-report', L('Bilan du mois', 'Monthly report'), [at('drawer', 'reports', A)], 'month', null, 'source', 'five', 'small', { yearly: true, nameLabel: L('Bilan', 'Report') }),
  def('handover', L('Passation', 'Handover'), [at('drawer', 'reports', A)], 'title', 'handover', 'path', 'five', 'large'),
  def('experience', L('Retour d’expérience', 'Lesson learned'), [at('drawer', 'reports', A), at('product', 'support')], 'title', 'experience', 'case', 'detail', 'small'),

  // ---- 4 Activity: career ----
  def('achievements', L('Réalisations de l’année', 'Achievements of the year'), [at('drawer', ['career', 'achievements'], A)], 'year', 'achievement', 'case', 'detail', 'small'),
  def('goals', L('Objectifs de l’année', 'Goals of the year'), [at('drawer', ['career', 'goals'], A)], 'year', 'goal', 'path', 'detail', 'small'),
  def('feedback', L('Retour reçu', 'Feedback received'), [at('drawer', ['career', 'feedback'], A)], 'date-title', 'feedback', 'case', 'card', 'small'),
  def('one-on-one', L('Entretien individuel', 'One-on-one'), [at('drawer', ['career', 'reviews'], A)], 'date-title', 'one-on-one', 'source', 'detail', 'small'),
  def('annual-review', L('Entretien annuel', 'Annual review'), [at('drawer', ['career', 'reviews'], A)], 'date-title', 'annual-review', 'source', 'detail', 'medium'),
  def('development-plan', L('Plan de développement', 'Development plan'), [at('drawer', 'career', A)], 'fixed', 'development-plan', 'path', 'detail', 'small', { nameLabel: L('Plan de développement', 'Development plan') }),
  def('career-grid', L('Grille de carrière', 'Career grid'), [at('drawer', 'career', A)], 'fixed', null, 'path', 'detail', 'small', { nameLabel: L('Grille', 'Grid') }),

  // ---- the career brain (portable) ----
  def('cv', L('CV vivant', 'Living CV'), [at('drawer', undefined, W)], 'fixed', 'cv', 'path', 'five', 'medium', { nameLabel: L('Parcours', 'Path'), presets: ['career'] }),
  def('story', L('Histoire STAR', 'STAR story'), [at('drawer', undefined, A)], 'title', 'achievement', 'case', 'detail', 'small', { presets: ['career'] }),
  def('skill', L('Compétence', 'Skill'), [at('product')], 'hub', 'subject-five', 'path', 'five', 'small', { presets: ['career'] }),
  def('learning', L('Apprentissage', 'Learning'), [at('drawer', undefined, T)], 'title', 'method', 'howto', 'detail', 'small', { presets: ['career'] }),

  // ---- 0 Inbox ----
  def('capture', L('Capture rapide', 'Quick capture'), [at('drawer', undefined, 'inbox')], 'date-title', null, 'source', 'brief', 'small'),
];

const BY_ID = new Map(NOTE_TYPES.map((n) => [n.id, n]));

export function noteType(id: string): NoteType | undefined {
  return BY_ID.get(id);
}

export function typesFor(preset: BrainPreset): NoteType[] {
  return NOTE_TYPES.filter((n) => !n.presets || n.presets.includes(preset));
}

/** Approximate tokens a type costs to write, for the suggestion cards (src/suggest). */
export const COST_TOKENS: Readonly<Record<Cost, number>> = { small: 2_000, medium: 6_000, large: 20_000 };
