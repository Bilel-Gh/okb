import { layoutOf } from '../brain/layout.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { repoContext, repoNotes } from '../repo/notes.js';
import { isBrainPlace, type RepoPlace } from '../repo/pack.js';
import { QUESTIONS } from '../repo/questions.js';
import { findRepo, type RepoEntry } from '../repo/registry.js';
import { freshness, repoStatus } from '../repo/status.js';
import { repoPlace } from '../brain/products.js';
import { scoreBundle } from '../scores/scores.js';

/**
 * How well OKB knows a repository, computed without AI: « OKB knows this
 * repository at 72 % ». Five parts: the onboarding questions answered (30), the
 * repository's pages written and up to date (25), the key files read (20), the
 * memory of the work — tickets, traps, known errors (15) — and the quality of
 * its notes (10). Knowledge ages: a page whose code changed counts less. A
 * repository whose code is not linked on this computer is measured on its notes.
 */
export type Tier = 'discovery' | 'usable' | 'solid' | 'expert' | 'reference';
export type PartId = 'questions' | 'notes' | 'coverage' | 'work' | 'quality';
export type PageState = 'fresh' | 'changed' | 'stale' | 'missing';

export type LevelFacts = {
  readonly questions: { readonly answered: number; readonly half: number; readonly total: number } | null;
  readonly pages: readonly { readonly kind: string; readonly state: PageState }[];
  readonly coverage: { readonly read: number; readonly readTotal: number; readonly skim: number; readonly skimTotal: number } | null;
  /** Notes of the work: tickets, investigations, known errors, recipes, decisions… */
  readonly work: number;
  /** Average quality of the repository's notes, out of 100; null without notes. */
  readonly quality: number | null;
};

export type Gap = { readonly part: PartId; readonly points: number; readonly key: string; readonly params: Readonly<Record<string, string | number>> };

export type KnowledgeLevel = {
  readonly percent: number;
  readonly tier: Tier;
  /** Measured on the notes only: the code is not linked on this computer. */
  readonly partial: boolean;
  readonly parts: readonly { readonly id: PartId; readonly weight: number; readonly score: number; readonly measured: boolean }[];
  /** The three steps that bring the most points. */
  readonly next: readonly Gap[];
};

const WEIGHTS: Readonly<Record<PartId, number>> = { questions: 30, notes: 25, coverage: 20, work: 15, quality: 10 };
const PAGE_VALUE: Readonly<Record<PageState, number>> = { fresh: 1, changed: 0.6, stale: 0.3, missing: 0 };
/** Six notes of work or more fill the « memory of the work » part. */
const WORK_FULL = 6;
const QUALITY_GOOD = 80;

export function tierOf(percent: number): Tier {
  if (percent >= 90) return 'reference';
  if (percent >= 70) return 'expert';
  if (percent >= 45) return 'solid';
  if (percent >= 20) return 'usable';
  return 'discovery';
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function levelFromFacts(f: LevelFacts): KnowledgeLevel {
  const q = f.questions;
  const c = f.coverage;
  const covDen = c ? c.readTotal + 0.5 * c.skimTotal : 0;
  const scores: Record<PartId, number | null> = {
    questions: q ? (q.total ? clamp((q.answered + 0.5 * q.half) / q.total) : 0) : null,
    notes: f.pages.length ? clamp(f.pages.reduce((n, p) => n + PAGE_VALUE[p.state], 0) / f.pages.length) : 0,
    coverage: c ? (covDen ? clamp((c.read + 0.5 * c.skim) / covDen) : 0) : null,
    work: clamp(f.work / WORK_FULL),
    quality: f.quality === null ? 0 : clamp(f.quality / 100),
  };
  const parts = (Object.keys(WEIGHTS) as PartId[]).map((id) => ({ id, weight: WEIGHTS[id], score: scores[id] ?? 0, measured: scores[id] !== null }));
  const measured = parts.filter((p) => p.measured);
  const total = measured.reduce((n, p) => n + p.weight, 0);
  const got = measured.reduce((n, p) => n + p.weight * p.score, 0);
  const percent = total ? Math.round((got / total) * 100) : 0;
  // What brings the most, in points of the full 100.
  const gaps: Gap[] = [];
  const perPage = f.pages.length ? WEIGHTS.notes / f.pages.length : 0;
  for (const p of f.pages) {
    if (p.state === 'missing') gaps.push({ part: 'notes', points: round1(perPage), key: 'knowledge.gap.page', params: { kind: p.kind } });
    else if (p.state === 'stale') gaps.push({ part: 'notes', points: round1(perPage * (1 - PAGE_VALUE.stale)), key: 'knowledge.gap.stale', params: { kind: p.kind } });
    else if (p.state === 'changed') gaps.push({ part: 'notes', points: round1(perPage * (1 - PAGE_VALUE.changed)), key: 'knowledge.gap.changed', params: { kind: p.kind } });
  }
  if (q && q.total) {
    const open = q.total - q.answered;
    if (open > 0) {
      const count = Math.min(5, open);
      // The half-answered ones (found, received) first: they bring the other half.
      const fromHalf = Math.min(count, q.half);
      gaps.push({ part: 'questions', points: round1((WEIGHTS.questions / q.total) * (fromHalf * 0.5 + (count - fromHalf))), key: 'knowledge.gap.questions', params: { count } });
    }
  }
  if (c && covDen) {
    const left = c.readTotal - c.read;
    if (left > 0) {
      const count = Math.min(10, left);
      gaps.push({ part: 'coverage', points: round1((WEIGHTS.coverage * count) / covDen), key: 'knowledge.gap.coverage', params: { count } });
    }
  }
  if (f.work < WORK_FULL) {
    const count = Math.min(2, WORK_FULL - f.work);
    gaps.push({ part: 'work', points: round1((WEIGHTS.work * count) / WORK_FULL), key: 'knowledge.gap.work', params: { count } });
  }
  if (f.quality !== null && f.quality < QUALITY_GOOD) {
    gaps.push({ part: 'quality', points: round1((WEIGHTS.quality * (QUALITY_GOOD - f.quality)) / 100), key: 'knowledge.gap.quality', params: { average: Math.round(f.quality) } });
  }
  const next = gaps.filter((g) => g.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const partial = measured.length < parts.length;
  // Measured on the notes only, nobody checked them against the code: at most « solid ».
  const tier = partial && percent >= 70 ? 'solid' : tierOf(percent);
  return { percent, tier, partial, parts, next };
}

/* --------------------------------------------------------------- reading */

/** The pages a repository should have: in a brain, also how to test and debug it. */
const BRAIN_PAGES = ['repo-hub', 'repo-start', 'repo-architecture', 'repo-interfaces', 'repo-delivery', 'repo-codemap', 'repo-test', 'repo-debug'] as const;
const PACK_PAGES: Readonly<Record<string, string>> = { overview: 'repo-hub', start: 'repo-start', architecture: 'repo-architecture', interfaces: 'repo-interfaces', delivery: 'repo-delivery', codemap: 'repo-codemap' };
const WORK_TYPES = new Set(['ticket', 'investigation', 'known-error', 'recipe', 'decision', 'conventions', 'procedure', 'simplification', 'tech-debt']);

type RepoRef = { readonly id: string; readonly name: string; readonly product?: string | null; readonly folder?: string | null };

function brainTypeOf(bundle: Bundle, path: string): string | null {
  const t = (bundle.docs.get(path as never)?.data.x_okb as { brain?: { type?: unknown } } | undefined)?.brain?.type;
  return typeof t === 'string' ? t : null;
}

/** Notes under a repository's folder in a brain, with their type. */
function folderNotes(bundle: Bundle, folder: string): { path: string; type: string | null }[] {
  return bundle.entries.filter((e) => !e.reserved && e.path.startsWith(`${folder}/`)).map((e) => ({ path: e.path as string, type: brainTypeOf(bundle, e.path) }));
}

function averageQuality(scores: ReadonlyMap<string, { quality: number }>, paths: readonly string[]): number | null {
  const values = paths.map((p) => scores.get(p)?.quality).filter((x): x is number => typeof x === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type LevelOptions = { readonly env?: NodeJS.ProcessEnv; readonly bundle?: Bundle; readonly scores?: ReadonlyMap<string, { quality: number }> };

/** The level of one repository: from its code and notes when linked here, from its notes otherwise. */
export async function repoLevel(config: OkbConfig, repo: RepoRef, options: LevelOptions = {}): Promise<KnowledgeLevel> {
  const env = options.env ?? process.env;
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const scores = options.scores ?? new Map((await scoreBundle(config, bundle)).map((s) => [s.path as string, s]));
  const entry: RepoEntry | null = await findRepo(repo.id, env).then((r) => (r && r.kb === config.profile.id ? r : null), () => null);
  const inBrain = Boolean(layoutOf(config));
  if (!entry) {
    // Not linked: only the notes speak.
    const notes = repo.folder ? folderNotes(bundle, repo.folder) : [];
    const types = new Set(notes.map((n) => n.type));
    return levelFromFacts({
      questions: null, coverage: null,
      pages: BRAIN_PAGES.map((kind) => ({ kind, state: types.has(kind) ? 'fresh' as const : 'missing' as const })),
      work: notes.filter((n) => n.type && WORK_TYPES.has(n.type)).length,
      quality: averageQuality(scores, notes.map((n) => n.path)),
    });
  }
  const rctx = await repoContext(config, entry);
  const place: RepoPlace = await repoPlace(config, entry);
  const [status, fresh] = await Promise.all([repoStatus(rctx, { bundle }), freshness(rctx, { bundle })]);
  const verdict = new Map(fresh.notes.map((n) => [n.path as string, n.verdict]));
  const stateOf = (path: string | undefined): PageState => {
    if (!path) return 'missing';
    const v = verdict.get(path);
    return v === 'stale' ? 'stale' : v === 'changed' ? 'changed' : 'fresh';
  };
  let pages: { kind: string; state: PageState }[];
  let workCount: number;
  let notePaths: string[];
  if (inBrain && isBrainPlace(place)) {
    const notes = folderNotes(bundle, place.folder);
    pages = BRAIN_PAGES.map((kind) => ({ kind, state: stateOf(notes.find((n) => n.type === kind)?.path) }));
    workCount = notes.filter((n) => n.type && WORK_TYPES.has(n.type)).length;
    notePaths = notes.map((n) => n.path);
  } else {
    pages = Object.entries(PACK_PAGES).map(([kind, page]) => {
      const p = status.notes.find((n) => n.kind === kind);
      return { kind: page, state: p && p.state === 'written' ? stateOf(p.path) : 'missing' as const };
    });
    const notes = repoNotes(bundle, entry.id, place);
    workCount = notes.filter((n) => n.kind === 'ticket' || n.kind === 'other').length;
    notePaths = notes.map((n) => n.path as string);
  }
  const answered = status.questions.filter((x) => x.state === 'answered').length;
  const half = status.questions.filter((x) => x.state === 'pending' || x.state === 'received' || x.state === 'found').length;
  return levelFromFacts({
    questions: { answered, half, total: QUESTIONS.length },
    pages,
    coverage: { read: status.coverage.readFiles, readTotal: status.coverage.readTotal, skim: status.coverage.skimFiles, skimTotal: status.coverage.skimTotal },
    work: workCount,
    quality: averageQuality(scores, notePaths),
  });
}
