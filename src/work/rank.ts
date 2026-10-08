import type { Bundle } from '../kb/bundle.js';
import { resolveInternal } from '../links/portable.js';
import { REPOS_FOLDER } from '../repo/pack.js';
import type { BundlePath } from '../util/paths.js';

/**
 * Ranking inside a scope. A KB that documents twenty repositories answers a
 * question about one of them best when that repository's notes come first,
 * then the shared notes tied to it (business concepts, features, decisions
 * it links to or that name it), then the rest of the shared notes, and the
 * other repositories' notes last: same facts, less noise, fewer tokens.
 */
export type ScopeRank = {
  readonly repo: string;
  /** Repositories it talks to: their notes stay closer than unrelated ones. */
  readonly neighbours: readonly string[];
  readonly tied: ReadonlyMap<BundlePath, number>;
};

/** Markdown link targets, read with a pattern: enough to rank, much faster than parsing. */
function linkTargets(from: BundlePath, body: string): BundlePath[] {
  const out: BundlePath[] = [];
  for (const m of body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = resolveInternal(from, m[1]!);
    if (target && target.endsWith('.md')) out.push(target);
  }
  return out;
}

/** The repository a note belongs to (`x_okb.repo.id` or `repos/<id>/`), or null for a shared note. */
export function noteRepo(bundle: Bundle, path: BundlePath): string | null {
  const meta = (bundle.docs.get(path)?.data.x_okb as { repo?: { id?: unknown } } | undefined)?.repo;
  if (typeof meta?.id === 'string' && meta.id !== '*') return meta.id;
  const parts = path.split('/');
  if (parts[0] === REPOS_FOLDER && parts.length > 2) return parts[1]!;
  // A brain: `2 Produits/<product>/Code/<repo>/…`.
  return /^\d+ [^/]+$/.test(parts[0] ?? '') && parts[2] === 'Code' && parts.length > 4 ? parts[3]! : null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shared notes tied to a repository, strongest first: linked from its notes
 * (3 per link), linking to them (2), or naming it in their text (1 per
 * mention, at most 3).
 */
export function tiedNotes(bundle: Bundle, repo: { id: string; name: string }): Map<BundlePath, number> {
  const mine = new Set<BundlePath>();
  for (const path of bundle.docs.keys()) if (noteRepo(bundle, path) === repo.id) mine.add(path);
  const score = new Map<BundlePath, number>();
  const add = (p: BundlePath, n: number) => score.set(p, (score.get(p) ?? 0) + n);
  const names = [...new Set([repo.name, repo.id])].filter((n) => n.length >= 3);
  const mention = names.length ? new RegExp(`(?<![\\w-])(${names.map(escape).join('|')})(?![\\w-])`, 'giu') : null;
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved) continue;
    const isMine = mine.has(path);
    for (const target of linkTargets(path, doc.body)) {
      if (isMine && !mine.has(target) && noteRepo(bundle, target) === null) add(target, 3);
      if (!isMine && mine.has(target) && noteRepo(bundle, path) === null) add(path, 2);
    }
    if (!isMine && mention && noteRepo(bundle, path) === null) {
      const hits = Math.min(3, [...doc.body.matchAll(mention)].length + (mention.test(doc.data.title as string ?? '') ? 2 : 0));
      mention.lastIndex = 0;
      if (hits) add(path, hits);
    }
  }
  for (const p of score.keys()) if (!bundle.byPath.has(p) || bundle.byPath.get(p)!.reserved) score.delete(p);
  return score;
}

export function scopeRank(bundle: Bundle, repo: { id: string; name: string }, neighbours: readonly string[] = []): ScopeRank {
  return { repo: repo.id, neighbours, tied: tiedNotes(bundle, repo) };
}

/**
 * How a note's score changes in this scope, and why: multiplied, plus a fixed
 * lift for the scope's own notes so that a passing mention in the repository
 * still beats another repository's note on a different subject.
 */
export function scopeFactor(bundle: Bundle, rank: ScopeRank, path: BundlePath): { factor: number; bonus: number; why: string } {
  const owner = noteRepo(bundle, path);
  if (owner === rank.repo) return { factor: 1.6, bonus: 6, why: 'scope:repo' };
  if (owner) return rank.neighbours.includes(owner) ? { factor: 0.8, bonus: 0, why: 'scope:neighbour' } : { factor: 0.35, bonus: 0, why: 'scope:other-repo' };
  const tie = rank.tied.get(path) ?? 0;
  if (tie >= 3) return { factor: 1.5, bonus: 3, why: 'scope:tied' };
  if (tie > 0) return { factor: 1.2, bonus: 1, why: 'scope:mentions' };
  return { factor: 1, bonus: 0, why: '' };
}
