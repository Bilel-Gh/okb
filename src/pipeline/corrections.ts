import type { Block, NormalizedDoc } from '../sources/types.js';
import { formatLocator } from '../sources/types.js';

export type Correction = {
  readonly correctingBlockId: string;
  readonly correctedBlockId: string | null;
  readonly marker: string;
  readonly quote: string;
  readonly locator: string;
  readonly sharedTerms: readonly string[];
};

const MARKERS: readonly { re: RegExp; label: string }[] = [
  { re: /\b(en fait|en réalité|je me trompe|je me suis trompé|correction|erratum|pardon)\b/i, label: 'correction (fr)' },
  { re: /\b(actually|correction|i misspoke|scratch that|let me correct|my mistake|to be precise)\b/i, label: 'correction (en)' },
  { re: /\b(sauf si|sauf quand|à l'exception de|exception faite)\b/i, label: 'exception (fr)' },
  { re: /\b(except when|except if|unless|edge case)\b/i, label: 'exception (en)' },
  { re: /\b(ne .{0,20} (pas|plus|jamais)|n'est pas|ce n'est pas)\b/i, label: 'negation (fr)' },
  { re: /\b(is not|does not|doesn't|never|no longer)\b/i, label: 'negation (en)' },
];

const CONTENT_WORD = /[\p{L}][\p{L}\p{N}_-]{3,}/gu;
const STOP_WORDS = new Set(['that', 'this', 'with', 'from', 'have', 'will', 'were', 'been', 'days', 'actually', 'correction', 'dans', 'pour', 'avec', 'mais', 'plus', 'nous', 'vous', 'cette', 'cela', 'jours', 'fait', 'pardon']);

/**
 * A later sentence that corrects an earlier one is the single most dangerous
 * thing to lose when summarising a long transcript: the summary keeps the wrong
 * version. These pairs are surfaced so both survive into the proposal.
 */
export function detectCorrections(doc: NormalizedDoc, lookBack = Infinity): Correction[] {
  const out: Correction[] = [];
  const blocks = doc.blocks;
  const previousByTerm = new Map<string, number[]>();

  for (const [i, block] of blocks.entries()) {
    const marker = MARKERS.find((m) => m.re.test(block.text));
    const terms = contentWords(block.text);
    if (marker) {
    let best: { block: Block; shared: string[] } | null = null;
    // An inverted index reaches distant corrections without comparing every
    // pair of cues. This is a lexical candidate, never proof of contradiction.
    const candidates = new Map<number, string[]>();
    for (const term of terms) for (const j of previousByTerm.get(term) ?? []) {
      if (j < i - lookBack) continue;
      const shared = candidates.get(j) ?? []; shared.push(term); candidates.set(j, shared);
    }
    for (const [j, shared] of [...candidates].sort((a, b) => b[0] - a[0])) {
      const prev = blocks[j]!;
      if (shared.length >= 2 && (!best || shared.length > best.shared.length)) {
        best = { block: prev, shared };
      }
    }

    out.push({
      correctingBlockId: block.id,
      correctedBlockId: best?.block.id ?? null,
      marker: marker.label,
      quote: block.text,
      locator: formatLocator(block.locator),
      sharedTerms: best?.shared.slice(0, 6) ?? [],
    });
    }
    for (const term of terms) {
      const previous = previousByTerm.get(term) ?? []; previous.push(i); previousByTerm.set(term, previous);
    }
  }

  return out;
}

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(CONTENT_WORD)) if (!STOP_WORDS.has(m[0]!)) out.add(m[0]!);
  return out;
}
