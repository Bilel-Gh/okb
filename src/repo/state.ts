import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { assertId } from '../util/paths.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import type { NoteKind } from './questions.js';
import type { RepoMap } from './types.js';

/**
 * Private working state of a repository's onboarding, outside the KB like every
 * other OKB run: the last scan, what has been read (coverage), findings from
 * the reading agents, answers people gave, and which note cites which files at
 * which commit (anchors, for freshness). Nothing here is knowledge until a
 * proposal turns it into a note someone approved.
 */
export type RepoPaths = {
  readonly dir: string;
  readonly map: string;
  readonly facts: string;
  readonly progress: string;
  readonly findings: string;
  readonly answers: string;
  readonly tickets: string;
  readonly drafts: string;
};

export function repoPaths(config: OkbConfig, id: string): RepoPaths {
  assertId(id, 'repository id');
  const dir = resolve(statePaths(config).root, 'repos', id);
  return {
    dir,
    map: resolve(dir, 'map.json'),
    facts: resolve(dir, 'git-facts.md'),
    progress: resolve(dir, 'progress.json'),
    findings: resolve(dir, 'findings'),
    answers: resolve(dir, 'answers'),
    tickets: resolve(dir, 'tickets'),
    drafts: resolve(dir, 'drafts'),
  };
}

export async function ensureRepoState(paths: RepoPaths): Promise<void> {
  for (const d of [paths.dir, paths.findings, paths.answers, paths.tickets, paths.drafts]) await ensureDir(d);
}

export type Coverage = {
  /** `all`, or the line ranges read ("12-80"). */
  readonly lines: 'all' | readonly string[];
  readonly at: string | null;
  readonly by: 'findings' | 'note' | 'person';
};

export type QuestionState = {
  readonly status: 'answered' | 'partial' | 'unknown' | 'received';
  readonly note?: string;
  readonly proposalId?: string;
  readonly why?: string;
  readonly askWho?: string;
  readonly looked?: readonly string[];
  readonly answerFile?: string;
  readonly at: string;
};

export type Anchor = {
  readonly commit: string | null;
  /** Repository-relative file → sha256 of the bytes the note cites. */
  readonly files: Readonly<Record<string, string>>;
  /** Exact quotes per file, to find where they moved. */
  readonly quotes: Readonly<Record<string, readonly string[]>>;
  readonly proposalId: string;
  readonly kind: NoteKind | 'ticket' | 'other';
  readonly at: string;
};

export type Progress = {
  readonly version: 1;
  coverage: Record<string, Coverage>;
  questions: Record<string, QuestionState>;
  anchors: Record<string, Anchor>;
  answers: { readonly id: string; readonly question: string | null; readonly file: string; readonly by: string; readonly at: string }[];
  findings: { readonly id: string; readonly area: string; readonly file: string; readonly claims: number; readonly at: string }[];
  updatedAt: string;
};

export function emptyProgress(): Progress {
  return { version: 1, coverage: {}, questions: {}, anchors: {}, answers: [], findings: [], updatedAt: new Date().toISOString() };
}

export async function loadProgress(paths: RepoPaths): Promise<Progress> {
  return (await readJsonIfExists<Progress>(paths.progress)) ?? emptyProgress();
}

export async function saveProgress(paths: RepoPaths, progress: Progress): Promise<void> {
  progress.updatedAt = new Date().toISOString();
  await writeJsonAtomic(paths.progress, progress);
}

export async function loadMap(paths: RepoPaths): Promise<RepoMap | null> {
  return readJsonIfExists<RepoMap>(paths.map);
}

/** Merge line coverage: `all` wins, ranges accumulate. */
export function addCoverage(progress: Progress, file: string, lines: 'all' | readonly string[], at: string | null, by: Coverage['by']): void {
  const before = progress.coverage[file];
  if (before?.lines === 'all' || lines === 'all') {
    progress.coverage[file] = { lines: 'all', at, by };
    return;
  }
  const merged = mergeRanges([...(before?.lines ?? []), ...lines]);
  progress.coverage[file] = { lines: merged, at, by };
}

export function parseRange(range: string): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:[-–:]\s*(\d+))?\s*$/.exec(range);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return a >= 1 && b >= a ? [a, b] : null;
}

export function mergeRanges(ranges: readonly string[]): string[] {
  const parsed = ranges.map(parseRange).filter((r): r is [number, number] => r !== null).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const r of parsed) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`));
}

export function linesCovered(c: Coverage | undefined, total: number | null): number {
  if (!c) return 0;
  if (c.lines === 'all') return total ?? 0;
  return c.lines.map(parseRange).reduce((n, r) => n + (r ? r[1] - r[0] + 1 : 0), 0);
}

export async function listJson(dir: string): Promise<string[]> {
  try { return (await readdir(dir)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
}
