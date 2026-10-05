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
 * Where a repository's notes go: `repos/<id>/` in a KB of several repositories,
 * the root of the KB in a repository KB (`flat`).
 */
export function repoFolder(id: string, flat = false): string {
  return flat ? '' : `${REPOS_FOLDER}/${id}`;
}

/** `folder/file`, or `file` at the root. */
export function inRepoFolder(id: string, file: string, flat = false): string {
  const folder = repoFolder(id, flat);
  return folder ? `${folder}/${file}` : file;
}

export function notePath(id: string, kind: NoteKind, language: string, flat = false): BundlePath {
  return asBundlePath(inRepoFolder(id, pick(packNote(kind).file, language), flat));
}

export function noteTitle(kind: NoteKind, name: string, language: string): string {
  return pick(packNote(kind).title, language).replace('{name}', name);
}

export function noteDescription(kind: NoteKind, name: string, language: string): string {
  return pick(packNote(kind).description, language).replaceAll('{name}', name);
}

/** `repos/<id>/tickets/2026-10-04-fix-cancel-order.md` (`tickets/…` in a repository KB) */
export function ticketPath(id: string, title: string, date = new Date(), flat = false): BundlePath {
  const slug = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ticket';
  return asBundlePath(inRepoFolder(id, `tickets/${date.toISOString().slice(0, 10)}-${slug}.md`, flat));
}

/** Pack order for reading: overview first, questions last. */
export const READING_ORDER: readonly NoteKind[] = ['overview', 'start', 'architecture', 'codemap', 'interfaces', 'delivery', 'questions'];
