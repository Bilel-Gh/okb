import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { searchBundle, type SearchHit } from '../kb/search.js';
import { detectConcepts } from '../concepts/detect.js';
import { buildPrereqChain } from '../concepts/prereq.js';
import { paginate, type Truncation } from '../util/context-meter.js';
import type { BundlePath } from '../util/paths.js';
import { scopeFactor, type ScopeRank } from '../work/rank.js';

export type AnswerEvidence = {
  readonly path: BundlePath;
  readonly title: string;
  readonly status: string;
  readonly trust: string;
  readonly line: number;
  readonly quote: string;
};

export type AskResult = {
  readonly query: string;
  readonly hits: readonly {
    readonly path: BundlePath;
    readonly title: string;
    readonly description: string;
    readonly status: string;
    readonly trust: string;
    readonly score: number;
    readonly why: readonly string[];
  }[];
  readonly evidence: readonly AnswerEvidence[];
  /** Concept cards worth reading first, ordered foundations-first. */
  readonly prerequisites: readonly { readonly path: BundlePath; readonly title: string }[];
  readonly truncation: Truncation;
  readonly notes: readonly string[];
};

/**
 * Retrieval only. The product returns located evidence and never composes an
 * answer itself: the caller (a human or the model) writes the prose, and every
 * claim it makes can be traced back to one of these excerpts.
 */
export async function ask(
  config: OkbConfig,
  query: string,
  options: { limit?: number; cursor?: string | null; bundle?: Bundle; scope?: ScopeRank } = {},
): Promise<AskResult> {
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const limit = options.limit ?? config.context.pageSize;
  const notes: string[] = [];

  const found = searchBundle(bundle, query, { limit: 200 });
  // In a repository's scope, its notes and the shared notes tied to it come first.
  const scope = options.scope;
  const all = scope
    ? found.map((h) => {
      const f = scopeFactor(bundle, scope, h.entry.path);
      return f.why ? { ...h, score: h.score * f.factor + f.bonus, why: [f.why, ...h.why] } : h;
    }).sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    : found;
  const { page, truncation } = paginate(all, { limit, cursor: options.cursor ?? null });

  const evidence: AnswerEvidence[] = [];
  for (const hit of page.slice(0, config.profile.answer.maxEvidencePerAnswer)) {
    for (const excerpt of hit.excerpts) {
      evidence.push({
        path: hit.entry.path,
        title: hit.entry.title,
        status: hit.entry.status,
        trust: hit.entry.trust,
        line: excerpt.line,
        quote: excerpt.text,
      });
    }
  }

  const prerequisites = collectPrerequisites(bundle, page, config);

  if (page.some((h) => h.entry.status === 'draft')) {
    notes.push('some matches are `draft`: written but not checked against the system they describe');
  }
  if (page.some((h) => h.entry.trust === 'unverified')) {
    notes.push('some matches carry no `verified` entry; treat them as reported, not confirmed');
  }
  if (page.length === 0) {
    notes.push('nothing in the bundle matches; no answer is better than an invented one');
  }

  return {
    query,
    hits: page.map((h) => ({
      path: h.entry.path,
      title: h.entry.title,
      description: h.entry.description,
      status: h.entry.status,
      trust: h.entry.trust,
      score: Number(h.score.toFixed(2)),
      why: h.why.slice(0, 5),
    })),
    evidence,
    prerequisites,
    truncation,
    notes,
  };
}

function collectPrerequisites(
  bundle: Bundle,
  hits: readonly SearchHit[],
  config: OkbConfig,
): { path: BundlePath; title: string }[] {
  if (config.conceptAssist.level === 'off') return [];
  const depth = config.conceptAssist.limits.prereqDepth;
  if (depth <= 0) return [];

  const seen = new Set<BundlePath>();
  const out: { path: BundlePath; title: string }[] = [];
  for (const hit of hits.slice(0, 3)) {
    const chain = buildPrereqChain(bundle, hit.entry.path, { maxDepth: depth });
    for (const path of chain.order) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, title: bundle.byPath.get(path)?.title ?? path });
    }
  }
  return out.slice(0, 6);
}

/** Terms in a question that the bundle does not cover — gaps worth a card. */
export async function missingConceptsFor(
  config: OkbConfig,
  text: string,
  bundle?: Bundle,
): Promise<string[]> {
  const loaded = bundle ?? (await loadBundleFor(config));
  const fake = {
    source: {
      id: 'query',
      uri: 'query://ask',
      kind: 'markdown' as const,
      adapter: 'inline',
      adapterVersion: '1',
      sha256: '',
      bytes: text.length,
      acquiredAt: new Date().toISOString(),
      support: 'full' as const,
      limitations: [],
    },
    blocks: [
      {
        id: 'query#0',
        index: 0,
        kind: 'paragraph' as const,
        text,
        locator: { kind: 'line' as const, line: 1 },
      },
    ],
    outline: [],
  };
  const { candidates } = detectConcepts(fake, loaded, config);
  return candidates.filter((c) => c.resolution.status === 'missing').map((c) => c.surface);
}
