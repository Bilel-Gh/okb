import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { person } from '../identity/person.js';
import { addressFor, breadcrumb, type AddressInput } from '../brain/address.js';
import { layoutOf } from '../brain/layout.js';
import { listTickets } from '../work/tickets.js';
import { COST_TOKENS, noteType } from '../brain/types.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { normalizeSurface, searchBundle } from '../kb/search.js';
import { readRootConfig } from '../kb/registry.js';
import { assertNoSecrets } from '../security/guard.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import type { BundlePath } from '../util/paths.js';

/**
 * Suggestions: what OKB offers to write, before a single token is spent on
 * writing. A card says the type, the exact place, why, what already covers it,
 * a recommendation, a pertinence out of 100 and the estimated cost. Nothing is
 * written until the person accepts it (src/suggest/consent.ts records their
 * yes); the writing commands refuse a new note in a brain without an accepted
 * suggestion when Claude runs them.
 */
export type Signal = 'asked' | 'unknown' | 'solved' | 'decision' | 'requested' | 'repeat' | 'review' | 'session' | 'ticket' | 'concept' | 'search' | 'inbox';
export type Recommendation = 'create' | 'complete' | 'link' | 'nothing';
export type SuggestionStatus = 'pending' | 'accepted' | 'declined' | 'later' | 'done' | 'expired';

export type Pertinence = { readonly total: number; readonly novelty: number; readonly utility: number; readonly reuse: number; readonly signal: number };

export type Suggestion = {
  readonly id: string;
  readonly createdAt: string;
  readonly type: string;
  readonly title: string;
  readonly input: AddressInput;
  readonly path: BundlePath | null;
  readonly breadcrumb: string;
  readonly why: string;
  readonly signal: Signal;
  readonly source: string;
  readonly overlaps: readonly { readonly path: BundlePath; readonly title: string; readonly score: number }[];
  readonly recommendation: Recommendation;
  /** The note to complete or link, when the recommendation is not a new note. */
  readonly target: BundlePath | null;
  readonly pertinence: Pertinence;
  readonly cost: { readonly size: 'small' | 'medium' | 'large'; readonly tokens: number; readonly notes: number };
  /** The acceptance covers notes under this folder (a pack: a repository's pages). */
  readonly scope: string | null;
  readonly status: SuggestionStatus;
  readonly decidedAt?: string;
  readonly decidedBy?: 'person' | 'consent' | 'terminal';
  /** The person's stable id (src/identity/person.ts) when a person decided. */
  readonly decidedPerson?: string;
  readonly proposalIds?: readonly string[];
  readonly shownAt?: string;
};

type Queue = { version: 1; items: Suggestion[] };

const KEEP_DAYS = 14;
const DAY = 86_400_000;

function file(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'suggest', 'queue.json');
}

export async function loadQueue(config: OkbConfig, now = new Date()): Promise<Suggestion[]> {
  const q = (await readJsonIfExists<Queue>(file(config)).catch(() => null)) ?? { version: 1, items: [] };
  // Pending cards are forgotten after 14 days; decided ones stay for the record a little longer.
  return q.items.map((s) => (s.status === 'pending' || s.status === 'later') && now.getTime() - Date.parse(s.createdAt) > KEEP_DAYS * DAY ? { ...s, status: 'expired' as const } : s)
    .filter((s) => now.getTime() - Date.parse(s.createdAt) < 90 * DAY);
}

async function saveQueue(config: OkbConfig, items: readonly Suggestion[]): Promise<void> {
  await writeJsonAtomic(file(config), { version: 1, items });
}

/** Words of a title worth searching for (for the overlap and the reuse). */
function key(title: string): string {
  return normalizeSurface(title);
}

const SIGNAL_POINTS: Readonly<Record<Signal, number>> = {
  asked: 15, requested: 15, unknown: 12, solved: 10, decision: 10, review: 10, repeat: 8, search: 8, ticket: 6, session: 6, concept: 5, inbox: 6,
};
const USEFUL_TYPES = new Set(['concept', 'acronym', 'known-error', 'recipe', 'method', 'decision', 'business-rule', 'team-rule', 'review-lessons', 'repo-debug', 'repo-start', 'repo-test']);
/** Every signal OKB knows, for checking what a command was given. */
export const SIGNALS = Object.keys(SIGNAL_POINTS) as Signal[];

export type SuggestInput = {
  readonly type: string;
  readonly title: string;
  readonly product?: string;
  readonly repo?: string;
  readonly theme?: string;
  readonly ref?: string;
  readonly date?: string;
  readonly level?: AddressInput['level'];
  readonly why: string;
  readonly signal?: Signal;
  readonly source?: string;
  /** A pack: the acceptance covers several notes under this folder. */
  readonly scope?: string;
  readonly notes?: number;
};

export type SuggestContext = {
  readonly bundle: Bundle;
  readonly focusWords?: readonly string[];
  readonly activeRepos?: readonly string[];
};

/** Pertinence, without AI: is it new, useful now, coming back, asked for? */
export function pertinence(input: SuggestInput, overlaps: Suggestion['overlaps'], ctx: SuggestContext, mentions: number): Pertinence {
  const top = overlaps[0]?.score ?? 0;
  const novelty = Math.round(30 * Math.max(0, 1 - Math.min(1, top / 12)));
  let utility = 0;
  if (USEFUL_TYPES.has(input.type)) utility += 12;
  if (input.repo && ctx.activeRepos?.includes(input.repo)) utility += 12;
  else if (input.repo || input.product) utility += 6;
  const words = new Set(key(`${input.title} ${input.why}`).split(' ').filter((w) => w.length > 3));
  if (ctx.focusWords?.some((w) => words.has(w))) utility += 6;
  // Asked for now, or new to the person: useful now.
  if (input.signal === 'asked' || input.signal === 'unknown' || input.signal === 'requested') utility += 8;
  utility = Math.min(30, utility);
  const reuse = Math.min(25, mentions * 5);
  const signal = SIGNAL_POINTS[input.signal ?? 'session'];
  return { total: novelty + utility + reuse + signal, novelty, utility, reuse, signal };
}

function mentionsOf(bundle: Bundle, title: string): number {
  const needle = key(title);
  if (needle.length < 2) return 0;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
  let n = 0;
  for (const doc of bundle.docs.values()) if (re.test(key(doc.body))) n++;
  return n;
}

export async function contextFor(config: OkbConfig, bundle: Bundle): Promise<SuggestContext> {
  const { readFocus } = await import('../focus/focus.js');
  const focus = await readFocus(config).catch(() => null);
  const text = focus && 'body' in focus ? String((focus as { body?: string }).body ?? '') : '';
  const tickets = await listTickets(config).catch(() => []);
  return {
    bundle,
    focusWords: key(text).split(' ').filter((w) => w.length > 4).slice(0, 80),
    activeRepos: tickets.filter((t) => t.status === 'active').flatMap((t) => t.repos.map((r) => r.id)),
  };
}

/** Build a card (not stored). */
export function buildCard(config: OkbConfig, input: SuggestInput, ctx: SuggestContext, now = new Date()): Suggestion {
  if (!input.title.trim()) throw new OkbError('E_INVALID', 'a suggestion needs a title', { key: 'suggestNoTitle' });
  assertNoSecrets({ title: input.title, why: input.why }, 'suggestion');
  const type = noteType(input.type);
  if (!type) throw new OkbError('E_INVALID', `unknown note type "${input.type}"`, { key: 'brainUnknownType', params: { type: input.type } });
  const layout = layoutOf(config);
  const addressInput: AddressInput = {
    type: input.type, title: input.title,
    ...(input.product ? { product: input.product } : {}), ...(input.repo ? { repo: input.repo } : {}),
    ...(input.theme ? { theme: input.theme } : {}), ...(input.ref ? { ref: input.ref } : {}),
    ...(input.date ? { date: input.date } : {}), ...(input.level ? { level: input.level } : {}),
  };
  const address = layout ? addressFor({ layout, existing: new Set(ctx.bundle.snapshot.files.keys()), today: now }, addressInput) : null;
  const hits = searchBundle(ctx.bundle, `${input.title}`, { limit: 4 });
  const exact = ctx.bundle.entries.find((e) => key(e.title) === key(input.title) || (e.ext.aliases ?? []).some((a) => key(a) === key(input.title)));
  const overlaps = [...(exact ? [{ path: exact.path, title: exact.title, score: 99 }] : []), ...hits.filter((h) => h.entry.path !== exact?.path).map((h) => ({ path: h.entry.path, title: h.entry.title, score: Math.round(h.score * 10) / 10 }))].slice(0, 4);
  const existsAtPlace = address && ctx.bundle.byPath.has(address.path);
  let recommendation: Recommendation = 'create';
  let target: BundlePath | null = null;
  if (exact) { recommendation = exact.path === address?.path || key(exact.title) === key(input.title) ? 'complete' : 'link'; target = exact.path; }
  else if (existsAtPlace) { recommendation = 'complete'; target = address!.path; }
  else if ((overlaps[0]?.score ?? 0) >= 12) {
    // Among the close matches, a note of the same kind first: a concept completes a concept card, not a ticket that mentions the word.
    const kindOf = (path: BundlePath) => (ctx.bundle.byPath.get(path)?.ext as { brain?: { type?: string } } | undefined)?.brain?.type;
    const close = overlaps.filter((o) => o.score >= Math.max(12, overlaps[0]!.score * 0.75));
    const same = close.find((o) => kindOf(o.path) === input.type) ?? overlaps[0]!;
    recommendation = 'complete'; target = same.path;
  }
  const p = pertinence(input, overlaps, ctx, mentionsOf(ctx.bundle, input.title));
  const notes = Math.max(1, input.notes ?? 1);
  const contextTokens = 2_000;
  const tokens = (COST_TOKENS[type.cost] + contextTokens) * notes;
  const size = tokens > 15_000 ? 'large' : tokens > 6_000 ? 'medium' : 'small';
  const name = config.profile.displayName || config.profile.id;
  return {
    id: `S-${randomBytes(3).toString('hex')}`,
    createdAt: now.toISOString(), type: type.id, title: input.title.trim(), input: addressInput,
    path: address?.path ?? null, breadcrumb: address ? breadcrumb(name, address) : name,
    why: input.why.trim(), signal: input.signal ?? 'session', source: input.source ?? 'live',
    overlaps, recommendation: recommendation === 'complete' && exact && exact.path !== address?.path && !existsAtPlace ? 'complete' : recommendation,
    target, pertinence: p, cost: { size, tokens, notes }, scope: input.scope ?? null, status: 'pending',
  };
}

/** Add a card to the queue; the same card twice is the same suggestion. */
export async function addSuggestion(config: OkbConfig, input: SuggestInput, ctx: SuggestContext, now = new Date()): Promise<{ suggestion: Suggestion; created: boolean }> {
  const card = buildCard(config, input, ctx, now);
  const queue = await loadQueue(config, now);
  const sameSubject = (s: Suggestion) => (s.input.product ?? '') === (card.input.product ?? '') && (s.input.repo ?? '') === (card.input.repo ?? '') && (s.input.theme ?? '') === (card.input.theme ?? '');
  const same = queue.find((s) => s.type === card.type && key(s.title) === key(card.title) && sameSubject(s) && ['pending', 'later', 'accepted', 'declined'].includes(s.status));
  if (same) {
    const shown = { ...same, shownAt: now.toISOString() };
    await saveQueue(config, queue.map((s) => (s === same ? shown : s)));
    return { suggestion: shown, created: false };
  }
  const stored = { ...card, shownAt: now.toISOString() };
  await saveQueue(config, [...queue, stored]);
  return { suggestion: stored, created: true };
}

export async function findSuggestion(config: OkbConfig, id: string): Promise<Suggestion> {
  const s = (await loadQueue(config)).find((x) => x.id === id || x.id.toLowerCase() === id.toLowerCase());
  if (!s) throw new OkbError('E_NOT_FOUND', `no suggestion ${id}`, { key: 'suggestUnknown', params: { id } });
  return s;
}

export async function setStatus(config: OkbConfig, id: string, status: SuggestionStatus, by?: Suggestion['decidedBy'], proposalId?: string): Promise<Suggestion> {
  const queue = await loadQueue(config);
  const found = queue.find((x) => x.id === id);
  if (!found) throw new OkbError('E_NOT_FOUND', `no suggestion ${id}`, { key: 'suggestUnknown', params: { id } });
  // Every decision is the person's (in the web app, the terminal, or their answer read by the consent hook): it carries their id.
  const who = by ? await person().catch(() => null) : null;
  const next: Suggestion = {
    ...found, status, decidedAt: new Date().toISOString(), ...(by ? { decidedBy: by } : {}), ...(who ? { decidedPerson: who.id } : {}),
    ...(proposalId ? { proposalIds: [...(found.proposalIds ?? []), proposalId] } : {}),
  };
  await saveQueue(config, queue.map((s) => (s === found ? next : s)));
  return next;
}

/* ------------------------------------------------------------------ budget */

export async function dailyBudget(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const root = await readRootConfig(env).catch(() => ({} as Record<string, unknown>));
  const v = (root as { budget?: { daily?: unknown } }).budget?.daily;
  return typeof v === 'number' && v >= 0 ? v : 50_000;
}

/** Estimated tokens of the notes accepted today (all brains of this profile), plus OKB's own AI calls (translations). */
export async function spentToday(config: OkbConfig, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const notes = (await loadQueue(config, now)).filter((s) => (s.status === 'accepted' || s.status === 'done') && s.decidedAt?.startsWith(day)).reduce((n, s) => n + s.cost.tokens, 0);
  const { aiSpentToday } = await import('../ai/usage.js');
  return notes + (await aiSpentToday(config, now));
}

/* ----------------------------------------------------------------- display */

const STARS = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));

export function renderCard(s: Suggestion, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr';
  const rec: Record<Recommendation, string> = fr
    ? { create: '✅ Créer la note', complete: `🔁 Compléter « ${s.target ?? ''} »`, link: `🔗 Relier à « ${s.target ?? ''} »`, nothing: '🚫 Rien à écrire' }
    : { create: '✅ Create the note', complete: `🔁 Complete “${s.target ?? ''}”`, link: `🔗 Link to “${s.target ?? ''}”`, nothing: '🚫 Nothing to write' };
  const type = noteType(s.type);
  const label = type ? (fr ? type.label.fr : type.label.en) : s.type;
  const lines = [
    `💡 ${fr ? 'Suggestion de note' : 'Note suggestion'} ${s.id}${' '.repeat(6)}${fr ? 'Pertinence' : 'Pertinence'} ${s.pertinence.total}/100`,
    `${fr ? 'Type' : 'Type'.padEnd(4)}             ${label}`,
    `${fr ? 'Titre' : 'Title'}            ${s.title}`,
    `${fr ? 'Où' : 'Where'}               ${s.breadcrumb}`,
    `${fr ? 'Pourquoi' : 'Why'}         ${s.why}`,
    `${fr ? 'Déjà là' : 'Already'}          ${s.overlaps.length ? s.overlaps.slice(0, 2).map((o) => `${o.title}${o.score === 99 ? (fr ? ' (même titre)' : ' (same title)') : ''}`).join(' · ') : (fr ? 'rien de proche' : 'nothing close')}`,
    `${fr ? 'Recommandation' : 'Recommendation'}   ${rec[s.recommendation]}`,
    `${fr ? 'Coût estimé' : 'Estimated cost'}      ${s.cost.size} · ≈ ${s.cost.tokens.toLocaleString(fr ? 'fr-FR' : 'en-US')} tokens${s.cost.notes > 1 ? ` · ${s.cost.notes} notes` : ''}`,
  ];
  return lines.join('\n');
}

export function stars(n: number): string { return STARS(n); }
