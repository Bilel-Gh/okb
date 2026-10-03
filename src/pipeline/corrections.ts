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

/**
 * A later sentence that corrects an earlier one is the single most dangerous
 * thing to lose when summarising a long transcript: the summary keeps the wrong
 * version. These pairs are surfaced so both survive into the proposal.
 */
export function detectCorrections(doc: NormalizedDoc, lookBack = 12): Correction[] {
  const out: Correction[] = [];
  const blocks = doc.blocks;

  for (const [i, block] of blocks.entries()) {
    const marker = MARKERS.find((m) => m.re.test(block.text));
    if (!marker) continue;

    const terms = contentWords(block.text);
    let best: { block: Block; shared: string[] } | null = null;
    for (let j = i - 1; j >= Math.max(0, i - lookBack); j -= 1) {
      const prev = blocks[j]!;
      const shared = [...contentWords(prev.text)].filter((t) => terms.has(t));
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

  return out;
}

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(CONTENT_WORD)) out.add(m[0]!);
  return out;
}
