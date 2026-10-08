import { readRootConfig, writeRootConfig } from '../kb/registry.js';
import type { Localized } from '../templates/builtin.js';
import { OkbError } from '../util/errors.js';

/**
 * OKB's modules: the core every person has, and one module per job (developer,
 * devops, sales…) that adds its note types, pages and Claude skills. The engine,
 * the web app and the Claude plugins all ask this catalogue. A module is used
 * when it is enabled (`modules.enabled`, global) and the person is entitled to
 * it; every free module is. A paid module will be checked against a local
 * licence behind `entitled()`, without changing any caller.
 */
export type ModuleId = 'core' | 'dev' | 'devops' | 'sales';
export type ModuleStatus = 'core' | 'available' | 'planned';

export type ModuleDef = {
  readonly id: ModuleId;
  readonly status: ModuleStatus;
  /** The Claude Code plugin of the module, in the `okb` marketplace. */
  readonly plugin: string | null;
  /** Functions of the engine and pages of the web app the module brings. */
  readonly features: readonly string[];
  /** The jobs it is made for. */
  readonly profiles: readonly string[];
  readonly license: 'free' | 'paid';
  readonly emoji: string;
  readonly name: Localized;
  readonly pitch: Localized;
  readonly brings: readonly Localized[];
};

const L = (fr: string, en: string): Localized => ({ fr, en });

export const MODULES: readonly ModuleDef[] = [
  {
    id: 'core', status: 'core', plugin: 'okb', license: 'free', emoji: '🧠', profiles: [],
    features: ['brain', 'notes', 'search', 'suggest', 'learn', 'career', 'journal', 'backup', 'concepts', 'translate', 'metrics', 'graph'],
    name: L('Le cœur', 'The core'),
    pitch: L('Ton cerveau : tiroirs, sujets, notes, recherche, et rien d’écrit sans ton oui.', 'Your brain: drawers, subjects, notes, search, and nothing written without your yes.'),
    brings: [
      L('Cartes de suggestion avant chaque note', 'Suggestion cards before every note'),
      L('Recherche tolérante aux fautes, liens et graphe', 'Typo-tolerant search, links and graph'),
      L('Révision espacée, carrière, journal, sauvegardes', 'Spaced review, career, journal, backups'),
    ],
  },
  {
    id: 'dev', status: 'available', plugin: 'okb-dev', license: 'free', emoji: '💻', profiles: ['dev'],
    features: ['products', 'repos', 'tickets', 'knowledge-level', 'diagrams', 'code'],
    name: L('Développeur', 'Developer'),
    pitch: L('Produits, repos et tickets : comprendre un repo inconnu, suivre un ticket, expliquer le code.', 'Products, repositories and tickets: understand an unknown repository, follow a ticket, explain code.'),
    brings: [
      L('Onboarding d’un repo avec preuves et questions', 'Repository onboarding with evidence and questions'),
      L('Suivi des tickets, déboguer, pré-revue, PR', 'Ticket follow-up, debugging, pre-review, PRs'),
      L('Niveau de connaissance de chaque repo', 'Knowledge level of each repository'),
    ],
  },
  {
    id: 'devops', status: 'planned', plugin: null, license: 'free', emoji: '🛠️', profiles: ['devops'],
    features: ['runbooks', 'incidents', 'postmortems', 'infra'],
    name: L('DevOps', 'DevOps'),
    pitch: L('Runbooks, incidents, post-mortems et infrastructure, reliés aux repos.', 'Runbooks, incidents, post-mortems and infrastructure, tied to the repositories.'),
    brings: [
      L('Runbooks vérifiés pas à pas', 'Step-by-step checked runbooks'),
      L('Incidents et post-mortems qui s’enrichissent', 'Incidents and post-mortems that build up'),
    ],
  },
  {
    id: 'sales', status: 'planned', plugin: null, license: 'free', emoji: '🤝', profiles: ['sales'],
    features: ['accounts', 'clients', 'competitors', 'calls', 'offers'],
    name: L('Commercial', 'Sales'),
    pitch: L('Comptes, clients, concurrents, comptes rendus d’appels et offres.', 'Accounts, clients, competitors, call notes and offers.'),
    brings: [
      L('Une fiche vivante par client', 'A living page per client'),
      L('Comptes rendus d’appels et suivi des offres', 'Call notes and offer follow-up'),
    ],
  },
];

/** Modules on when the person never chose: the developer module stays on for those who already use repositories. */
const DEFAULT_ENABLED: readonly ModuleId[] = ['dev'];

export function moduleDef(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

/** True when the person may use the module: every free one; a paid one with a licence (not sold yet). */
export function entitled(id: ModuleId): boolean {
  const def = moduleDef(id);
  return Boolean(def && def.license === 'free');
}

function chosen(root: unknown): ModuleId[] | null {
  const list = (root as { modules?: { enabled?: unknown } }).modules?.enabled;
  return Array.isArray(list) ? list.filter((x): x is ModuleId => typeof x === 'string' && Boolean(moduleDef(x))) : null;
}

/** The modules in use: the core, plus the enabled modules that are available and entitled. */
export async function enabledModules(env: NodeJS.ProcessEnv = process.env): Promise<Set<ModuleId>> {
  const root = await readRootConfig(env).catch(() => ({}));
  const list = chosen(root) ?? DEFAULT_ENABLED;
  const out = new Set<ModuleId>(['core']);
  for (const id of list) {
    const def = moduleDef(id);
    if (def && def.status === 'available' && entitled(id)) out.add(id);
  }
  return out;
}

/** Is a function of OKB available to this person? */
export async function featureOn(feature: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const on = await enabledModules(env);
  return MODULES.some((m) => on.has(m.id) && m.features.includes(feature));
}

/** Turn a module on or off. The core cannot be turned off; a planned module cannot be turned on. */
export async function setModule(id: ModuleId, on: boolean, env: NodeJS.ProcessEnv = process.env): Promise<Set<ModuleId>> {
  const def = moduleDef(id);
  if (!def || def.status !== 'available' || (on && !entitled(id))) {
    throw new OkbError('E_INVALID', `module "${id}" cannot be ${on ? 'enabled' : 'disabled'}`, { key: 'moduleNotAvailable', params: { id } });
  }
  await writeRootConfig((root) => {
    const current = chosen(root) ?? [...DEFAULT_ENABLED];
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    const modules = { ...((root as { modules?: Record<string, unknown> }).modules ?? {}), enabled: next };
    return { ...root, modules } as typeof root;
  }, env);
  return enabledModules(env);
}
