import { meaningQuery, roots } from './meaning.js';
import { posix, resolve } from 'node:path';
import MiniSearch from 'minisearch';
import { layoutOf, type BrainLayout } from '../brain/layout.js';
import { positionOf } from '../brain/tree.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle, KbEntry } from '../kb/bundle.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import { statePaths } from '../state/paths.js';
import { appendLine, readLines } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import type { BundlePath } from '../util/paths.js';
import { bilingual } from './lexicon.js';

/**
 * Finding a note in three seconds, for the person and for Claude alike: one
 * index over titles, aliases (references, acronyms, old names, the other
 * language), headings, error messages, places and text, tolerant to typos,
 * accents, plurals and word beginnings. The best match first; then by drawer
 * with the breadcrumb and a highlighted excerpt; notes linked to the best one;
 * a filter on drawer, product, repository, type, status. Built from the notes,
 * kept in memory, never written into the KB.
 */
export type FindHit = {
  readonly path: BundlePath;
  readonly title: string;
  readonly type: string;
  readonly drawer: string | null;
  readonly product: string | null;
  readonly repo: string | null;
  readonly crumbs: readonly string[];
  readonly snippet: string;
  readonly score: number;
  readonly concept: boolean;
  readonly status: string;
};

export type FindResult = {
  readonly query: string;
  readonly best: FindHit | null;
  readonly hits: readonly FindHit[];
  readonly related: readonly { readonly path: BundlePath; readonly title: string }[];
  readonly facets: { readonly drawer: Record<string, number>; readonly product: Record<string, number>; readonly type: Record<string, number> };
  readonly ms: number;
  /** 🔒 notes that matched but were left out (searches run for Claude). */
  readonly hidden?: number;
};

export type FindFilter = { readonly drawer?: string; readonly product?: string; readonly repo?: string; readonly type?: string; readonly status?: string };

type Doc = { id: string; title: string; aliases: string; headings: string; errors: string; place: string; body: string; type: string };

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Words as the index sees them: no accents, no case, a plural is its singular. */
export function processTerm(term: string): string | null {
  const t = fold(term);
  if (!t) return null;
  return t.length > 3 && /[a-z]s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t.length > 4 && /aux$/.test(t) ? `${t.slice(0, -3)}al` : t;
}

/** Lines that look like error messages, normalised (numbers, paths and ids removed) so a new occurrence matches. */
export function errorSignature(line: string): string {
  return fold(line)
    .replace(/(['"`]).*?\1/g, ' ')
    .replace(/(\/[\w.-]+)+/g, ' ')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/g, ' ')
    // Dates, times, line numbers, ids: anything with a digit changes from one occurrence to the next.
    .replace(/[\w:.-]*\d[\w:.-]*/g, ' ')
    .replace(/[^\p{L}\p{N}_ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ERROR_LINE = /\b(error|erreur|exception|failed|échec|fatal|refused|denied|timeout|not found|introuvable|E[A-Z]{2,}|[A-Z][a-zA-Z]+Error)\b/;

function errorsOf(body: string): string {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const l = line.replace(/^[\s>`*-]+/, '').trim();
    if (l.length >= 8 && l.length <= 300 && ERROR_LINE.test(l)) out.push(errorSignature(l));
    if (out.length >= 20) break;
  }
  return out.join('\n');
}

function plain(body: string): string {
  return body.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^🧭.*$/gm, ' ').replace(/[#>*_|`]/g, ' ').replace(/\s+/g, ' ').trim();
}

function typeOf(e: KbEntry): string {
  return e.ext.brain?.type ?? e.ext.template ?? e.type;
}

type MeaningDoc = { id: string; roots: string };
type Built = {
  key: string; layoutKey: string; shas: Map<string, string>;
  index: MiniSearch<Doc>; meaning: MiniSearch<MeaningDoc>; docs: Map<string, Doc>; meaningDocs: Map<string, MeaningDoc>; bodies: Map<string, string>;
  out: Map<string, BundlePath[]>; incoming: Map<string, BundlePath[]>;
};
const cache = new Map<string, Built>();
/** How much the meaning can add, relative to the best word match (tuned on tests/fixtures/reformulated). */
const MEANING_WEIGHT = 0.6;
/** Beyond this share of changed notes, building again is quicker than updating. */
const REBUILD_SHARE = 0.3;

function emptyIndexes(): { index: MiniSearch<Doc>; meaning: MiniSearch<MeaningDoc> } {
  const index = new MiniSearch<Doc>({
    fields: ['title', 'aliases', 'headings', 'errors', 'place', 'body'],
    storeFields: ['title', 'type'],
    processTerm,
    searchOptions: { boost: { title: 6, aliases: 6, errors: 4, headings: 2, place: 1.5, body: 1 }, fuzzy: 0.2, prefix: true, processTerm },
  });
  // The meaning index: roots of words and families of synonyms (src/find/meaning.ts), searched beside the words.
  const meaning = new MiniSearch<MeaningDoc>({ fields: ['roots'], processTerm: (t) => t, searchOptions: { processTerm: (t) => t } });
  return { index, meaning };
}

/** What the indexes hold for one note: a function of the note and the layout only. */
function docsOf(layout: BrainLayout | null, bundle: Bundle, e: KbEntry): { doc: Doc; meaning: MeaningDoc; body: string } {
  const note = bundle.docs.get(e.path);
  const body = note ? plain(note.body) : '';
  const brain = e.ext.brain ?? {};
  const aliases = [...(e.ext.aliases ?? []), brain.ref ?? '', posix.basename(e.path, '.md')].filter(Boolean);
  const place = layout ? positionOf(layout, e.path).crumbs.join(' ') : posix.dirname(e.path).replace(/\//g, ' ');
  const doc: Doc = { id: e.path, title: e.title, aliases: aliases.join(' '), headings: e.headings.join(' '), errors: note ? errorsOf(note.body) : '', place, body: body.slice(0, 6000), type: typeOf(e) };
  // The title counts three times: it says what the note is about.
  const titleRoots = roots(`${e.title} ${aliases.join(' ')}`).join(' ');
  const meaning = { id: e.path, roots: [titleRoots, titleRoots, titleRoots, roots(e.headings.join(' ')).join(' '), roots(body.slice(0, 6000)).join(' ')].join(' ') };
  return { doc, meaning, body };
}

/**
 * The indexes of a KB, tied to its revision (F2.0-22): built once, then
 * updated note by note when some notes changed, were added or were deleted.
 * An update leaves the indexes as a build from scratch would.
 */
function build(layout: BrainLayout | null, bundle: Bundle): Built {
  const key = sha256(bundle.entries.map((e) => `${e.path}:${e.sha256}`).join('|'));
  const layoutKey = JSON.stringify(layout);
  const hit = cache.get(bundle.root);
  if (hit && hit.key === key && hit.layoutKey === layoutKey) return hit;

  const indexed = bundle.entries.filter((e) => !e.reserved);
  const shas = new Map(indexed.map((e) => [e.path as string, e.sha256]));
  const changed = hit && hit.layoutKey === layoutKey ? indexed.filter((e) => hit.shas.get(e.path) !== e.sha256) : null;
  const gone = hit && changed ? [...hit.shas.keys()].filter((p) => !shas.has(p)) : null;
  const update = hit && changed && gone && changed.length + gone.length <= Math.max(1, indexed.length * REBUILD_SHARE);

  const base = update ? hit : { ...emptyIndexes(), docs: new Map<string, Doc>(), meaningDocs: new Map<string, MeaningDoc>(), bodies: new Map<string, string>() };
  const { index, meaning, docs, meaningDocs, bodies } = base;
  for (const p of update ? [...gone!, ...changed!.map((e) => e.path as string)] : []) {
    const before = docs.get(p);
    if (!before) continue;
    index.remove(before);
    meaning.remove(meaningDocs.get(p)!);
    docs.delete(p); meaningDocs.delete(p); bodies.delete(p);
  }
  for (const e of update ? changed! : indexed) {
    const made = docsOf(layout, bundle, e);
    docs.set(e.path, made.doc); meaningDocs.set(e.path, made.meaning); bodies.set(e.path, made.body);
    index.add(made.doc);
    meaning.add(made.meaning);
  }
  // Links between notes, once per version of the KB (the breadcrumb's links go up to the subjects: not relations).
  const out = new Map<string, BundlePath[]>();
  const incoming = new Map<string, BundlePath[]>();
  for (const [p, doc] of bundle.docs) {
    const crumb = doc.body.split('\n').find((l) => l.startsWith('🧭')) ?? '';
    const targets = [...new Set(extractLinks(doc.body).filter((l) => !crumb.includes(l.url)).map((l) => resolveInternal(p, l.url)).filter((x): x is BundlePath => Boolean(x) && bundle.byPath.has(x!) && x !== p))];
    out.set(p, targets);
    for (const t of targets) incoming.set(t, [...(incoming.get(t) ?? []), p as BundlePath]);
  }
  const built = { key, layoutKey, shas, index, meaning, docs, meaningDocs, bodies, out, incoming };
  cache.set(bundle.root, built);
  return built;
}

function snippet(body: string, terms: readonly string[]): string {
  const lower = fold(body);
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(fold(t)); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return body.slice(0, 160);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${body.slice(start, start + 180)}${start + 180 < body.length ? '…' : ''}`;
}

export type FindOptions = FindFilter & { readonly hideSecret?: boolean; readonly limit?: number; readonly boostRepo?: string; readonly boostProduct?: string; readonly scores?: ReadonlyMap<string, number>; readonly now?: Date;
  /** Only notes that hold every word: no fallback to « any word », no search by meaning. For results shown beside the person's own (the notes of colleagues), where a loose match is noise. */
  readonly allWords?: boolean };

export function findNotes(config: OkbConfig, bundle: Bundle, query: string, options: FindOptions = {}): FindResult {
  const t0 = Date.now();
  const layout = layoutOf(config);
  const built = build(layout, bundle);
  const q = query.trim();
  const expanded = bilingual(q);
  // Every word of the person's own query: the translations widen a search, they are not words to require.
  let words = q ? built.index.search(options.allWords ? q : expanded, { combineWith: 'AND' }) : [];
  if (!words.length && q && !options.allWords) words = built.index.search(expanded, { combineWith: 'OR' });
  // Words and meaning, merged: the words lead (an exact term stays on top); the meaning lifts or finds what they miss.
  const sense = q && !options.allWords ? built.meaning.search(meaningQuery(q).join(' '), { combineWith: 'OR' }) : [];
  const topWords = words[0]?.score ?? 0;
  const topSense = sense[0]?.score ?? 0;
  const merged = new Map<string, { id: string; score: number; terms: string[] }>();
  for (const r of words) merged.set(r.id as string, { id: r.id as string, score: r.score, terms: r.terms });
  for (const r of sense) {
    const lift = topSense ? (r.score / topSense) * (topWords ? MEANING_WEIGHT * topWords : 1) : 0;
    const prev = merged.get(r.id as string);
    merged.set(r.id as string, prev ? { ...prev, score: prev.score + lift } : { id: r.id as string, score: lift, terms: r.terms });
  }
  const raw = [...merged.values()].sort((a, b) => b.score - a.score);
  const now = options.now ?? new Date();
  const hits: FindHit[] = [];
  let hidden = 0;
  for (const r of raw) {
    const e = bundle.byPath.get(r.id as BundlePath);
    if (!e) continue;
    const pos = layout ? positionOf(layout, e.path) : null;
    const type = typeOf(e);
    if (options.hideSecret && (e.ext as { confidentiality?: string }).confidentiality === 'secret') { hidden++; continue; }
    if (options.type && !options.type.split(',').includes(type)) continue;
    if (options.drawer && pos?.drawer !== options.drawer) continue;
    if (options.product && pos?.product !== options.product) continue;
    if (options.repo && pos?.repo !== options.repo) continue;
    if (options.status && e.status !== options.status) continue;
    let score = r.score;
    if (options.boostRepo && pos?.repo === options.boostRepo) score *= 1.4;
    else if (options.boostProduct && pos?.product === options.boostProduct) score *= 1.2;
    const at = (bundle.docs.get(e.path)?.data.generated as { at?: string } | undefined)?.at;
    if (at && now.getTime() - Date.parse(at) < 30 * 86_400_000) score *= 1.1;
    const s = options.scores?.get(e.path);
    if (s !== undefined) score *= 0.9 + (0.2 * s) / 100;
    if (e.status === 'deprecated') score *= 0.6;
    const concept = type === 'concept' || type === 'acronym' || e.type === 'Concept';
    hits.push({
      path: e.path, title: e.title, type, drawer: pos?.drawer ?? null, product: pos?.product ?? null, repo: pos?.repo ?? null,
      crumbs: pos?.crumbs ?? posix.dirname(e.path).split('/'), snippet: snippet(built.bodies.get(e.path) ?? '', r.terms), score: Math.round(score * 100) / 100, concept, status: e.status,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  // An exact title, alias or reference is the best match whatever the scores say.
  const exact = q ? hits.find((h) => fold(h.title) === fold(q) || fold(built.docs.get(h.path)?.aliases ?? '').split(' ').includes(fold(q))) : undefined;
  const best = exact ?? hits[0] ?? null;
  const ordered = best ? [best, ...hits.filter((h) => h !== best)] : hits;
  const limited = ordered.slice(0, options.limit ?? 30);
  const facets = { drawer: {} as Record<string, number>, product: {} as Record<string, number>, type: {} as Record<string, number> };
  for (const h of hits) {
    if (h.drawer) facets.drawer[h.drawer] = (facets.drawer[h.drawer] ?? 0) + 1;
    if (h.product) facets.product[h.product] = (facets.product[h.product] ?? 0) + 1;
    facets.type[h.type] = (facets.type[h.type] ?? 0) + 1;
  }
  const related: { path: BundlePath; title: string }[] = [];
  if (best) {
    for (const p of [...(built.out.get(best.path) ?? []), ...(built.incoming.get(best.path) ?? [])]) {
      if (related.length >= 8) break;
      if (!related.some((r) => r.path === p)) related.push({ path: p, title: bundle.byPath.get(p)?.title ?? p });
    }
  }
  const shown = (path: string) => !options.hideSecret || (bundle.byPath.get(path as BundlePath)?.ext as { confidentiality?: string } | undefined)?.confidentiality !== 'secret';
  return { query: q, best, hits: limited, related: related.filter((r) => !r.path.endsWith('Accueil.md') && shown(r.path)).slice(0, 8), facets, ms: Date.now() - t0, ...(hidden ? { hidden } : {}) };
}

/* --------------------------------------------- searches that found nothing */

function emptyFile(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'find', 'empty.jsonl');
}

export async function recordEmpty(config: OkbConfig, query: string): Promise<void> {
  if (query.trim().length < 3) return;
  try { await appendLine(emptyFile(config), JSON.stringify({ at: new Date().toISOString(), q: query.trim().slice(0, 120) })); } catch { /* never breaks a search */ }
}

/** Searches that found nothing more than once in 30 days: knowledge worth a note. */
export async function knowledgeGaps(config: OkbConfig, now = new Date()): Promise<{ query: string; times: number; last: string }[]> {
  const counts = new Map<string, { query: string; times: number; last: string }>();
  for (const row of await readLines(emptyFile(config)).catch(() => [] as string[])) {
    try {
      const r = JSON.parse(row) as { at: string; q: string };
      if (now.getTime() - Date.parse(r.at) > 30 * 86_400_000) continue;
      const k = fold(r.q);
      const c = counts.get(k) ?? { query: r.q, times: 0, last: r.at };
      counts.set(k, { query: c.query, times: c.times + 1, last: r.at > c.last ? r.at : c.last });
    } catch { /* cut line */ }
  }
  return [...counts.values()].filter((c) => c.times >= 2).sort((a, b) => b.times - a.times);
}

/* ------------------------------------------------ notes that come to you */

/** Notes about a file of a repository: they cite it (sources, anchors) or name it. */
export function notesAboutFile(bundle: Bundle, repoName: string, relFile: string, anchors: Readonly<Record<string, { files?: Record<string, unknown> }>> = {}): { path: BundlePath; title: string; why: string }[] {
  const out: { path: BundlePath; title: string; why: string }[] = [];
  const base = posix.basename(relFile);
  for (const [path, anchor] of Object.entries(anchors)) {
    if (anchor.files && Object.hasOwn(anchor.files, relFile) && bundle.byPath.has(path as BundlePath)) out.push({ path: path as BundlePath, title: bundle.byPath.get(path as BundlePath)!.title, why: 'written from this file' });
  }
  for (const [path, doc] of bundle.docs) {
    if (out.some((o) => o.path === path)) continue;
    const sources = Array.isArray(doc.data.sources) ? (doc.data.sources as { title?: unknown }[]) : [];
    if (sources.some((s) => typeof s?.title === 'string' && (s.title === `${repoName}/${relFile}` || s.title.endsWith(`/${relFile}`)))) { out.push({ path, title: bundle.byPath.get(path)?.title ?? path, why: 'cites this file' }); continue; }
    if (relFile.length > 6 && doc.body.includes(relFile)) out.push({ path, title: bundle.byPath.get(path)?.title ?? path, why: 'names this file' });
    else if (base.length > 8 && new RegExp(`\`[^\`]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\`]*\``).test(doc.body)) out.push({ path, title: bundle.byPath.get(path)?.title ?? path, why: 'names this file' });
  }
  return out.slice(0, 6);
}

/** Known errors that match an error message (a test or a command that failed). */
export function knownErrors(config: OkbConfig, bundle: Bundle, text: string): FindHit[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => ERROR_LINE.test(l)).slice(0, 5);
  if (!lines.length) return [];
  const query = errorSignature(lines.join(' ')).split(' ').filter((w) => w.length > 3).slice(0, 12).join(' ');
  if (!query) return [];
  const result = findNotes(config, bundle, query, { limit: 5 });
  return result.hits.filter((h) => h.type === 'known-error' || /erreur connue|known error/i.test(h.title) || (bundle.docs.get(h.path) && errorsOf(bundle.docs.get(h.path)!.body).length > 0)).filter((h) => h.score >= 8).slice(0, 2);
}
