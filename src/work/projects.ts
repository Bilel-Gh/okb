import type { OkbConfig } from '../config/schema.js';
import type { EntryKind } from '../projects/journal.js';
import type { ModuleEvent, ModuleWork, ProjectSeed, ProjectSource } from '../projects/sources.js';
import { listRepos } from '../repo/registry.js';
import { listTickets } from './tickets.js';

/** The developer module's projects: the repositories of this KB and its tickets. */
async function seeds(config: OkbConfig, env: NodeJS.ProcessEnv): Promise<ProjectSeed[]> {
  const repos = (await listRepos(env)).filter((r) => r.kb === config.profile.id);
  const tickets = await listTickets(config);
  return [
    ...repos.map((r): ProjectSeed => ({ kind: 'repo', ref: r.id, title: r.name, status: 'active', updatedAt: r.addedAt })),
    ...tickets.map((t): ProjectSeed => ({ kind: 'ticket', ref: t.ref, title: t.title, status: t.status === 'done' ? 'done' : 'active', updatedAt: t.updatedAt })),
  ];
}

const ENTRY: Record<string, EntryKind> = { note: 'note', decision: 'decision', trap: 'trap', question: 'question', commit: 'commit' };

/** What happened on the tickets: their notes, decisions, traps, questions and commits. */
async function events(config: OkbConfig): Promise<ModuleEvent[]> {
  const out: ModuleEvent[] = [];
  for (const t of await listTickets(config)) {
    for (const j of t.journal) {
      const entry = ENTRY[j.kind];
      if (entry && j.text) out.push({ kind: 'ticket', ref: t.ref, at: j.at, entry, text: j.text, area: j.repo ?? null });
    }
  }
  return out;
}

/** The tickets, as work in progress or finished, with the repositories each one touches. */
async function work(config: OkbConfig): Promise<ModuleWork[]> {
  return (await listTickets(config)).map((t) => ({
    kind: 'ticket', ref: t.ref, title: t.title, status: t.status === 'done' ? 'done' as const : 'active' as const,
    areas: t.repos.map((r) => r.id), startedAt: t.startedAt, updatedAt: t.updatedAt, doneAt: t.doneAt,
  }));
}

export const devProjects: ProjectSource = {
  seeds, events, work,
  privateNames: async (env) => (await listRepos(env)).map((r) => ({ name: r.name, kind: 'repository' })),
};
