import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { assertNoSecrets } from '../security/guard.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { withStateLock } from '../util/state-lock.js';
import { detectMoments, isClosing, type Moment, type MomentInput, type MomentKind } from './moments.js';
import { addSuggestion, contextFor, loadQueue, snooze, type Suggestion } from './suggest.js';

/**
 * The rules of a session (F2.0-09). What OKB spots during a conversation is
 * kept without a word; when the person closes the session, at most three
 * things are offered, in one question. « Pas maintenant » is remembered: the
 * cards wait in the app, and are not offered again for a week.
 */
export const MAX_OFFERS = 3;
const LIVE_GAP = 20 * 60_000;
const KEEP = 30 * 86_400_000;
/** The strongest first: what cost the person the most to find. */
const ORDER: readonly MomentKind[] = ['solved', 'error', 'decision', 'repeat', 'command', 'explained'];

type Kept = Moment & { readonly at: string; readonly card?: string };
type Ledger = { id: string; startedAt: string; lastAt: string; moments: Kept[]; offered: string[]; quiet: boolean; liveAt?: string };
type Ledgers = { version: 1; sessions: Ledger[] };

export type SpotInput = MomentInput & { readonly session?: string };
export type Offer = { readonly session: string; readonly cards: Suggestion[]; readonly toName: Moment[] };
export type Spotted = { readonly moments: Moment[]; readonly offer: Offer | null; readonly context?: string; readonly suggestion?: Suggestion };

const file = (config: OkbConfig) => resolve(statePaths(config).root, 'suggest', 'sessions.json');
const keyOf = (m: Moment) => `${m.kind}:${(m.title ?? m.hint).toLowerCase()}`;
/** The id goes into a command the assistant runs: letters, digits, `_` and `-` only. */
const sessionId = (raw: string | undefined, now: Date) => (raw && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : `day-${now.toISOString().slice(0, 10)}`);

async function change<T>(config: OkbConfig, id: string, now: Date, edit: (ledger: Ledger) => T): Promise<T> {
  return withStateLock(file(config), async () => {
    const all = (await readJsonIfExists<Ledgers>(file(config)).catch(() => null)) ?? { version: 1, sessions: [] };
    const sessions = all.sessions.filter((s) => now.getTime() - Date.parse(s.lastAt) < KEEP);
    let ledger = sessions.find((s) => s.id === id);
    if (!ledger) sessions.push(ledger = { id, startedAt: now.toISOString(), lastAt: now.toISOString(), moments: [], offered: [], quiet: false });
    ledger.lastAt = now.toISOString();
    const out = edit(ledger);
    await writeJsonAtomic(file(config), { version: 1, sessions });
    return out;
  });
}

async function read(config: OkbConfig, id: string): Promise<Ledger | null> {
  const all = await readJsonIfExists<Ledgers>(file(config)).catch(() => null);
  return all?.sessions.find((s) => s.id === id) ?? null;
}

/** The session the assistant is in: the one that moved last, within three hours. */
export async function currentSession(config: OkbConfig, now = new Date()): Promise<string | null> {
  const all = await readJsonIfExists<Ledgers>(file(config)).catch(() => null);
  const last = [...(all?.sessions ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  return last && now.getTime() - Date.parse(last.lastAt) < 3 * 3_600_000 ? last.id : null;
}

const WHY: Readonly<Record<string, string>> = { asked: 'the person asked what it is', unknown: 'the person did not know it', repeat: 'the person asked it twice' };
const worth = (s: Suggestion) => s.recommendation !== 'nothing' && s.recommendation !== 'link';
const quote = (text: string) => text.replace(/[`"«»\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * One exchange of a conversation: spot its moments, keep them, and say what to
 * offer — nothing along the way (unless `live`), the grouped question when the
 * person closes the session. Never writes a note; never spends a token.
 */
export async function spot(config: OkbConfig, input: SpotInput, options: { readonly mode: 'live' | 'session' | 'never'; readonly now?: Date }): Promise<Spotted> {
  const now = options.now ?? new Date();
  if (options.mode === 'never' || !config.kb.brain) return { moments: [], offer: null };
  const session = sessionId(input.session, now);
  // A line that holds a secret (a token in an error) is not kept.
  const moments = detectMoments(input).map((m) => { try { assertNoSecrets({ hint: m.hint }, 'moment'); return m; } catch { return { ...m, hint: '' }; } });

  // A moment the words name (« c'est quoi OData ? ») gets its card at once: zero token, nothing shown.
  const cards = new Map<Moment, { suggestion: Suggestion; created: boolean }>();
  if (moments.some((m) => m.title)) {
    const ctx = await contextFor(config, await loadBundleFor(config));
    for (const m of moments) {
      if (!m.title) continue;
      try { cards.set(m, await addSuggestion(config, { type: m.type, title: m.title, why: WHY[m.signal] ?? 'spotted in the session', signal: m.signal, source: 'live' }, ctx, now)); } catch { /* a title OKB refuses (a secret): no card */ }
    }
  }
  const ledger = await change(config, session, now, (l) => {
    for (const m of moments) {
      if (m.title && !cards.has(m)) continue;
      const card = cards.get(m)?.suggestion.id;
      const known = l.moments.find((k) => keyOf(k) === keyOf(m));
      if (!known) l.moments.push({ ...m, at: now.toISOString(), ...(card ? { card } : {}) });
    }
    return { ...l, offered: [...l.offered] };
  });

  if (isClosing(input.prompt)) {
    const offer = await sessionOffer(config, session, now);
    return offer.cards.length || offer.toName.length ? { moments, offer, context: groupedContext(offer) } : { moments, offer: null };
  }
  if (options.mode === 'live') {
    const fresh = [...cards.values()].find((c) => c.created && worth(c.suggestion) && c.suggestion.pertinence.total >= 60)?.suggestion;
    const quietNow = ledger.quiet || ledger.offered.length >= MAX_OFFERS || (ledger.liveAt !== undefined && now.getTime() - Date.parse(ledger.liveAt) < LIVE_GAP);
    if (fresh && !quietNow) {
      await change(config, session, now, (l) => { l.offered.push(fresh.id); l.liveAt = now.toISOString(); });
      return { moments, offer: null, suggestion: fresh, context: liveContext(fresh) };
    }
  }
  return { moments, offer: null };
}

/** What the session may still offer: its cards first (the best ones), then the moments to name. Offered once. */
export async function sessionOffer(config: OkbConfig, session: string, now = new Date()): Promise<Offer> {
  const ledger = await read(config, session);
  const none: Offer = { session, cards: [], toName: [] };
  if (!ledger || ledger.quiet) return none;
  let room = MAX_OFFERS - ledger.offered.length;
  if (room <= 0) return none;
  const queue = await loadQueue(config, now);
  const snoozed = (s: Suggestion) => s.status === 'later' && Date.parse(s.laterUntil ?? s.decidedAt ?? '') + (s.laterUntil ? 0 : 7 * 86_400_000) > now.getTime();
  const ids = [...new Set(ledger.moments.flatMap((m) => (m.card ? [m.card] : [])))];
  const cards = ids.flatMap((id) => queue.filter((s) => s.id === id))
    .filter((s) => !ledger.offered.includes(s.id) && worth(s) && (s.status === 'pending' || (s.status === 'later' && !snoozed(s))))
    .sort((a, b) => b.pertinence.total - a.pertinence.total).slice(0, room);
  room -= cards.length;
  const toName = ledger.moments.filter((m) => !m.card && !ledger.offered.includes(keyOf(m)))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).slice(0, room)
    .map(({ kind, type, signal, title, hint }): Moment => ({ kind, type, signal, title, hint }));
  if (cards.length || toName.length) await change(config, session, now, (l) => { l.offered.push(...cards.map((c) => c.id), ...toName.map(keyOf)); });
  return { session, cards, toName };
}

/** « Pas maintenant »: the session offers nothing more, and what it offered waits in the app for a week. */
export async function notNow(config: OkbConfig, session: string, now = new Date()): Promise<{ later: string[] }> {
  const offered = await change(config, sessionId(session, now), now, (l) => { l.quiet = true; return [...l.offered]; });
  const pending = (await loadQueue(config, now)).filter((s) => offered.includes(s.id) && s.status === 'pending').map((s) => s.id);
  await snooze(config, pending, now);
  return { later: pending };
}

const LABEL: Readonly<Record<MomentKind, string>> = {
  solved: 'a bug solved after several tries', error: 'an error and its cause', decision: 'a decision', repeat: 'a question asked twice', command: 'a command discovered', explained: 'something the person did not know',
};

function groupedContext(offer: Offer): string {
  const lines = [
    ...offer.cards.map((c) => `- card ${c.id}: ${c.type} « ${c.title} » → ${c.breadcrumb} (≈${c.cost.tokens} tokens)`),
    ...offer.toName.map((m) => `- ${LABEL[m.kind]}${m.hint ? ` (« ${quote(m.hint)} »)` : ''}: only if it really happened, make its card first: okb suggest add --type ${m.type} --title "<a short title>" --why "<one line>" --signal ${m.signal} --source session --json`),
  ];
  return [
    `OKB: before this session ends, ${lines.length} thing(s) may be worth keeping in the user's brain. They were spotted without AI; nothing is written yet.`,
    ...lines,
    'Ask ONE multi-select question (AskUserQuestion) listing them (title, place, estimated cost), with « Pas maintenant » as the last option. Write only what they pick (okb-capture skill).',
    `If they answer « Pas maintenant »: okb suggest later --session ${offer.session} — OKB remembers it; the cards wait in the app and are not offered again for a week. Offer nothing else in this session.`,
  ].join('\n');
}

function liveContext(s: Suggestion): string {
  return `OKB: your explanation of « ${s.title} » may deserve a one-minute concept card in the user's brain (card ${s.id}, pertinence ${s.pertinence.total}/100, ≈${s.cost.tokens} tokens). Offer it in ONE short line at the end — « 💾 Je garde ça ? → ${s.breadcrumb} » — with buttons « Créer (recommandé) » · « Plus tard » · « Non » (put ${s.id} in the question). Write nothing unless they accept (okb-capture skill).`;
}
