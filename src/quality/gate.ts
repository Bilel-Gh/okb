import { oneLiner, plain } from '../concepts/one-liner.js';
import type { Bundle } from '../kb/bundle.js';
import { parseOkf } from '../okf/document.js';
import type { Change, Proposal } from '../proposal/model.js';

/**
 * The quality gate (D78): what an agent wrote must be right the first time.
 * Before a note goes in on its own, plain code checks what a reader would
 * trip on: a sentence without its quote, a duplicate, a note left at the root,
 * a dash used as punctuation, a sentence too long to read, a template left
 * half filled, a concept without its one-line summary. Nothing here calls a
 * model: the gate is cheap, so it runs on every note.
 *
 * A note that fails is never shown as done. The scribe rewrites it once when
 * the problem is one of writing; otherwise, or if the rewrite fails too, the
 * proposal waits for the person with the reasons written on it.
 */
export type GateCode =
  | 'no-evidence'
  | 'duplicate'
  | 'placement'
  | 'dash'
  | 'long-sentence'
  | 'too-short'
  | 'placeholder'
  | 'concept-summary';

export type GateProblem = { readonly code: GateCode; readonly path: string; readonly detail?: string };
export type GateResult = { readonly pass: boolean; readonly problems: readonly GateProblem[]; readonly rewritable: boolean };

/** Problems a second writing can fix; the others need another place or the person. */
const WRITING: ReadonlySet<GateCode> = new Set(['dash', 'long-sentence', 'too-short', 'placeholder', 'concept-summary']);

export const MAX_SENTENCE_WORDS = 45;
export const MIN_NOTE_WORDS = 25;
/** Two notes sharing this share of their word triples say the same thing. */
export const DUPLICATE_SHARE = 0.5;

const DASH = /\s[—–]\s|[\p{L}\p{N}][—][\p{L}\p{N}]/u;
const PLACEHOLDER = /\{\{[^}]*\}\}|\bundefined\b|\[object Object\]|\bTODO\b|\bTBD\b|<(?:role|id|text|quote)>/;

export function checkProposal(proposal: Pick<Proposal, 'changes'>, bundle: Bundle): GateResult {
  const problems: GateProblem[] = [];
  for (const change of proposal.changes) {
    if (change.category !== 'article' && change.category !== 'concept-card') continue;
    const written = writtenText(change);
    if (written === null) continue;
    const at = (code: GateCode, detail?: string) => problems.push({ code, path: change.path, ...(detail ? { detail } : {}) });
    if (!change.evidenceIds.length) at('no-evidence');
    const prose = proseOf(written.body);
    if (DASH.test(prose)) at('dash', excerpt(prose, DASH));
    const long = sentences(prose).find((s) => words(s) > MAX_SENTENCE_WORDS);
    if (long) at('long-sentence', `${long.slice(0, 80)}…`);
    const ph = PLACEHOLDER.exec(written.body);
    if (ph) at('placeholder', ph[0]);
    if (change.kind === 'create-document') {
      if (change.category === 'article' && words(plain(prose)) < MIN_NOTE_WORDS) at('too-short');
      if (change.category === 'concept-card' && oneLiner(written.body, written.title).reason !== 'ok') at('concept-summary', oneLiner(written.body, written.title).reason);
      const place = placement(change.path, bundle);
      if (place) at('placement', place);
      if (change.category === 'article') {
        const twin = duplicateOf(change.path, written, bundle);
        if (twin) at('duplicate', twin);
      }
    }
  }
  return { pass: problems.length === 0, problems, rewritable: problems.length > 0 && problems.every((p) => WRITING.has(p.code)) };
}

/** One line per problem, for the proposal's notes and for a rewrite request. */
export function describeProblems(problems: readonly GateProblem[]): string[] {
  const say: Record<GateCode, string> = {
    'no-evidence': 'a part of the note cites nothing from its source',
    duplicate: 'another note already says this',
    placement: 'the note is not where its kind of note lives',
    dash: 'a dash is used as punctuation; use a comma, a colon or two sentences',
    'long-sentence': `a sentence has more than ${MAX_SENTENCE_WORDS} words; split it`,
    'too-short': `the note has fewer than ${MIN_NOTE_WORDS} words; say what a reader needs months later`,
    placeholder: 'a placeholder of the template was left in the text',
    'concept-summary': 'the concept has no one-line summary under « En une phrase »',
  };
  return problems.map((p) => `quality gate (D78): ${p.code} in ${p.path}: ${say[p.code]}${p.detail ? ` (${p.detail})` : ''}`);
}

/* ----------------------------------------------------------------- utils */

function writtenText(change: Change): { title: string; body: string } | null {
  if (change.kind === 'create-document' && change.createDocument) {
    const doc = safeParse(change.path, change.createDocument.content);
    const fm = doc?.title ?? null;
    return { title: fm ?? basename(change.path), body: doc?.body ?? change.createDocument.content };
  }
  if (change.kind === 'append-section' && change.appendSection) return { title: change.appendSection.heading, body: change.appendSection.markdown };
  return null;
}

function safeParse(path: string, raw: string): { title: string | null; body: string } | null {
  try {
    const doc = parseOkf(path, raw);
    const title = (doc.data as { title?: unknown }).title;
    return { title: typeof title === 'string' ? title : null, body: doc.body };
  } catch {
    return null;
  }
}

/** The text the note says in its own words: quotes, code, tables and footnotes left out. */
export function proseOf(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((l) => !/^\s*(>|\||\[\^[^\]]+\]:|<!--)/.test(l))
    .join('\n')
    .replace(/`[^`]*`/g, '')
    .replace(/«[^»]*»/g, '«»')
    .replace(/“[^”]*”/g, '“”')
    .replace(/"[^"\n]*"/g, '""');
}

const sentences = (text: string) => plain(text.replace(/^#{1,6}\s.*$/gm, '').replace(/^\s*([-*+]|\d+[.)])\s+/gm, '\n')).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const basename = (path: string) => path.split('/').at(-1)!.replace(/\.md$/, '');
const excerpt = (text: string, re: RegExp) => { const m = re.exec(text); return m ? text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ').trim() : ''; };

function placement(path: string, bundle: Bundle): string | null {
  const parts = path.split('/');
  if (parts.some((p) => /^(undefined|null|nan)$/i.test(p.replace(/\.md$/, '')))) return 'a folder name is empty';
  // A brain or a KB with folders files every note in one; the root is for its home pages.
  const foldered = bundle.entries.filter((e) => !e.reserved && e.path.includes('/')).length;
  if (parts.length === 1 && foldered >= 3) return 'left at the root';
  return null;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function triples(text: string): Set<string> {
  const w = norm(plain(proseOf(text))).split(' ').filter((x) => x.length > 2);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

function duplicateOf(path: string, written: { title: string; body: string }, bundle: Bundle): string | null {
  const title = norm(written.title);
  const mine = triples(written.body);
  for (const entry of bundle.entries) {
    if (entry.reserved || entry.path === path) continue;
    if (title && (norm(entry.title) === title || norm(basename(entry.path)) === title)) return entry.path;
    if (mine.size < 8) continue;
    const doc = bundle.docs.get(entry.path);
    if (!doc) continue;
    const theirs = triples(doc.body);
    if (theirs.size < 8) continue;
    let shared = 0;
    for (const t of mine) if (theirs.has(t)) shared++;
    if (shared / Math.min(mine.size, theirs.size) >= DUPLICATE_SHARE) return entry.path;
  }
  return null;
}
