import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { drawerLabel, layoutOf } from '../brain/layout.js';
import { positionOf } from '../brain/tree.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { appendLine, readJsonIfExists, readLines, writeJsonAtomic } from '../util/fsx.js';

/**
 * Spaced review of what the brain holds. A card is a concept note (« C'est
 * quoi X ? » → its one-sentence description) or a « Q : … — R : … » line any
 * note may carry (trainings have an « À réviser » section for them). Cards are
 * computed from the notes, never stored in them: the review state lives in
 * OKB's state folder, scheduled by FSRS (ts-fsrs). Nothing here writes the KB.
 */

export type StudyCard = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly front: string;
  readonly back: string;
  readonly kind: 'concept' | 'qa';
  /** Product, theme or drawer the note belongs to: the skills map groups by it. */
  readonly subject: string;
};

export type Level = 'new' | 'learning' | 'known' | 'mastered';
type Saved = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };
type Store = { version: 1; cards: Record<string, Saved> };

const QA_INLINE = /^\s*(?:[-*]\s*)?(?:\*\*)?Q(?:\*\*)?\s*[:：]\s*(.+?)\s+(?:—|–|--|\|)\s+(?:\*\*)?(?:R|A)(?:\*\*)?\s*[:：]\s*(.+?)\s*$/;
const Q_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?Q(?:\*\*)?\s*[:：]\s*(.+?)\s*$/;
const A_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:R|A)(?:\*\*)?\s*[:：]\s*(.+?)\s*$/;

/** The « Q : … — R : … » pairs of a note body (one line, or a Q line followed by its R line). */
export function qaPairs(body: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const lines = body.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const inline = QA_INLINE.exec(line);
    if (inline) { out.push({ q: inline[1]!, a: inline[2]! }); continue; }
    const q = Q_LINE.exec(line);
    const a = q && lines[i + 1] !== undefined ? A_LINE.exec(lines[i + 1]!) : null;
    if (q && a) { out.push({ q: q[1]!, a: a[1]! }); i++; }
  }
  return out;
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const CONCEPT_KINDS = new Set(['concept', 'acronym']);

/** Every card the KB holds today. A note marked secret gives none. */
export function collectCards(config: OkbConfig, bundle: Bundle): StudyCard[] {
  const layout = layoutOf(config);
  const fr = (config.profile.answer.language ?? 'fr').startsWith('fr');
  const cards: StudyCard[] = [];
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    const ext = e.ext as { id?: string; confidentiality?: string; brain?: { type?: string }; template?: string };
    if (ext.confidentiality === 'secret') continue;
    const key = ext.id ?? e.path;
    const pos = layout ? positionOf(layout, e.path) : null;
    const subject = pos ? pos.product ?? pos.theme ?? (pos.drawer ? drawerLabel(layout!, pos.drawer) : '—') : e.path.includes('/') ? e.path.split('/')[0]! : '—';
    const isConcept = CONCEPT_KINDS.has(ext.brain?.type ?? '') || ext.template === 'concept' || e.type === 'Concept';
    if (isConcept && e.description) {
      const front = fr ? `C’est quoi « ${e.title} » ?` : `What is “${e.title}”?`;
      cards.push({ id: `c-${hash(`${key}\n${front}`)}`, path: e.path, title: e.title, front, back: e.description, kind: 'concept', subject });
    }
    const doc = bundle.docs.get(e.path);
    if (!doc) continue;
    for (const { q, a } of qaPairs(doc.body)) {
      cards.push({ id: `c-${hash(`${key}\n${q}`)}`, path: e.path, title: e.title, front: q, back: a, kind: 'qa', subject });
    }
  }
  return cards;
}

/* ---------------------------------------------------------- the state */

function dir(config: OkbConfig): string { return resolve(config.stateHome, 'learn'); }

async function loadStore(config: OkbConfig): Promise<Store> {
  return (await readJsonIfExists<Store>(resolve(dir(config), 'cards.json'))) ?? { version: 1, cards: {} };
}

const toCard = (s: Saved): Card => ({ ...s, due: new Date(s.due), ...(s.last_review ? { last_review: new Date(s.last_review) } : {}) }) as Card;
const toSaved = (c: Card): Saved => ({ ...c, due: c.due.toISOString(), ...(c.last_review ? { last_review: new Date(c.last_review).toISOString() } : {}) }) as Saved;

/** How well a card is known: new, learning (being learnt or forgotten), known (≥ 7 days), mastered (≥ 30 days). */
export function levelOf(s: Saved | undefined): Level {
  if (!s) return 'new';
  if (s.state === State.Learning || s.state === State.Relearning || s.stability < 7) return 'learning';
  return s.stability >= 30 ? 'mastered' : 'known';
}

export type DueCard = StudyCard & { readonly level: Level; readonly due: string | null };

export type DueList = {
  readonly due: readonly DueCard[];
  /** New cards offered today, within the daily limit. */
  readonly fresh: readonly DueCard[];
  readonly counts: { readonly cards: number; readonly due: number; readonly newLeft: number; readonly reviewedToday: number };
};

export async function dueCards(config: OkbConfig, bundle: Bundle, options: { now?: Date; limit?: number; newPerDay?: number; subject?: string; note?: string } = {}): Promise<DueList> {
  const now = options.now ?? new Date();
  const store = await loadStore(config);
  const today = now.toISOString().slice(0, 10);
  const log = await readLog(config);
  const todays = log.filter((l) => l.at.startsWith(today));
  const newToday = new Set(todays.filter((l) => l.was === 'new').map((l) => l.id)).size;
  const newLeft = Math.max(0, (options.newPerDay ?? 10) - newToday);
  const cards = collectCards(config, bundle).filter((c) => (!options.subject || c.subject === options.subject) && (!options.note || c.path === options.note));
  const due: DueCard[] = [];
  const fresh: DueCard[] = [];
  for (const c of cards) {
    const s = store.cards[c.id];
    if (!s) { fresh.push({ ...c, level: 'new', due: null }); continue; }
    if (new Date(s.due) <= now) due.push({ ...c, level: levelOf(s), due: s.due });
  }
  due.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  const limit = options.limit ?? 20;
  return {
    due: due.slice(0, limit), fresh: fresh.slice(0, Math.min(newLeft, Math.max(0, limit - Math.min(due.length, limit)))),
    counts: { cards: cards.length, due: due.length, newLeft, reviewedToday: new Set(todays.map((l) => l.id)).size },
  };
}

const RATINGS: Record<string, Grade> = {
  again: Rating.Again, encore: Rating.Again, '1': Rating.Again,
  hard: Rating.Hard, difficile: Rating.Hard, '2': Rating.Hard,
  good: Rating.Good, bien: Rating.Good, '3': Rating.Good,
  easy: Rating.Easy, facile: Rating.Easy, '4': Rating.Easy,
};

export function parseRating(raw: string): Grade | null {
  return RATINGS[raw.trim().toLowerCase()] ?? null;
}

type LogLine = { at: string; id: string; rating: number; was: Level; next: string };

async function readLog(config: OkbConfig): Promise<LogLine[]> {
  const lines = await readLines(resolve(dir(config), 'log.jsonl')).catch(() => [] as string[]);
  const out: LogLine[] = [];
  for (const l of lines) { try { out.push(JSON.parse(l) as LogLine); } catch { /* a torn line */ } }
  return out;
}

/** One answer graded: the card's next review date. */
export async function gradeCard(config: OkbConfig, id: string, rating: Grade, now = new Date()): Promise<{ id: string; level: Level; due: string; interval: number }> {
  const store = await loadStore(config);
  const before = store.cards[id];
  const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));
  const next = scheduler.next(before ? toCard(before) : createEmptyCard(now), now, rating).card;
  const saved = toSaved(next);
  store.cards[id] = saved;
  await writeJsonAtomic(resolve(dir(config), 'cards.json'), store);
  await appendLine(resolve(dir(config), 'log.jsonl'), JSON.stringify({ at: now.toISOString(), id, rating, was: levelOf(before), next: saved.due } satisfies LogLine));
  return { id, level: levelOf(saved), due: saved.due, interval: Math.max(0, Math.round((next.due.getTime() - now.getTime()) / 86_400_000)) };
}

/** Cards already studied that are due now (new cards not counted): cheap, no KB read. */
export async function dueCount(config: OkbConfig, now = new Date()): Promise<number> {
  const store = await loadStore(config);
  return Object.values(store.cards).filter((c) => new Date(c.due) <= now).length;
}

/* ----------------------------------------------------- the skills map */

export type SubjectMastery = {
  readonly subject: string;
  readonly cards: number;
  readonly levels: Readonly<Record<Level, number>>;
  /** Share of cards known or mastered, 0–100. */
  readonly percent: number;
};

export async function skillsMap(config: OkbConfig, bundle: Bundle): Promise<SubjectMastery[]> {
  const store = await loadStore(config);
  const by = new Map<string, Record<Level, number>>();
  for (const c of collectCards(config, bundle)) {
    const levels = by.get(c.subject) ?? { new: 0, learning: 0, known: 0, mastered: 0 };
    levels[levelOf(store.cards[c.id])]++;
    by.set(c.subject, levels);
  }
  return [...by.entries()].map(([subject, levels]) => {
    const cards = levels.new + levels.learning + levels.known + levels.mastered;
    return { subject, cards, levels, percent: cards ? Math.round(((levels.known + levels.mastered) / cards) * 100) : 0 };
  }).sort((a, b) => b.cards - a.cards || a.subject.localeCompare(b.subject));
}

/** What a quiz on a repository, a product or a note rests on: the notes' briefs and their cards. */
export function quizMaterial(config: OkbConfig, bundle: Bundle, scope: { folder?: string; note?: string }): { notes: { path: string; title: string; description: string }[]; cards: StudyCard[] } {
  const inScope = (p: string) => (scope.note ? p === scope.note : scope.folder ? p.startsWith(`${scope.folder}/`) : true);
  const notes = bundle.entries.filter((e) => !e.reserved && inScope(e.path) && (e.ext as { confidentiality?: string }).confidentiality !== 'secret')
    .map((e) => ({ path: e.path as string, title: e.title, description: e.description })).slice(0, 60);
  return { notes, cards: collectCards(config, bundle).filter((c) => inScope(c.path)).slice(0, 60) };
}

/* ------------------------------------------------- learning objectives */

export type Objective = { readonly id: string; readonly text: string; readonly subject: string | null; readonly by: string | null; readonly createdAt: string; readonly doneAt: string | null };

async function loadObjectives(config: OkbConfig): Promise<Objective[]> {
  return (await readJsonIfExists<{ objectives: Objective[] }>(resolve(dir(config), 'objectives.json')))?.objectives ?? [];
}

export async function listObjectives(config: OkbConfig): Promise<Objective[]> {
  return loadObjectives(config);
}

export async function addObjective(config: OkbConfig, input: { text: string; subject?: string; by?: string }, now = new Date()): Promise<Objective> {
  const all = await loadObjectives(config);
  const o: Objective = { id: `o-${hash(`${input.text}\n${now.toISOString()}`).slice(0, 6)}`, text: input.text.trim(), subject: input.subject ?? null, by: input.by ?? null, createdAt: now.toISOString().slice(0, 10), doneAt: null };
  await writeJsonAtomic(resolve(dir(config), 'objectives.json'), { objectives: [...all, o] });
  return o;
}

export async function finishObjective(config: OkbConfig, id: string, now = new Date()): Promise<Objective | null> {
  const all = await loadObjectives(config);
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) return null;
  const done = { ...all[i]!, doneAt: now.toISOString().slice(0, 10) };
  all[i] = done;
  await writeJsonAtomic(resolve(dir(config), 'objectives.json'), { objectives: all });
  return done;
}
