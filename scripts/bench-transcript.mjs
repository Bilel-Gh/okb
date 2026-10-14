/** Synthetic source only; no provider, tokeniser, network or personal profile. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { configSchema } from '../dist/config/schema.js';
import { extractSource } from '../dist/sources/registry.js';
import { detectCorrections } from '../dist/pipeline/corrections.js';
import { querySource } from '../dist/pipeline/source-query.js';
import { issueWindow, recordWindow, readingReport } from '../dist/pipeline/reading.js';
import { estimateTokens } from '../dist/util/context-meter.js';

const scratch = await mkdtemp(resolve(tmpdir(), 'okb-transcript-bench-'));
const started = performance.now();
try {
  const config = configSchema.parse({ profile: { id: 'synthetic-meeting' }, kb: { root: resolve(scratch, 'vault') }, stateHome: resolve(scratch, 'state') });
  const clock = i => `${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000`;
  const keyText = new Map([
    [0, 'The retention policy is thirty days.'],
    [340, 'I suggest investigating the exporter; this is not a commitment.'],
    [800, 'Dana will prepare the synthetic test by Friday.'],
    [1600, 'ZQX remains an unknown acronym. What does ZQX mean?'],
    [1799, 'Correction: the retention policy is seven days, not thirty days.'],
  ]);
  const cues = Array.from({ length: 1800 }, (_, i) => `${clock(i)} --> ${clock(i + 1)}\n<v Dana>${keyText.get(i) ?? (i % 40 === 0 ? 'The caption repeats this neutral discussion point.' : `Subsystem ${i}: the team describes the current synthetic configuration and asks for more evidence.`)}</v>`);
  const raw = 'WEBVTT Synthetic meeting\n\n' + cues.join('\n\n');
  const extractionStart = performance.now();
  const doc = await extractSource({ uri: 'file:///synthetic-meeting.vtt', filename: 'synthetic-meeting.vtt', bytes: Buffer.from(raw) }, config);
  const extractionMs = performance.now() - extractionStart;
  const baselineStart = performance.now(); const baselinePages = []; let baselineCursor = 0;
  // The previous page-local correction contract, with the same 4k estimated budget.
  while (baselineCursor < doc.blocks.length) {
    const page = doc.blocks.slice(baselineCursor, baselineCursor + 120);
    const envelope = () => ({ ok: true, source: doc.source, blocks: page, corrections: detectCorrections({ ...doc, blocks: page }, 12), truncation: { truncated: baselineCursor + page.length < doc.blocks.length, shown: page.length, total: doc.blocks.length, nextCursor: String(baselineCursor + page.length) } });
    while (page.length && estimateTokens(JSON.stringify(envelope(), null, 2)) > 4000) page.pop();
    if (!page.length) throw new Error('baseline budget cannot fit a block');
    baselinePages.push(JSON.stringify(envelope(), null, 2)); baselineCursor += page.length;
  }
  const baselineMs = performance.now() - baselineStart;
  const queryStart = performance.now(); const hits = querySource(doc, 'retention policy');
  const ids = new Set(hits.flatMap(h => h.blockIds)); const blocks = doc.blocks.filter(b => ids.has(b.id));
  const queryMs = performance.now() - queryStart;
  const cachedStart = performance.now(); querySource(doc, 'retention policy'); const cachedQueryMs = performance.now() - cachedStart;
  const queryText = JSON.stringify({ source: doc.source, blocks, corrections: detectCorrections(doc).filter(c => ids.has(c.correctingBlockId)), mode: 'targeted', completeMeeting: false }, null, 2);
  const fullStart = performance.now(); let totalWindowTokens = 0; let windows = 0;
  const kinds = new Map([[0, 'fact'], [340, 'suggestion'], [800, 'action'], [1600, 'question'], [1799, 'correction']]);
  for (let cursor = 0; cursor < doc.blocks.length;) {
    const page = doc.blocks.slice(cursor, cursor + 40);
    const window = await issueWindow(config, 'synthetic-run', doc, page);
    totalWindowTokens += estimateTokens(JSON.stringify({ window, blocks: page })); windows++;
    const facts = page.filter(b => keyText.has(b.index)).map(b => ({ id: `fact-${b.index}`, kind: kinds.get(b.index), text: b.text, evidence: [{ blockId: b.id, quote: b.text }], ...(b.index === 800 ? { owner: 'Dana', due: 'Friday' } : {}), ...(b.index === 1799 ? { supersedes: ['fact-0'] } : {}) }));
    await recordWindow(config, 'synthetic-run', doc, { windowId: window.id, facts }); cursor += page.length;
  }
  const report = await readingReport(config, 'synthetic-run', doc); const fullMs = performance.now() - fullStart;
  const result = {
    fixture: { cues: 1800, bytes: Buffer.byteLength(raw), repeatedCaptions: cues.filter(s => s.includes('caption repeats')).length, finalCorrection: 1799, knownEvidencePoints: keyText.size },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    extraction: { ms: extractionMs, blocks: doc.blocks.length, support: doc.source.support },
    previousPageLocalContract: { simulated: true, pages: baselinePages.length, tokensEstimated: baselinePages.reduce((n, p) => n + estimateTokens(p), 0), ms: baselineMs, finalCorrectionLinked: baselinePages.some(p => JSON.parse(p).corrections.some(c => c.correctedBlockId === doc.blocks[0].id && c.correctingBlockId === doc.blocks[1799].id)) },
    targeted: { matchingBlocks: hits.length, evidenceBlocks: blocks.length, tokensEstimated: estimateTokens(queryText), coldMs: queryMs, cachedMs: cachedQueryMs, initialAndFinalEvidencePresent: ids.has(doc.blocks[0].id) && ids.has(doc.blocks[1799].id), completeMeeting: false },
    fullWindowLedger: { windows, deliveredTokensEstimated: totalWindowTokens, ms: fullMs, coverage: report.coverage, evidencePointsRetained: report.facts.length, knownEvidencePointsOmitted: keyText.size - report.facts.length, initialFactSuperseded: report.facts.find(f => f.id === 'fact-0')?.status === 'superseded' },
    elapsedMs: performance.now() - started,
    limits: ['No model call: window facts are supplied from the synthetic oracle, not generated.', 'Tokens are UTF-8 bytes / 3.8 estimates, not provider usage or billed tokens.', 'Targeted retrieval is comparable only for the retention question; it does not replace full coverage.', 'Latency measures local extraction/index/ledger work, excluding model, CLI spawn and human review.', 'No assistant-alone comparison, semantic quality score or human time-saving claim.'],
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), json); else process.stdout.write(json);
} finally { await rm(scratch, { recursive: true, force: true }); }
