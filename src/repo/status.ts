import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { sha256 } from '../util/hash.js';
import type { BundlePath } from '../util/paths.js';
import { commitExists, diffNames, gitIdentity, type FileChange } from './git.js';
import { classify } from './inventory.js';
import { loadFindings, pendingRepoProposals, repoNotes, type RepoContext, type RepoNote } from './notes.js';
import { isFlat, notePath, PACK } from './pack.js';
import { QUESTIONS, type NoteKind } from './questions.js';
import { linesCovered, loadMap, loadProgress, type Progress } from './state.js';
import type { RepoMap } from './types.js';

export type QuestionView = {
  readonly id: string;
  readonly theme: string;
  /** answered: a note covers it · pending: covered by a proposal awaiting approval · received: a person answered, not written yet · found: reading agents found material · unknown: looked, not found · open: not looked at yet */
  readonly state: 'answered' | 'pending' | 'received' | 'found' | 'unknown' | 'open';
  readonly note?: string;
  readonly why?: string;
  readonly askWho?: string;
  readonly looked?: readonly string[];
  readonly hint: string;
};

export type RepoStatus = {
  readonly repo: { id: string; name: string; path: string; kb: string };
  readonly scan: { at: string | null; commit: string | null; behind: boolean; files: number | null };
  readonly head: string | null;
  readonly dirty: boolean;
  readonly notes: readonly { kind: NoteKind; path: string; state: 'written' | 'pending' | 'missing'; commit: string | null }[];
  readonly tickets: number;
  readonly otherNotes: number;
  readonly pending: readonly { id: string; paths: readonly string[] }[];
  readonly coverage: { readFiles: number; readTotal: number; skimFiles: number; skimTotal: number; linesRead: number; linesPlanned: number; filesRead: number };
  readonly questions: readonly QuestionView[];
  readonly findings: number;
  readonly answers: number;
  readonly stale: number;
  readonly next: readonly string[];
};

export async function repoStatus(ctx: RepoContext, options: { bundle?: Bundle } = {}): Promise<RepoStatus> {
  const { config, repo, paths } = ctx;
  const lang = config.writing.language ?? config.profile.answer.language;
  const [map, progress, identity, bundle, pending, findings] = await Promise.all([
    loadMap(paths), loadProgress(paths), gitIdentity(repo.path), options.bundle ?? loadBundleFor(config), pendingRepoProposals(config, repo.id), loadFindings(ctx),
  ]);
  const notes = repoNotes(bundle, repo.id, isFlat(config));
  const pendingPaths = new Set(pending.flatMap((p) => p.paths));
  const pack = PACK.map((p) => {
    const path = notePath(repo.id, p.kind, lang, isFlat(config));
    const written = notes.find((n) => n.path === path || n.kind === p.kind);
    return { kind: p.kind, path: written?.path ?? path, state: written ? 'written' as const : pendingPaths.has(path) ? 'pending' as const : 'missing' as const, commit: written?.commit ?? null };
  });
  const questions = questionViews(map, progress, findings.flatMap((f) => f.facts.map((x) => x.question).filter((q): q is string => Boolean(q))), notes, pendingPaths);
  const coverage = coverageOf(map, progress);
  const fresh = await freshness(ctx, { bundle, notes, progress, head: identity.head });
  const stale = fresh.notes.filter((n) => n.verdict === 'stale' || n.verdict === 'changed').length;
  const next: string[] = [];
  if (!map) next.push(`okb repo scan ${repo.id}`);
  else if (!pack.some((p) => p.state !== 'missing')) next.push('/okb:onboard');
  if (pending.length) next.push('okb review');
  if (stale) next.push(`okb repo update ${repo.id}`);
  if (questions.some((q) => q.state === 'unknown' || q.state === 'open')) next.push(`okb repo questions ${repo.id}`);
  return {
    repo: { id: repo.id, name: repo.name, path: repo.path, kb: repo.kb },
    scan: { at: map?.scannedAt ?? null, commit: map?.repo.head ?? null, behind: Boolean(map?.repo.head && identity.head && map.repo.head !== identity.head), files: map?.files.total ?? null },
    head: identity.head,
    dirty: identity.dirty,
    notes: pack,
    tickets: notes.filter((n) => n.kind === 'ticket').length,
    otherNotes: notes.filter((n) => n.kind === 'other').length,
    pending: pending.map((p) => ({ id: p.id, paths: p.paths })),
    coverage,
    questions,
    findings: findings.length,
    answers: progress.answers.length,
    stale,
    next: next.slice(0, 3),
  };
}

export function coverageOf(map: RepoMap | null, progress: Progress): RepoStatus['coverage'] {
  if (!map) return { readFiles: 0, readTotal: 0, skimFiles: 0, skimTotal: 0, linesRead: 0, linesPlanned: 0, filesRead: Object.keys(progress.coverage).length };
  const done = (path: string) => Boolean(progress.coverage[path]);
  const lines = (items: readonly { path: string; lines: number | null }[]) => items.reduce((n, i) => n + linesCovered(progress.coverage[i.path], i.lines), 0);
  return {
    readFiles: map.plan.read.filter((i) => done(i.path)).length,
    readTotal: map.plan.read.length,
    skimFiles: map.plan.skim.filter((i) => done(i.path)).length,
    skimTotal: map.plan.skim.length,
    linesRead: lines(map.plan.read) + lines(map.plan.skim),
    linesPlanned: map.plan.readLines + map.plan.skimLines,
    filesRead: Object.keys(progress.coverage).length,
  };
}

export function questionViews(map: RepoMap | null, progress: Progress, foundQuestions: readonly string[], notes: readonly RepoNote[], pendingPaths: ReadonlySet<string>): QuestionView[] {
  const found = new Set(foundQuestions);
  const written = new Set(notes.map((n) => n.path as string));
  return QUESTIONS.map((q) => {
    const saved = progress.questions[q.id];
    const hint = map?.questions.find((h) => h.id === q.id)?.status ?? 'unknown';
    const base = { id: q.id, theme: q.theme, hint };
    if (saved?.status === 'answered' && saved.note) {
      if (written.has(saved.note)) return { ...base, state: 'answered' as const, note: saved.note };
      if (pendingPaths.has(saved.note)) return { ...base, state: 'pending' as const, note: saved.note };
    }
    if (saved?.status === 'received') return { ...base, state: 'received' as const };
    if (found.has(q.id)) return { ...base, state: 'found' as const };
    if (saved?.status === 'unknown') return { ...base, state: 'unknown' as const, ...(saved.why ? { why: saved.why } : {}), ...(saved.askWho ? { askWho: saved.askWho } : {}), ...(saved.looked ? { looked: saved.looked } : {}) };
    return { ...base, state: 'open' as const };
  });
}

/* ------------------------------------------------------------ freshness */

export type NoteFreshness = {
  readonly path: BundlePath;
  readonly kind: string;
  readonly commit: string | null;
  /** fresh: nothing it cites changed · changed: cited files changed, quotes still there · stale: a quote or a file is gone · unknown: no commit to compare */
  readonly verdict: 'fresh' | 'changed' | 'stale' | 'unknown';
  readonly files: readonly { file: string; state: 'same' | 'changed' | 'deleted' | 'renamed'; to?: string; missingQuotes: number }[];
};

export type Freshness = {
  readonly head: string | null;
  readonly notes: readonly NoteFreshness[];
  /** Files added since the oldest note that usually deserve a line in the KB. */
  readonly news: readonly { file: string; why: string }[];
};

/** Repository files a note cites, from its frontmatter sources (`<repo name>/<path>`) and the anchors. */
function citedFiles(ctx: RepoContext, bundle: Bundle, path: BundlePath, progress: Progress): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const anchor = progress.anchors[path];
  for (const [file, sha] of Object.entries(anchor?.files ?? {})) out.set(file, sha);
  const sources = bundle.docs.get(path)?.data.sources;
  const prefix = `${ctx.repo.name}/`;
  if (Array.isArray(sources)) {
    for (const s of sources as { title?: unknown; resource?: unknown }[]) {
      if (typeof s?.title !== 'string' || !s.title.startsWith(prefix)) continue;
      const file = s.title.slice(prefix.length);
      const sha = typeof s.resource === 'string' ? /^urn:sha256:([a-f0-9]{64})$/.exec(s.resource)?.[1] ?? null : null;
      if (!out.has(file) || (sha && !out.get(file))) out.set(file, sha);
    }
  }
  return out;
}

export async function freshness(ctx: RepoContext, options: { bundle?: Bundle; notes?: readonly RepoNote[]; progress?: Progress; head?: string | null } = {}): Promise<Freshness> {
  const bundle = options.bundle ?? (await loadBundleFor(ctx.config));
  const notes = options.notes ?? repoNotes(bundle, ctx.repo.id, isFlat(ctx.config));
  const progress = options.progress ?? (await loadProgress(ctx.paths));
  const head = options.head !== undefined ? options.head : (await gitIdentity(ctx.repo.path)).head;
  const diffs = new Map<string, FileChange[] | null>();
  const out: NoteFreshness[] = [];
  let oldest: string | null = null;
  for (const note of notes) {
    const cited = citedFiles(ctx, bundle, note.path, progress);
    const commit = note.commit ?? progress.anchors[note.path]?.commit ?? null;
    if (!commit || !(await commitExists(ctx.repo.path, commit))) {
      out.push({ path: note.path, kind: note.kind, commit, verdict: cited.size ? 'unknown' : 'fresh', files: [] });
      continue;
    }
    if (!oldest) oldest = commit;
    if (!diffs.has(commit)) diffs.set(commit, await diffNames(ctx.repo.path, commit));
    const changes = diffs.get(commit) ?? [];
    const files: NoteFreshness['files'][number][] = [];
    for (const [file, sha] of cited) {
      const change = changes.find((c) => c.path === file || c.from === file);
      const quotes = progress.anchors[note.path]?.quotes[file] ?? [];
      if (!change) {
        // Unchanged in Git; still compare bytes when a fingerprint exists (uncommitted edits are in the diff anyway).
        if (sha) {
          const now = await readFile(resolve(ctx.repo.path, file)).then((b) => sha256(b), () => null);
          if (now && now !== sha) files.push({ file, state: 'changed', missingQuotes: await missing(ctx, file, quotes) });
        }
        continue;
      }
      if (change.status === 'D') { files.push({ file, state: 'deleted', missingQuotes: quotes.length }); continue; }
      if (change.status === 'R' && change.from === file) { files.push({ file, state: 'renamed', to: change.path, missingQuotes: await missing(ctx, change.path, quotes) }); continue; }
      files.push({ file, state: 'changed', missingQuotes: await missing(ctx, file, quotes) });
    }
    const verdict = files.some((f) => f.state === 'deleted' || f.missingQuotes > 0) ? 'stale' : files.length ? 'changed' : 'fresh';
    out.push({ path: note.path, kind: note.kind, commit, verdict, files });
  }
  const news: { file: string; why: string }[] = [];
  if (oldest) {
    for (const c of (diffs.get(oldest) ?? await diffNames(ctx.repo.path, oldest)) ?? []) {
      if (c.status !== 'A' && c.status !== 'R') continue;
      const { kind, why } = classify(c.path);
      if (['readme', 'adr', 'manifest', 'ci', 'api', 'schema', 'entry'].includes(kind)) news.push({ file: c.path, why });
    }
  }
  return { head, notes: out, news: news.slice(0, 30) };
}

async function missing(ctx: RepoContext, file: string, quotes: readonly string[]): Promise<number> {
  if (!quotes.length) return 0;
  const text = await readFile(resolve(ctx.repo.path, file), 'utf8').catch(() => null);
  if (text === null) return quotes.length;
  const normalized = text.replace(/\r\n/g, '\n');
  return quotes.filter((q) => !normalized.includes(q.replace(/\r\n/g, '\n'))).length;
}
