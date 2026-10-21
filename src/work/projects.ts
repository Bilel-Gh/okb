import type { OkbConfig } from '../config/schema.js';
import type { EntryKind } from '../projects/journal.js';
import type { ModuleEvent, ModuleWork, PendingRequest, ProjectSeed, ProjectSource, WorkCard } from '../projects/sources.js';
import { ticketSheet } from './ticket-sheet.js';
import { openRequests } from './ticket-requests.js';
import { listRepos } from '../repo/registry.js';
import { listTickets } from './tickets.js';
import { openDb } from '../state/db.js';
import { developerNotesToRecheck } from './freshness.js';
import { loadBundleFor } from '../kb/bundle.js';
import { isSecret } from '../security/confidential.js';
import { asBundlePath } from '../util/paths.js';
import { ticketDetail } from './ticket-state.js';

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
async function work(config: OkbConfig, _env: NodeJS.ProcessEnv, selection?: { kind: string; ref: string }): Promise<ModuleWork[]> {
  const tickets = (await listTickets(config)).filter((t) => !selection || selection.kind === 'ticket' && selection.ref === t.ref);
  return Promise.all(tickets.map(async (t) => {
    const base: ModuleWork = {
    kind: 'ticket', ref: t.ref, title: t.title, status: t.status === 'done' ? 'done' as const : 'active' as const,
    areas: t.repos.map((r) => r.id), startedAt: t.startedAt, updatedAt: t.updatedAt, doneAt: t.doneAt,
    };
    if (!selection) return base;
    const { detail } = await ticketDetail(config, t.ref);
    const states = [...detail.states].sort((a, b) => (a.dimension === 'waiting' ? -1 : b.dimension === 'waiting' ? 1 : (b.at ?? '').localeCompare(a.at ?? ''))).slice(0, 12);
    return { ...base, context: { goal: detail.goal.slice(0, 600), lastAction: detail.lastAction.slice(0, 600), next: detail.next, states: states.map((s) => ({ dimension: s.dimension, environment: s.environment, status: s.status, detail: s.detail.slice(0, 300), at: s.at })), omittedStates: Math.max(0, detail.states.length - states.length), shortenedFields: Number(detail.goal.length > 600) + Number(detail.lastAction.length > 600) + states.filter((s) => s.detail.length > 300).length } };
  }));
}

/** Only what « No blocker » says: « Pas de réponse de Paul » is a blocker. */
const NO_BLOCKER = /^\s*(aucun blocage|aucun|aucune|pas de blocage|rien ne bloque|none|no blocker|nothing blocks)\s*\.?\s*$/i;

/** Today's card of each ticket, read from its sheet (D70). */
async function cards(config: OkbConfig, _env: NodeJS.ProcessEnv, refs: readonly string[]): Promise<Map<string, WorkCard>> {
  const out = new Map<string, WorkCard>();
  for (const ref of refs) {
    const sheet = await ticketSheet(config, ref, 'person', { links: false }).catch(() => null);
    if (!sheet) continue;
    const waiting = sheet.states.find((s) => s.dimension === 'waiting');
    const blockerText = sheet.fields.blocker?.value ?? '';
    const blocked = waiting?.status === 'blocked' || Boolean(blockerText && !NO_BLOCKER.test(blockerText));
    const isWaiting = !blocked && waiting?.status === 'waiting';
    const work = sheet.journey.find((j) => j.id === 'work');
    const current = sheet.journey.findIndex((j) => j.state === 'now' || j.state === 'wait');
    out.set(ref, {
      ref: sheet.ref, title: sheet.title?.value ?? null, next: sheet.next?.text ?? null,
      waitingFor: blocked || isWaiting ? (waiting?.detail || blockerText || null) : null,
      status: sheet.fields.sourceStatus ? { kind: 'source', value: sheet.fields.sourceStatus.value } : blocked ? { kind: 'blocked', value: 'blocked' } : isWaiting ? { kind: 'waiting', value: 'waiting' } : { kind: 'work', value: work?.label ?? 'unknown' },
      percent: sheet.completeness.percent, steps: sheet.journey.filter((j) => j.state === 'done').length, current: current >= 0 ? current : null,
      pinned: sheet.pinned, unblockedAt: waiting?.status === 'none' && waiting.at ? waiting.at : null,
      filter: blocked ? 'blocked' : isWaiting ? 'waiting' : 'progress',
      updatedAt: sheet.history[0]?.at ?? '',
    });
  }
  return out;
}

async function pendingRequests(config: OkbConfig): Promise<PendingRequest[]> {
  return openRequests(config).map((r) => ({ id: r.id, ref: r.ref, fields: r.fields, since: r.createdAt }));
}

export const devProjects: ProjectSource = {
  seeds, events, work, cards, pendingRequests,
  notesToRecheck: developerNotesToRecheck,
  privateNames: async (env) => (await listRepos(env)).map((r) => ({ name: r.name, kind: 'repository' })),
};
