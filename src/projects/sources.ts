import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { enabledModules, type ModuleId } from '../modules/catalog.js';
import { openDb } from '../state/db.js';
import type { EntryKind } from './journal.js';
import { newId, type Project, type ProjectStatus } from './projects.js';

/**
 * What a module brings as projects (F2.0-25): the core does not know tickets
 * or repositories; a module registers a source, the engine's registry wires it
 * (src/engine/registry.ts), and the projects are kept in step with it.
 */
export type ProjectSeed = { readonly kind: string; readonly ref: string; readonly title: string; readonly status: 'active' | 'done'; readonly folder?: string | null; readonly updatedAt?: string };
/** Something that happened on a module's project (a ticket's decision, a commit): a line of its journal. */
export type ModuleEvent = { readonly kind: string; readonly ref: string; readonly at: string; readonly entry: EntryKind; readonly text: string; /** What it touched (a repository). */ readonly area?: string | null };
/** A piece of work a module follows (with the developer module: a ticket), and what it touches (its repositories). */
export type ModuleWork = { readonly kind: string; readonly ref: string; readonly title: string; readonly status: 'active' | 'done'; readonly areas: readonly string[]; readonly startedAt: string; readonly updatedAt: string; readonly doneAt: string | null; /** Bounded operational facts for a contextual assistant; never a note's content. */ readonly context?: { readonly goal: string; readonly lastAction: string; readonly next: string; readonly states: readonly { dimension: string; environment: string | null; status: string; detail: string; at: string | null }[]; readonly omittedStates: number; readonly shortenedFields: number } };
/** A module's dated reason to recheck a note; « doubtful » is not a claim that it is false. */
export type NoteToRecheck = { readonly path: string; readonly title: string; readonly scope: string; readonly verdict: 'changed' | 'stale'; readonly files: readonly string[]; readonly at: string; readonly next: string };
/**
 * What Today shows of a module's work (F2.4-13, D70): its real title or none,
 * its next step or what it waits for, a status, how much is known, how far the
 * journey went. The core does not read it: it orders and passes it on.
 */
export type WorkCard = {
  readonly ref: string;
  readonly title: string | null;
  readonly next: string | null;
  readonly waitingFor: string | null;
  readonly status: { readonly kind: 'source' | 'waiting' | 'blocked' | 'work'; readonly value: string };
  readonly percent: number | null;
  /** Steps done of the work's journey (0 to 5). */
  readonly steps: number;
  readonly current: number | null;
  readonly pinned: boolean;
  readonly unblockedAt: string | null;
  readonly filter: 'progress' | 'waiting' | 'blocked';
  readonly updatedAt: string;
};
/** A question asked to the person's agent about a piece of work, still open. */
export type PendingRequest = { readonly ref: string; readonly fields: readonly string[]; readonly since: string; readonly id: string };

export type ProjectSource = {
  /** Today's cards for these works, by reference. */
  readonly cards?: (config: OkbConfig, env: NodeJS.ProcessEnv, refs: readonly string[]) => Promise<ReadonlyMap<string, WorkCard>>;
  readonly pendingRequests?: (config: OkbConfig, env: NodeJS.ProcessEnv) => Promise<readonly PendingRequest[]>;
  readonly seeds: (config: OkbConfig, env: NodeJS.ProcessEnv) => Promise<readonly ProjectSeed[]>;
  readonly events?: (config: OkbConfig, env: NodeJS.ProcessEnv) => Promise<readonly ModuleEvent[]>;
  readonly work?: (config: OkbConfig, env: NodeJS.ProcessEnv, selection?: { kind: string; ref: string }) => Promise<readonly ModuleWork[]>;
  readonly notesToRecheck?: (config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle) => Promise<readonly NoteToRecheck[]>;
  /** Names that belong to the workplace (repositories…): kept out of what the person takes with them. */
  readonly privateNames?: (env: NodeJS.ProcessEnv) => Promise<readonly { name: string; kind: string }[]>;
};

const SOURCES = new Map<ModuleId, ProjectSource>();

export function registerProjectSource(module: ModuleId, source: ProjectSource): void {
  SOURCES.set(module, source);
}

/**
 * The modules register what they bring in src/modules/wire.ts, the one place
 * that knows them all. It is loaded here on first use, so the core never
 * imports a module and nothing depends on who started the process.
 */
let wired: Promise<unknown> | null = null;
async function sources(env: NodeJS.ProcessEnv): Promise<[ModuleId, ProjectSource][]> {
  await (wired ??= import('../modules/wire.js'));
  const on = await enabledModules(env);
  return [...SOURCES].filter(([module]) => on.has(module));
}

/** The work the modules in use follow: what is in progress, what was finished. */
export async function moduleWork(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, selection?: { kind: string; ref: string }): Promise<ModuleWork[]> {
  const out: ModuleWork[] = [];
  for (const [, source] of await sources(env)) if (source.work) out.push(...(await source.work(config, env, selection).catch(() => [])));
  return out;
}

/** The core asks enabled modules; an unavailable source is explicit rather than a false empty result. */
export async function moduleNotesToRecheck(config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle): Promise<{ notes: NoteToRecheck[]; unavailable: ModuleId[] }> {
  const notes: NoteToRecheck[] = [];
  const unavailable: ModuleId[] = [];
  for (const [module, source] of await sources(env)) {
    if (!source.notesToRecheck) continue;
    try { notes.push(...await source.notesToRecheck(config, env, bundle)); } catch { unavailable.push(module); }
  }
  return { notes: notes.slice(0, 20), unavailable };
}

/** What happened on the work the modules follow, not tied to a project of the person. */
export async function moduleRawEvents(config: OkbConfig, env: NodeJS.ProcessEnv = process.env): Promise<ModuleEvent[]> {
  const out: ModuleEvent[] = [];
  for (const [, source] of await sources(env)) if (source.events) out.push(...(await source.events(config, env).catch(() => [])));
  return out;
}

export async function modulePrivateNames(env: NodeJS.ProcessEnv = process.env): Promise<{ name: string; kind: string }[]> {
  const out: { name: string; kind: string }[] = [];
  for (const [, source] of await sources(env)) if (source.privateNames) out.push(...(await source.privateNames(env).catch(() => [])));
  return out;
}

/** What the modules in use know happened on these projects. */
export async function moduleEvents(config: OkbConfig, env: NodeJS.ProcessEnv, projects: readonly Project[]): Promise<{ project: Project; at: string; kind: EntryKind; text: string }[]> {
  const out: { project: Project; at: string; kind: EntryKind; text: string }[] = [];
  for (const [module, source] of await sources(env)) {
    if (!source.events) continue;
    const mine = new Map(projects.filter((p) => p.module === module && p.ref).map((p) => [`${p.kind}\u0000${p.ref}`, p]));
    if (!mine.size) continue;
    for (const e of await source.events(config, env).catch(() => [])) {
      const project = mine.get(`${e.kind}\u0000${e.ref}`);
      if (project && e.text) out.push({ project, at: e.at, kind: e.entry, text: e.text });
    }
  }
  return out;
}

/**
 * Bring the projects of the modules in use up to date: a new ticket or
 * repository becomes a project, a finished ticket closes its project, a title
 * follows. What the person wrote (where it stands, the next step) is kept.
 */
export async function syncProjects(config: OkbConfig, env: NodeJS.ProcessEnv, now = new Date()): Promise<void> {
  const seeds: (ProjectSeed & { module: ModuleId })[] = [];
  for (const [module, source] of await sources(env)) {
    for (const seed of await source.seeds(config, env).catch(() => [])) seeds.push({ ...seed, module });
  }
  if (!seeds.length) return;
  const db = openDb(config);
  db.tx(() => {
    for (const seed of seeds) {
      const row = db.get<{ id: string; title: string; status: ProjectStatus }>('SELECT id, title, status FROM projects WHERE kind = ? AND ref = ?', seed.kind, seed.ref);
      const at = seed.updatedAt ?? now.toISOString();
      if (!row) {
        db.run('INSERT INTO projects (id, module, kind, title, status, ref, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId('P'), seed.module, seed.kind, seed.title, seed.status, seed.ref, seed.folder ?? null, at, at);
        continue;
      }
      // The module decides done or not; « waiting » is the person's own word while it is open.
      const status: ProjectStatus = seed.status === 'done' ? 'done' : row.status === 'done' ? 'active' : row.status;
      if (row.title !== seed.title || row.status !== status) db.run('UPDATE projects SET title = ?, status = ?, updated_at = ? WHERE id = ?', seed.title, status, now.toISOString(), row.id);
    }
  });
}

/** Today's cards from the modules in use, keyed by `kind:ref`. */
export async function moduleCards(config: OkbConfig, env: NodeJS.ProcessEnv, projects: readonly Project[]): Promise<Map<string, WorkCard>> {
  const out = new Map<string, WorkCard>();
  for (const [module, source] of await sources(env)) {
    if (!source.cards) continue;
    const refs = projects.filter((p) => p.module === module && p.ref).map((p) => p.ref!);
    if (!refs.length) continue;
    const cards = await source.cards(config, env, refs).catch(() => new Map<string, WorkCard>());
    for (const p of projects) if (p.module === module && p.ref && cards.has(p.ref)) out.set(p.id, cards.get(p.ref)!);
  }
  return out;
}

export async function modulePendingRequests(config: OkbConfig, env: NodeJS.ProcessEnv): Promise<PendingRequest[]> {
  const out: PendingRequest[] = [];
  for (const [, source] of await sources(env)) if (source.pendingRequests) out.push(...(await source.pendingRequests(config, env).catch(() => [])));
  return out;
}
