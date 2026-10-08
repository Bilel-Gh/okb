import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { readLastSession } from '../focus/focus.js';
import { listProposals } from '../proposal/store.js';
import { assertNoSecrets } from '../security/guard.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { listTickets } from '../work/tickets.js';

/**
 * « Maintenant » — what the person is on, computed without AI from what OKB
 * already knows: the tickets followed, the dates in the notes, where the last
 * session stopped, the questions waiting for an answer, what waits for a
 * review. Only the objective of the moment is written by the person.
 */
export type Waiting = { readonly id: string; readonly text: string; readonly who: string; readonly since: string };

type NowState = { version: 1; objective: { text: string; since: string } | null; waiting: Waiting[] };

function file(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'brain', 'now.json');
}

async function load(config: OkbConfig): Promise<NowState> {
  return (await readJsonIfExists<NowState>(file(config))) ?? { version: 1, objective: null, waiting: [] };
}

export async function setObjective(config: OkbConfig, text: string | null): Promise<NowState['objective']> {
  const state = await load(config);
  const clean = text?.trim() ?? '';
  if (clean) assertNoSecrets({ text: clean }, 'objective');
  state.objective = clean ? { text: clean.slice(0, 300), since: new Date().toISOString() } : null;
  await writeJsonAtomic(file(config), state);
  return state.objective;
}

/** A question asked to someone, waiting for its answer (« en attente de réponse »). */
export async function addWaiting(config: OkbConfig, text: string, who = ''): Promise<Waiting> {
  const clean = text.trim();
  if (!clean) throw new OkbError('E_INVALID', 'empty question', { key: 'nowEmpty' });
  assertNoSecrets({ text: clean, who }, 'waiting question');
  const state = await load(config);
  const w: Waiting = { id: randomUUID().slice(0, 8), text: clean.slice(0, 300), who: who.trim().slice(0, 80), since: new Date().toISOString() };
  state.waiting.push(w);
  await writeJsonAtomic(file(config), state);
  return w;
}

export async function resolveWaiting(config: OkbConfig, id: string): Promise<Waiting> {
  const state = await load(config);
  const found = state.waiting.find((w) => w.id === id || w.text.toLowerCase().includes(id.toLowerCase()));
  if (!found) throw new OkbError('E_NOT_FOUND', `no waiting question "${id}"`, { key: 'nowUnknownWaiting', params: { id } });
  state.waiting = state.waiting.filter((w) => w !== found);
  await writeJsonAtomic(file(config), state);
  return found;
}

export type Deadline = { readonly path: string; readonly title: string; readonly due: string; readonly days: number };

export type NowView = {
  readonly objective: NowState['objective'];
  readonly tickets: readonly { readonly ref: string; readonly title: string; readonly repos: readonly string[]; readonly updatedAt: string }[];
  readonly deadlines: readonly Deadline[];
  readonly lastSession: { readonly at: string; readonly summary: string; readonly next: string | null } | null;
  readonly waiting: readonly (Waiting & { readonly days: number })[];
  readonly pendingProposals: number;
  /** Filled by other modules (suggestions, reviews to do) when they exist. */
  readonly extra: Readonly<Record<string, number>>;
};

const DAY = 86_400_000;

/** Dates people put in notes: `due:` / `x_okb.due` in the front matter. */
export function deadlinesIn(bundle: Bundle, now = new Date(), horizonDays = 45): Deadline[] {
  const out: Deadline[] = [];
  for (const [path, doc] of bundle.docs) {
    const raw = (doc.data as Record<string, unknown>).due ?? (doc.data.x_okb as Record<string, unknown> | undefined)?.due;
    if (typeof raw !== 'string' && !(raw instanceof Date)) continue;
    const t = raw instanceof Date ? raw.getTime() : Date.parse(raw);
    if (!Number.isFinite(t)) continue;
    const days = Math.ceil((t - now.getTime()) / DAY);
    if (days < -3 || days > horizonDays) continue;
    out.push({ path, title: typeof doc.data.title === 'string' ? doc.data.title : path, due: new Date(t).toISOString().slice(0, 10), days });
  }
  return out.sort((a, b) => a.days - b.days);
}

export async function nowView(config: OkbConfig, bundle: Bundle, extra: Record<string, number> = {}, now = new Date()): Promise<NowView> {
  const [state, tickets, last, proposals] = await Promise.all([
    load(config), listTickets(config).catch(() => []), readLastSession(config).catch(() => null), listProposals(config).catch(() => []),
  ]);
  return {
    objective: state.objective,
    tickets: tickets.filter((t) => t.status === 'active').slice(0, 8).map((t) => ({ ref: t.ref, title: t.title, repos: t.repos.map((r) => r.id), updatedAt: t.updatedAt })),
    deadlines: deadlinesIn(bundle, now),
    lastSession: last ? { at: last.at, summary: last.summary, next: last.next } : null,
    waiting: state.waiting.map((w) => ({ ...w, days: Math.floor((now.getTime() - Date.parse(w.since)) / DAY) })),
    pendingProposals: proposals.filter((p) => p.status === 'prepared' || p.status === 'partially-applied').length,
    extra,
  };
}

/** Maintenant as text: for the terminal, for Claude at the start of a session, for the file view. */
export function renderNow(view: NowView, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr';
  const lines: string[] = [];
  lines.push(`🎯 ${fr ? 'Objectif du moment' : 'Current objective'} : ${view.objective?.text ?? (fr ? '(pas encore fixé — « okb now objective \"…\" »)' : '(not set — `okb now objective "…"`)')}`);
  if (view.tickets.length) {
    lines.push(`🔨 ${fr ? 'En cours' : 'In progress'} :`);
    for (const t of view.tickets) lines.push(`   - ${t.ref}${t.title && t.title !== t.ref ? ` — ${t.title}` : ''}${t.repos.length ? ` (${t.repos.join(', ')})` : ''}`);
  }
  if (view.deadlines.length) {
    lines.push(`⏰ ${fr ? 'Échéances' : 'Deadlines'} :`);
    for (const d of view.deadlines.slice(0, 6)) lines.push(`   - ${d.due} — ${d.title}${d.days < 0 ? (fr ? ' (dépassée)' : ' (overdue)') : d.days === 0 ? (fr ? " (aujourd'hui)" : ' (today)') : ''}`);
  }
  if (view.lastSession) lines.push(`⏸️ ${fr ? 'Où je me suis arrêté' : 'Where I stopped'} : ${view.lastSession.summary}${view.lastSession.next ? ` → ${view.lastSession.next}` : ''}`);
  if (view.waiting.length) {
    lines.push(`⏳ ${fr ? 'En attente de réponse' : 'Waiting for an answer'} :`);
    for (const w of view.waiting) lines.push(`   - ${w.text}${w.who ? ` (${w.who})` : ''} — ${fr ? `depuis ${w.days} j` : `${w.days} d`}${w.days >= 3 ? (fr ? ' · à relancer ?' : ' · follow up?') : ''}`);
  }
  if (view.pendingProposals) lines.push(`📝 ${fr ? `${view.pendingProposals} proposition(s) à relire` : `${view.pendingProposals} proposal(s) to review`}`);
  for (const [k, n] of Object.entries(view.extra)) if (n) lines.push(`• ${k} : ${n}`);
  return lines.join('\n');
}
