import MiniSearch from 'minisearch';
import type { NormalizedDoc } from '../sources/types.js';
import { detectCorrections, type Correction } from './corrections.js';

export type SourceHit = { blockId: string; score: number; blockIds: string[] };
const indexes = new Map<string, { index: MiniSearch; corrections: Correction[]; positions: Map<string, number> }>();
const normal = (term: string) => term.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const stopWords = new Set('a an the is are was were be been what which who how why do does did can could would should of to from in on at for with and or it this that que quel quelle quels quelles qui quoi ou comment pourquoi est sont le la les un une des du de au aux en dans sur pour avec et il elle ce cette ces'.split(' '));

/** Full snapshot indexing, with a small LRU. No caption text is cleaned or lost. */
export function querySource(doc: NormalizedDoc, query: string): SourceHit[] {
  const key = `${doc.source.id}:${doc.source.sha256}:${doc.source.adapter}:${doc.source.adapterVersion}`;
  let cached = indexes.get(key);
  if (!cached) {
    const index = new MiniSearch({ fields: ['text'], processTerm: term => { const word = normal(term); return stopWords.has(word) ? null : word; } });
    index.addAll(doc.blocks.map(b => ({ id: b.id, text: b.text })));
    cached = { index, positions: new Map(doc.blocks.map((b, i) => [b.id, i])), corrections: detectCorrections(doc) };
    indexes.set(key, cached); if (indexes.size > 4) indexes.delete(indexes.keys().next().value!);
  } else { indexes.delete(key); indexes.set(key, cached); }
  const { index, positions, corrections } = cached;
  return index.search(query, { combineWith: 'AND', prefix: false, fuzzy: false }).map(hit => {
    const i = positions.get(String(hit.id))!;
    const ids = new Set(doc.blocks.slice(Math.max(0, i - 1), i + 2).map(b => b.id));
    for (const correction of corrections) if (correction.correctedBlockId === hit.id || correction.correctingBlockId === hit.id) {
      ids.add(correction.correctingBlockId); if (correction.correctedBlockId) ids.add(correction.correctedBlockId);
    }
    return { blockId: String(hit.id), score: hit.score, blockIds: [...ids].sort((a, b) => positions.get(a)! - positions.get(b)!) };
  });
}
