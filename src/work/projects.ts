import type { OkbConfig } from '../config/schema.js';
import type { EntryKind } from '../projects/journal.js';
import type { ModuleEvent, ModuleWork, ProjectSeed, ProjectSource } from '../projects/sources.js';
import { listRepos } from '../repo/registry.js';
import { listTickets } from './tickets.js';
import { openDb } from '../state/db.js';
import { developerNotesToRecheck } from './freshness.js';
import { loadBundleFor } from '../kb/bundle.js';
import { isSecret } from '../security/confidential.js';
import { asBundlePath } from '../util/paths.js';

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
  const db = openDb(config);
  for (const a of db.all<{ ref: string; at: string; approach: string; conditions: string; result: string }>('SELECT ref, at, approach, conditions, result FROM ticket_attempts ORDER BY at')) out.push({ kind: 'ticket', ref: a.ref, at: a.at, entry: 'tried', text: `${a.approach} — ${a.conditions} → ${a.result}` });
  const reuses = db.all<{ ref: string; at: string; path: string; title: string; why: string }>('SELECT ref, at, path, title, why FROM ticket_reuses ORDER BY at');
  if (reuses.length) {
    const bundle = await loadBundleFor(config);
    for (const r of reuses) {
      const e = bundle.byPath.get(asBundlePath(r.path));
      if (e && !isSecret(e.ext)) out.push({ kind: 'ticket', ref: r.ref, at: r.at, entry: 'note', text: `${r.title}${r.why ? ` — ${r.why}` : ''}` });
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
  notesToRecheck: developerNotesToRecheck,
  privateNames: async (env) => (await listRepos(env)).map((r) => ({ name: r.name, kind: 'repository' })),
};
