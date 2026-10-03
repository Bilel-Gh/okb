import type { Bundle, KbEntry } from './bundle.js';
import type { BundlePath } from '../util/paths.js';

export type SearchHit = {
  readonly entry: KbEntry;
  readonly score: number;
  readonly why: readonly string[];
  /** Short body excerpts around the strongest matches. */
  readonly excerpts: readonly { readonly text: string; readonly line: number }[];
};

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'is', 'are', 'for', 'on', 'with', 'that',
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est', 'sont', 'pour', 'dans',
  'ce', 'cette', 'au', 'aux', 'qui', 'que', 'sur', 'par', 'avec',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_+#.-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Lexical scoring only. No embeddings, no network: a local second brain must
 * answer with the same guarantees offline, and a wrong-but-confident semantic
 * hit is worse than an honest miss.
 */
export function searchBundle(
  bundle: Bundle,
  query: string,
  options: { limit?: number; includeReserved?: boolean; status?: readonly string[] } = {},
): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const limit = options.limit ?? 10;

  const hits: SearchHit[] = [];
  for (const entry of bundle.entries) {
    if (!options.includeReserved && entry.reserved) continue;
    if (options.status && !options.status.includes(entry.status)) continue;

    const doc = bundle.docs.get(entry.path);
    const body = doc?.body ?? '';
    const bodyLower = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const why: string[] = [];
    let score = 0;

    const titleTokens = new Set(tokenize(entry.title));
    const aliasTokens = new Set((entry.ext.aliases ?? []).flatMap(tokenize));
    const tagTokens = new Set(entry.tags.flatMap(tokenize));
    const descTokens = new Set(tokenize(entry.description));
    const headingTokens = new Set(entry.headings.flatMap(tokenize));

    for (const term of terms) {
      if (titleTokens.has(term)) {
        score += 12;
        why.push(`title:${term}`);
      }
      if (aliasTokens.has(term)) {
        score += 10;
        why.push(`alias:${term}`);
      }
      if (tagTokens.has(term)) {
        score += 6;
        why.push(`tag:${term}`);
      }
      if (descTokens.has(term)) {
        score += 5;
        why.push(`description:${term}`);
      }
      if (headingTokens.has(term)) {
        score += 4;
        why.push(`heading:${term}`);
      }
      const occurrences = countOccurrences(bodyLower, term);
      if (occurrences > 0) {
        score += Math.min(6, 1 + Math.log2(occurrences));
        why.push(`body:${term}×${occurrences}`);
      }
    }

    if (score === 0) continue;
    if (entry.status === 'deprecated') score *= 0.4;
    if (entry.status === 'draft') score *= 0.85;

    hits.push({ entry, score, why, excerpts: excerptsFor(body, terms).map(e => ({ ...e, line: e.line + (doc?.raw.slice(0, doc.bodyOffset).match(/\n/g)?.length ?? 0) })) });
  }

  return hits.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path)).slice(0, limit);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length < 2) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function excerptsFor(
  body: string,
  terms: readonly string[],
  max = 2,
): { text: string; line: number }[] {
  const lines = body.split('\n');
  const out: { text: string; line: number }[] = [];
  for (const [i, line] of lines.entries()) {
    const lower = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (terms.some((t) => lower.includes(t))) {
      const trimmed = line.trim();
      if (trimmed.length > 0) out.push({ text: trimmed.slice(0, 220), line: i + 1 });
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Find documents that already cover a term, before proposing to create one. */
export function findExisting(
  bundle: Bundle,
  surface: string,
): { exact: KbEntry[]; alias: KbEntry[]; fuzzy: KbEntry[] } {
  const norm = normalizeSurface(surface);
  const exact: KbEntry[] = [];
  const alias: KbEntry[] = [];
  const fuzzy: KbEntry[] = [];
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    if (normalizeSurface(entry.title) === norm) exact.push(entry);
    else if ((entry.ext.aliases ?? []).some((a) => normalizeSurface(a) === norm)) alias.push(entry);
    else if (normalizeSurface(entry.path.split('/').pop()!.replace(/\.md$/, '')) === norm) exact.push(entry);
    else if (normalizeSurface(entry.title).includes(norm) && norm.length >= 4) fuzzy.push(entry);
  }
  return { exact, alias, fuzzy };
}

export function normalizeSurface(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function pathOf(entry: KbEntry): BundlePath {
  return entry.path;
}
