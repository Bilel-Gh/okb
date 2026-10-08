import { pick } from '../templates/registry.js';
import type { Localized } from '../templates/builtin.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import type { NoteKind } from './questions.js';

/**
 * The repository pack: the notes that, together, let someone start working on
 * a repository they did not know. Each one has a fixed place in the KB
 * (`repos/<id>/…`), a template, and the onboarding questions it answers.
 */
export type PackNote = {
  readonly kind: NoteKind;
  readonly template: string | null;
  readonly file: Localized;
  readonly title: Localized;
  readonly description: Localized;
  readonly emoji: string;
};

export const PACK: readonly PackNote[] = [
  { kind: 'overview', template: 'repo-overview', emoji: '🎯', file: { fr: 'comprendre.md', en: 'overview.md' },
    title: { fr: 'Comprendre {name} en 10 minutes', en: 'Understand {name} in 10 minutes' },
    description: { fr: 'À quoi sert {name}, où il se situe et comment il marche, pour démarrer sans rien connaître.', en: 'What {name} is for, where it sits and how it works, to start from nothing.' } },
  { kind: 'start', template: 'repo-start', emoji: '▶️', file: { fr: 'demarrer.md', en: 'getting-started.md' },
    title: { fr: 'Démarrer sur {name}', en: 'Getting started on {name}' },
    description: { fr: 'Les accès, les outils et les commandes pour installer, lancer, tester et déboguer {name}.', en: 'Access, tools and commands to install, run, test and debug {name}.' } },
  { kind: 'architecture', template: 'repo-architecture', emoji: '🏗️', file: { fr: 'architecture.md', en: 'architecture.md' },
    title: { fr: 'Architecture de {name}', en: '{name} architecture' },
    description: { fr: 'Contexte, modules, flux principaux, données et choix de {name}, schémas reliés au code.', en: 'Context, modules, main flows, data and choices of {name}, diagrams tied to the code.' } },
  { kind: 'interfaces', template: 'repo-interfaces', emoji: '🔌', file: { fr: 'interfaces.md', en: 'interfaces.md' },
    title: { fr: 'Interfaces de {name}', en: '{name} interfaces' },
    description: { fr: 'Ce que {name} expose et ce qu’il appelle : services, routes, destinations, événements, droits.', en: 'What {name} exposes and calls: services, routes, destinations, events, permissions.' } },
  { kind: 'delivery', template: 'repo-delivery', emoji: '🚀', file: { fr: 'livrer-et-exploiter.md', en: 'delivery.md' },
    title: { fr: 'Configurer, livrer et exploiter {name}', en: 'Configure, deliver and operate {name}' },
    description: { fr: 'Configuration, environnements, CI, déploiement et surveillance de {name}.', en: 'Configuration, environments, CI, deployment and monitoring of {name}.' } },
  { kind: 'codemap', template: 'repo-codemap', emoji: '🗺️', file: { fr: 'carte-du-code.md', en: 'code-map.md' },
    title: { fr: 'Carte du code de {name}', en: '{name} code map' },
    description: { fr: 'Qui fait quoi dans {name}, où modifier quoi, conventions, personnes et pièges.', en: 'Who does what in {name}, where changes go, conventions, people and traps.' } },
  { kind: 'questions', template: null, emoji: '❓', file: { fr: 'questions-ouvertes.md', en: 'open-questions.md' },
    title: { fr: '{name} : questions ouvertes et angles morts', en: '{name}: open questions and blind spots' },
    description: { fr: 'Ce que la KB ne sait pas encore sur {name}, où OKB a cherché et à qui demander.', en: 'What the KB does not know yet about {name}, where OKB looked and whom to ask.' } },
];

export const REPOS_FOLDER = 'repos';

/** A repository KB (`kb.kind: repo`) keeps its notes at the root instead of `repos/<id>/`. */
export function isFlat(config: { kb: { kind?: string | undefined } }): boolean {
  return config.kb.kind === 'repo';
}

export function packNote(kind: NoteKind): PackNote {
  const found = PACK.find((p) => p.kind === kind);
  if (!found) throw new Error(`unknown pack note ${kind}`);
  return found;
}

/**
 * Where a repository's notes go. `false`: `repos/<id>/` in a KB of several
 * repositories; `true`: the root of a repository KB (`flat`); a brain place:
 * the repository's folder in its product (`2 Produits/<product>/Code/<repo>`),
 * where the notes are named after the repository (`repo2 — Démarrer.md`) and
 * the overview is the repository's page (`repo2.md`).
 */
export type BrainRepoPlace = { readonly folder: string; readonly name: string; readonly lang: 'fr' | 'en'; readonly tickets: string };
export type RepoPlace = boolean | BrainRepoPlace;

export function isBrainPlace(place: RepoPlace | undefined): place is BrainRepoPlace {
  return typeof place === 'object' && place !== null;
}

export function repoFolder(id: string, place: RepoPlace = false): string {
  if (isBrainPlace(place)) return place.folder;
  return place ? '' : `${REPOS_FOLDER}/${id}`;
}

/** `folder/file`, or `file` at the root. */
export function inRepoFolder(id: string, file: string, place: RepoPlace = false): string {
  const folder = repoFolder(id, place);
  return folder ? `${folder}/${file}` : file;
}

/** Brain file names of the pack: the overview is the repository's page. */
const BRAIN_FILE: Readonly<Record<NoteKind, Localized | null>> = {
  overview: null,
  start: { fr: 'Démarrer', en: 'Getting started' },
  architecture: { fr: 'Architecture', en: 'Architecture' },
  interfaces: { fr: 'Interfaces', en: 'Interfaces' },
  delivery: { fr: 'Livrer', en: 'Delivery' },
  codemap: { fr: 'Carte du code', en: 'Code map' },
  questions: { fr: 'Questions ouvertes', en: 'Open questions' },
};

export function notePath(id: string, kind: NoteKind, language: string, place: RepoPlace = false): BundlePath {
  if (isBrainPlace(place)) {
    const label = BRAIN_FILE[kind];
    const file = label ? `${place.name} — ${place.lang === 'fr' ? label.fr : label.en}.md` : `${place.name}.md`;
    return asBundlePath(`${place.folder}/${file}`);
  }
  return asBundlePath(inRepoFolder(id, pick(packNote(kind).file, language), place));
}

export function noteTitle(kind: NoteKind, name: string, language: string): string {
  return pick(packNote(kind).title, language).replace('{name}', name);
}

export function noteDescription(kind: NoteKind, name: string, language: string): string {
  return pick(packNote(kind).description, language).replaceAll('{name}', name);
}

/**
 * `repos/<id>/tickets/2026-10-04-fix-cancel-order.md` (`tickets/…` in a repository KB);
 * in a brain `…/Code/<repo>/Tickets/2026/ABC-123 — Export CSV.md`, or dated when the title has no reference.
 */
export function ticketPath(id: string, title: string, date = new Date(), place: RepoPlace = false): BundlePath {
  const day = date.toISOString().slice(0, 10);
  if (isBrainPlace(place)) {
    const clean = title.normalize('NFC').replace(/[\\/:*?"<>|#^[\]{}\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).trim() || 'ticket';
    const hasRef = /^[A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7}\b/.test(clean);
    return asBundlePath(`${place.folder}/${place.tickets}/${day.slice(0, 4)}/${hasRef ? clean : `${day} ${clean}`}.md`);
  }
  const slug = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ticket';
  return asBundlePath(inRepoFolder(id, `tickets/${day}-${slug}.md`, place));
}

/** Pack order for reading: overview first, questions last. */
export const READING_ORDER: readonly NoteKind[] = ['overview', 'start', 'architecture', 'codemap', 'interfaces', 'delivery', 'questions'];
