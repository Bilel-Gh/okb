import type { ConceptAssistLevel, OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { normalizeSurface } from '../kb/search.js';
import type { Block, NormalizedDoc } from '../sources/types.js';
import type { BundlePath } from '../util/paths.js';
import { buildLexicon, lookup, type Lexicon, type LexiconTerm } from './lexicon.js';

export type CandidateKind = 'known-term' | 'acronym' | 'phrase' | 'fundamental';

export type Resolution =
  | { readonly status: 'existing'; readonly path: BundlePath; readonly via: 'title' | 'alias' }
  | { readonly status: 'ambiguous'; readonly options: readonly { path: BundlePath; sense: string | null }[] }
  | { readonly status: 'missing' }
  | { readonly status: 'needs-clarification'; readonly reason: string };

export type ConceptCandidate = {
  readonly surface: string;
  readonly canonical: string;
  readonly kind: CandidateKind;
  readonly occurrences: number;
  readonly firstBlockId: string;
  readonly evidenceBlockIds: readonly string[];
  readonly resolution: Resolution;
  readonly score: number;
  readonly rationale: string;
  /** Expansion found *in the source*, never invented. */
  readonly expansionFromSource?: { readonly text: string; readonly blockId: string };
  /** Full verbatim evidence, with an optional shorter display-only excerpt. */
  readonly evidenceQuotes?: readonly { readonly blockId: string; readonly quote: string; readonly displayQuote?: string }[];
  /** The full concept from a version 2 dossier, rendered with the concept template. */
  readonly rich?: import('../pipeline/analysis.js').RichConcept;
};

export type DetectOptions = {
  readonly level?: ConceptAssistLevel;
  readonly domain?: string;
};

const COMMON_ACRONYMS = new Set([
  'OK', 'ID', 'URL', 'URI', 'API', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'HTML', 'CSS', 'PDF', 'CSV',
  'UTC', 'ISO', 'FAQ', 'PR', 'CI', 'CD', 'UI', 'UX', 'OS', 'IT', 'AI', 'ML', 'TODO', 'NOTE',
]);

const ACRONYM_RE = /\b([A-Z][A-Z0-9]{1,6})\b/g;
const PHRASE_RE = /\b([A-Z][\p{Ll}]+(?:\s+[A-Z][\p{Ll}]+){1,2})\b/gu;
const BACKTICK_RE = /`([^`\n]{2,40})`/g;

/**
 * Resolve the effective assist level: a per-import override beats the per-domain
 * setting, which beats the profile default.
 */
export function effectiveLevel(
  config: OkbConfig,
  options: DetectOptions = {},
): ConceptAssistLevel {
  if (options.level) return options.level;
  if (options.domain) {
    const perDomain = config.conceptAssist.byDomain[options.domain];
    if (perDomain) return perDomain;
  }
  return config.conceptAssist.level;
}

export function detectConcepts(
  doc: NormalizedDoc,
  bundle: Bundle,
  config: OkbConfig,
  options: DetectOptions = {},
): { candidates: ConceptCandidate[]; level: ConceptAssistLevel; lexicon: Lexicon } {
  const level = effectiveLevel(config, options);
  const lexicon = buildLexicon(bundle, config.kb.layout.concepts);
  if (level === 'off') return { candidates: [], level, lexicon };

  const known = new Set(config.conceptAssist.known.map(normalizeSurface));
  const stop = new Set(config.conceptAssist.stoplist.map(normalizeSurface));
  const fundamentals = new Set(config.conceptAssist.fundamentals.map(normalizeSurface));
  const limits = config.conceptAssist.limits;

  type Acc = {
    surface: string;
    kind: CandidateKind;
    occurrences: number;
    blockIds: string[];
    expansion?: { text: string; blockId: string };
  };
  const acc = new Map<string, Acc>();

  const bump = (surface: string, kind: CandidateKind, block: Block) => {
    const canonical = normalizeSurface(surface);
    if (canonical.length < 2) return;
    if (known.has(canonical) || stop.has(canonical)) return;
    const prev = acc.get(canonical);
    if (prev) {
      prev.occurrences += 1;
      if (prev.blockIds.length < 5 && !prev.blockIds.includes(block.id)) prev.blockIds.push(block.id);
      if (rank(kind) < rank(prev.kind)) prev.kind = kind;
      return;
    }
    acc.set(canonical, { surface, kind, occurrences: 1, blockIds: [block.id] });
  };

  for (const block of doc.blocks) {
    // Code blocks are quoted material, not prose to analyse for vocabulary.
    if (block.kind === 'code') continue;
    const text = block.text;

    for (const { surface } of lexicon.surfacesByLength) {
      if (surface.length < 3) continue;
      if (containsSurface(text, surface)) bump(surface, 'known-term', block);
    }

    for (const m of text.matchAll(ACRONYM_RE)) {
      const acronym = m[1]!;
      if (COMMON_ACRONYMS.has(acronym)) continue;
      bump(acronym, 'acronym', block);
      const expansion = findExpansion(text, acronym);
      if (expansion) {
        const entry = acc.get(normalizeSurface(acronym));
        if (entry && !entry.expansion) entry.expansion = { text: expansion, blockId: block.id };
      }
    }

    for (const m of text.matchAll(BACKTICK_RE)) {
      const term = m[1]!.trim();
      if (/[(){};=<>/\\]/.test(term)) continue;
      bump(term, 'phrase', block);
    }

    if (level === 'pedagogical') {
      for (const m of text.matchAll(PHRASE_RE)) bump(m[1]!, 'phrase', block);
      for (const fundamental of fundamentals) {
        if (containsSurface(text, fundamental)) bump(fundamental, 'fundamental', block);
      }
    }
  }

  const candidates: ConceptCandidate[] = [];
  for (const [canonical, item] of acc) {
    if (item.occurrences < limits.minTermOccurrences) continue;
    if (level === 'targeted' && item.kind === 'phrase' && item.occurrences < 2) continue;

    const found = lookup(lexicon, canonical);
    const scoped = options.domain ? found?.senses.filter(s => s.domain === options.domain) : undefined;
    const term = scoped?.length ? { ...found!, senses: scoped, ambiguous: scoped.length > 1 } : found;
    const resolution = resolve(term, item.kind, item.expansion !== undefined);
    const score = scoreOf(item.kind, item.occurrences, resolution, config, options.domain);

    candidates.push({
      surface: item.surface,
      canonical,
      kind: item.kind,
      occurrences: item.occurrences,
      firstBlockId: item.blockIds[0]!,
      evidenceBlockIds: item.blockIds,
      resolution,
      score,
      rationale: rationaleFor(item.kind, item.occurrences, resolution),
      ...(item.expansion ? { expansionFromSource: item.expansion } : {}),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  return {
    candidates: candidates.slice(0, limits.maxSuggestionsPerSource),
    level,
    lexicon,
  };
}

function rank(kind: CandidateKind): number {
  return { 'known-term': 0, acronym: 1, fundamental: 2, phrase: 3 }[kind];
}

function containsSurface(text: string, surface: string): boolean {
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, 'iu').test(text);
}

/**
 * Only explicit, in-source expansions count: `DRX (Delivery Routing eXchange)`,
 * the mirrored form, or a spelled-out "stands for". Anything else leaves the
 * acronym unexpanded on purpose.
 */
function findExpansion(text: string, acronym: string): string | null {
  const a = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = new RegExp(`${a}\\s*\\(([^)]{4,80})\\)`).exec(text);
  if (after && plausibleExpansion(after[1]!, acronym)) return after[1]!.trim();
  const before = new RegExp(`([\\p{L}][\\p{L}\\s'-]{3,80}?)\\s*\\(\\s*${a}\\s*\\)`, 'u').exec(text);
  if (before && plausibleExpansion(before[1]!, acronym)) return before[1]!.trim();
  const spelled = new RegExp(
    `${a}\\s+(?:stands for|means|est l'acronyme de|signifie)\\s+([\\p{L}][\\p{L}\\s'-]{3,80}?)\\s*(?:[,.;]|$)`,
    'iu',
  ).exec(text);
  if (spelled && plausibleExpansion(spelled[1]!, acronym)) return spelled[1]!.trim();
  return null;
}

function plausibleExpansion(candidate: string, acronym: string): boolean {
  const words = candidate.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const initials = words
    .filter((w) => /^\p{Lu}/u.test(w) || w.length > 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return initials.includes(acronym[0]!.toUpperCase()) && words.length >= acronym.length - 2;
}

function resolve(
  term: LexiconTerm | undefined,
  kind: CandidateKind,
  hasExpansion: boolean,
): Resolution {
  if (!term) {
    if (kind === 'acronym' && !hasExpansion) {
      return {
        status: 'needs-clarification',
        reason: 'acronym with no expansion found in the source and no existing card',
      };
    }
    return { status: 'missing' };
  }
  if (term.ambiguous) {
    return {
      status: 'ambiguous',
      options: term.senses.map((s) => ({ path: s.path, sense: s.senseKey })),
    };
  }
  const sense = term.senses[0]!;
  if (sense.entry.ext.needs_clarification) {
    return {
      status: 'needs-clarification',
      reason: `existing card ${sense.path} is flagged needs_clarification`,
    };
  }
  const viaTitle = normalizeSurface(sense.entry.title) === term.canonical;
  return { status: 'existing', path: sense.path, via: viaTitle ? 'title' : 'alias' };
}

function scoreOf(
  kind: CandidateKind,
  occurrences: number,
  resolution: Resolution,
  config: OkbConfig,
  domain?: string,
): number {
  let score = { 'known-term': 8, acronym: 7, fundamental: 4, phrase: 3 }[kind];
  score += Math.min(6, Math.log2(occurrences + 1) * 2);
  if (resolution.status === 'existing') score += 3;
  if (resolution.status === 'ambiguous') score += 2;
  if (resolution.status === 'needs-clarification') score += 1;
  if (domain && config.conceptAssist.deepen.includes(domain)) score += 2;
  return Number(score.toFixed(3));
}

function rationaleFor(kind: CandidateKind, occurrences: number, resolution: Resolution): string {
  const base = {
    'known-term': 'already part of the knowledge base vocabulary',
    acronym: 'acronym that a new reader cannot expand',
    fundamental: 'fundamental notion listed in the profile',
    phrase: 'recurring domain phrase',
  }[kind];
  const where = {
    existing: 'an existing card covers it',
    ambiguous: 'several cards claim this surface form',
    missing: 'no card covers it yet',
    'needs-clarification': 'meaning is not established',
  }[resolution.status];
  return `${base}; seen ${occurrences}×; ${where}`;
}
