import { resolve } from 'node:path';
import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import type { Block, NormalizedDoc } from '../sources/types.js';
import { statePaths } from '../state/paths.js';
import { assertId } from '../util/paths.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { OkbError } from '../util/errors.js';
import { withStateLock } from '../util/state-lock.js';

const factSchema = z.object({
  id: z.string().min(1).max(120), kind: z.enum(['fact', 'decision', 'action', 'suggestion', 'question', 'uncertainty', 'correction']),
  text: z.string().min(1).max(2000), owner: z.string().min(1).max(200).optional(), due: z.string().min(1).max(200).optional(),
  evidence: z.array(z.object({ blockId: z.string(), quote: z.string().min(1).max(4000) }).strict()).min(1).max(20),
  supersedes: z.array(z.string().min(1).max(120)).max(50).default([]),
}).strict();
type Fact = z.infer<typeof factSchema>;
const resultSchema = z.object({ windowId: z.string().min(1), facts: z.array(factSchema).max(200) }).strict();
type Window = { id: string; blockIds: string[]; facts?: Fact[] };
type Reading = { sourceId: string; sha256: string; adapter: string; adapterVersion: string; windows: Window[] };
export function windowIdentity(doc: NormalizedDoc, blocks: readonly Block[]) {
  return { id: sha256(`${doc.source.id}:${doc.source.sha256}:${doc.source.adapter}:${doc.source.adapterVersion}:${blocks.map(b => b.id).join(',')}`).slice(0, 24), blocks: blocks.length };
}
function file(config: OkbConfig, run: string) { return resolve(statePaths(config).runs, assertId(run, 'run id'), 'reading.json'); }
async function load(config: OkbConfig, run: string, doc: NormalizedDoc): Promise<Reading> {
  const reading = await readJsonIfExists<Reading>(file(config, run));
  if (reading && (reading.sourceId !== doc.source.id || reading.sha256 !== doc.source.sha256 || reading.adapter !== doc.source.adapter || reading.adapterVersion !== doc.source.adapterVersion)) throw new OkbError('E_CONFLICT', 'reading cache belongs to a different source or extraction; start a new run');
  return reading ?? { sourceId: doc.source.id, sha256: doc.source.sha256, adapter: doc.source.adapter, adapterVersion: doc.source.adapterVersion, windows: [] };
}

/** A delivered window is issued, but never marked processed until a result arrives. */
export async function issueWindow(config: OkbConfig, run: string, doc: NormalizedDoc, blocks: readonly Block[]): Promise<{ id: string; blocks: number }> {
  const blockIds = blocks.map(b => b.id);
  const { id } = windowIdentity(doc, blocks);
  await withStateLock(file(config, run), async () => {
    const reading = await load(config, run, doc);
    if (!reading.windows.some(w => w.id === id)) {
      reading.windows.push({ id, blockIds }); await writeJsonAtomic(file(config, run), reading);
    }
  });
  return { id, blocks: blocks.length };
}

export async function recordWindow(config: OkbConfig, run: string, doc: NormalizedDoc, input: unknown): Promise<void> {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid reading result', { detail: { issues: parsed.error.issues } });
  await withStateLock(file(config, run), async () => {
    const reading = await load(config, run, doc);
    const window = reading.windows.find(w => w.id === parsed.data.windowId);
    if (!window) throw new OkbError('E_INVALID', 'window was not delivered by this source run');
    const ids = new Set(window.blockIds); const blocks = new Map(doc.blocks.map(b => [b.id, b]));
    const existing = new Map(reading.windows.filter(w => w.id !== window.id).flatMap(w => w.facts ?? []).map(f => [f.id, f]));
    for (const fact of existing.values()) for (const prior of fact.supersedes) {
      if (window.facts?.some(f => f.id === prior) && !parsed.data.facts.some(f => f.id === prior)) throw new OkbError('E_CONFLICT', 'cannot remove a fact referenced by a later correction');
    }
    const seen = new Set<string>();
    for (const fact of parsed.data.facts) {
      if (seen.has(fact.id) || existing.has(fact.id)) throw new OkbError('E_CONFLICT', `fact id already used: ${fact.id}`);
      seen.add(fact.id);
      for (const evidence of fact.evidence) if (!ids.has(evidence.blockId) || !blocks.get(evidence.blockId)?.text.includes(evidence.quote)) throw new OkbError('E_INVALID', 'evidence must quote an exact passage in this window');
      const quotes = fact.evidence.map(e => e.quote).join('\n');
      const speakers = fact.evidence.map(e => blocks.get(e.blockId)?.speaker ?? '');
      if (fact.owner && !quotes.includes(fact.owner) && !speakers.includes(fact.owner)) throw new OkbError('E_INVALID', 'action owner is not present in the cited passages');
      if (fact.due && !quotes.includes(fact.due)) throw new OkbError('E_INVALID', 'deadline must be explicit in the cited passages');
      if (fact.kind !== 'action' && (fact.owner || fact.due)) throw new OkbError('E_INVALID', 'only explicit actions have an owner or deadline');
      for (const prior of fact.supersedes) {
        if (prior === fact.id) throw new OkbError('E_INVALID', 'a fact cannot supersede itself');
        const old = existing.get(prior) ?? parsed.data.facts.find(f => f.id === prior);
        if (!old) throw new OkbError('E_INVALID', `superseded fact is unknown: ${prior}`);
        if (Math.max(...old.evidence.map(e => blocks.get(e.blockId)?.index ?? Infinity)) >= Math.min(...fact.evidence.map(e => blocks.get(e.blockId)!.index))) throw new OkbError('E_INVALID', 'a correction must cite a later passage');
      }
    }
    const merged = new Map([...existing, ...parsed.data.facts.map(f => [f.id, f] as const)]);
    for (const fact of merged.values()) for (const prior of fact.supersedes) {
      const old = merged.get(prior);
      if (!old || Math.max(...old.evidence.map(e => blocks.get(e.blockId)?.index ?? Infinity)) >= Math.min(...fact.evidence.map(e => blocks.get(e.blockId)?.index ?? -1))) throw new OkbError('E_CONFLICT', 'editing this fact would invalidate a later correction');
    }
    window.facts = parsed.data.facts; await writeJsonAtomic(file(config, run), reading);
  });
}

export async function readingReport(config: OkbConfig, run: string, doc: NormalizedDoc) {
  const reading = await load(config, run, doc);
  const processed = new Set(reading.windows.filter(w => w.facts !== undefined).flatMap(w => w.blockIds));
  const delivered = new Set(reading.windows.flatMap(w => w.blockIds));
  const unprocessedRanges: { start: number; end: number }[] = [];
  for (const block of doc.blocks) if (!processed.has(block.id)) {
    const last = unprocessedRanges.at(-1);
    if (last && last.end === block.index - 1) last.end = block.index; else unprocessedRanges.push({ start: block.index, end: block.index });
  }
  const allFacts = reading.windows.flatMap(w => w.facts ?? []);
  const facts = allFacts.map(f => {
    const supersededBy = allFacts.filter(later => later.supersedes.includes(f.id)).map(later => later.id);
    return { ...f, status: supersededBy.length ? 'superseded' as const : 'current' as const, supersededBy };
  });
  return {
    source: doc.source, coverage: { totalBlocks: doc.blocks.length, deliveredBlocks: delivered.size, processedBlocks: processed.size, complete: processed.size === doc.blocks.length && doc.blocks.length > 0, extractionComplete: doc.source.support === 'full', unprocessedRanges },
    windows: reading.windows.map(w => ({ id: w.id, blocks: w.blockIds.length, processed: w.facts !== undefined })), facts,
    limits: ['Processing is reported by the caller, not proof of semantic reading or complete facts.', 'Exact quotations are verified, not the truth or entailment of authored conclusions.', 'Supersession is explicitly declared; unresolved contradictions must remain visible.', ...doc.source.limitations],
  };
}
