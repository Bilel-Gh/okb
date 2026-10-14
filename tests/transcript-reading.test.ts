import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { detectCorrections } from '../src/pipeline/corrections.js';
import { querySource } from '../src/pipeline/source-query.js';
import { issueWindow, recordWindow, readingReport } from '../src/pipeline/reading.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(sandboxes.splice(0).map(s => s.cleanup())); });
async function fixture() {
  const s = await makeSandbox({ profileId: 'meeting' }); sandboxes.push(s);
  const config = await s.config(); const path = resolve(s.dir, 'long.vtt');
  const clock = (i: number) => `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000`;
  const text = (i: number) => i === 0 ? 'The retention policy is thirty days.' : i === 79 ? 'Correction: the retention policy is seven days, not thirty days.' : i === 78 ? 'ZQX remains an unknown acronym; nobody defined it.' : `Topic ${i}: a suggestion to investigate subsystem ${i}.`;
  await writeFixture(path, 'WEBVTT\n\n' + Array.from({ length: 80 }, (_, i) => `${clock(i)} --> ${clock(i + 1)}\n<v Dana>${text(i)}</v>`).join('\n\n'));
  const doc = await extractSource(await acquire(path, config), config);
  return { config, doc };
}

describe('long meeting reading, without a model', () => {
  it('invalidates query and processing caches when a changed budget shifts block boundaries', async () => {
    const { config } = await fixture();
    const input = { uri: 'file:///single-long-cue.vtt', filename: 'cue.vtt', bytes: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\n<v Dana>' + 'neutral text '.repeat(760) + 'SPLITBOUNDARY</v>') };
    const first = await extractSource(input, config);
    const next = await extractSource(input, { ...config, context: { ...config.context, budgets: { ...config.context.budgets, ingestOutputTokens: 500 } } });
    querySource(first, 'SPLITBOUNDARY');
    const hits = querySource(next, 'SPLITBOUNDARY');
    expect(next.blocks.filter(b => hits[0]?.blockIds.includes(b.id)).map(b => b.text).join(' ')).toContain('SPLITBOUNDARY');
    await issueWindow(config, 'shifted-boundaries', first, first.blocks);
    await expect(readingReport(config, 'shifted-boundaries', next)).rejects.toMatchObject({ code: 'E_CONFLICT' });
  });
  it('links a final correction to the earlier passage across distant windows', async () => {
    const { doc } = await fixture();
    expect(detectCorrections(doc).find(c => c.correctingBlockId === doc.blocks[79]!.id)?.correctedBlockId).toBe(doc.blocks[0]!.id);
  });

  it('finds a late acronym and its neighbours without modifying repeated captions or claiming full coverage', async () => {
    const { doc } = await fixture();
    const before = JSON.stringify(doc);
    const hits = querySource(doc, 'ZQX');
    expect(hits[0]?.blockIds).toEqual([doc.blocks[77]!.id, doc.blocks[78]!.id, doc.blocks[79]!.id]);
    expect(querySource(doc, 'retention policy')[0]?.blockIds).toContain(doc.blocks[79]!.id);
    expect(querySource(doc, 'What is the retention policy?')).toHaveLength(2);
    expect(JSON.stringify(doc)).toBe(before);
    expect(querySource(doc, 'unmentioned acronym')).toEqual([]);
  });

  it('counts reported processing separately from delivery and preserves a superseded fact with its citations', async () => {
    const { config, doc } = await fixture(); const run = 'meeting-run';
    const first = await issueWindow(config, run, doc, doc.blocks.slice(0, 40));
    const last = await issueWindow(config, run, doc, doc.blocks.slice(40));
    expect((await readingReport(config, run, doc)).coverage.processedBlocks).toBe(0);
    const original = { id: 'retention-original', kind: 'fact', text: 'Thirty days were first stated.', evidence: [{ blockId: doc.blocks[0]!.id, quote: doc.blocks[0]!.text }] };
    const correction = { id: 'retention-final', kind: 'correction', text: 'The speaker corrected retention to seven days.', supersedes: ['retention-original'], evidence: [{ blockId: doc.blocks[79]!.id, quote: doc.blocks[79]!.text }] };
    await recordWindow(config, run, doc, { windowId: first.id, facts: [original] });
    expect((await readingReport(config, run, doc)).coverage.unprocessedRanges).toEqual([{ start: 40, end: 79 }]);
    await recordWindow(config, run, doc, { windowId: last.id, facts: [correction] });
    await recordWindow(config, run, doc, { windowId: last.id, facts: [correction] });
    const report = await readingReport(config, run, doc);
    expect(report.coverage).toMatchObject({ complete: true, processedBlocks: 80, totalBlocks: 80 });
    expect(report.facts).toHaveLength(2);
    expect(report.facts.find(f => f.id === 'retention-original')).toMatchObject({ status: 'superseded', supersededBy: ['retention-final'] });
    expect(report.facts.find(f => f.id === 'retention-final')).toMatchObject({ status: 'current' });
    expect(report.limits.join(' ')).toContain('not proof');
  });

  it('rejects invented quotes, facts outside a window, undeclared windows and unsupported action owners', async () => {
    const { config, doc } = await fixture(); const run = 'meeting-run';
    const window = await issueWindow(config, run, doc, doc.blocks.slice(0, 4));
    const fact = { id: 'a', kind: 'action', text: 'Investigate.', owner: 'Invented Person', evidence: [{ blockId: doc.blocks[1]!.id, quote: doc.blocks[1]!.text }] };
    await expect(recordWindow(config, run, doc, { windowId: window.id, facts: [fact] })).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(recordWindow(config, run, doc, { windowId: window.id, facts: [{ ...fact, owner: undefined, evidence: [{ blockId: doc.blocks[79]!.id, quote: doc.blocks[79]!.text }] }] })).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(recordWindow(config, run, doc, { windowId: window.id, facts: [{ ...fact, owner: undefined, evidence: [{ blockId: doc.blocks[1]!.id, quote: 'Not in the transcript' }] }] })).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(recordWindow(config, run, doc, { windowId: 'unissued', facts: [] })).rejects.toMatchObject({ code: 'E_INVALID' });
    expect((await readingReport(config, run, doc)).coverage.processedBlocks).toBe(0);
  });

  it('invalidates source indexes and reading checkpoints when source or extraction changes', async () => {
    const { config, doc } = await fixture(); const run = 'meeting-run';
    await issueWindow(config, run, doc, doc.blocks.slice(0, 4));
    const changed = { ...doc, source: { ...doc.source, sha256: 'a'.repeat(64) }, blocks: doc.blocks.map(b => ({ ...b, text: b.text.replace('ZQX', 'ABC') })) };
    expect(querySource(changed, 'ZQX')).toEqual([]);
    expect(querySource(changed, 'ABC')).toHaveLength(1);
    await expect(readingReport(config, run, changed)).rejects.toMatchObject({ code: 'E_CONFLICT' });
  });
});
