import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendToAi } from '../src/ai/gate.js';
import type { AiResult } from '../src/ai/provider.js';
import { parseClaudeJson } from '../src/ai/provider.js';
import { composeAnswer } from '../src/find/answer.js';
import { addExamQuestion, lastExam, runExam } from '../src/knowledge/exam.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { translateNote } from '../src/translate/translate.js';
import { understandingReading, checkReadiness } from '../src/understanding/reading.js';
import { asBundlePath } from '../src/util/paths.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

vi.mock('../src/ai/gate.js', () => ({ sendToAi: vi.fn() }));
const ai = vi.mocked(sendToAi);
let box: Sandbox;
const path = asBundlePath('concepts/solar-cache.md');
const body = '# Solar cache\n\n## En bref\n\nA solar cache lasts ten minutes.\n';
const unknown = (text: string): AiResult => ({ text, tokens: { input: 120, output: 30 }, provider: 'claude-code', usage: { input: null, output: null }, estimated: true });
beforeEach(async () => {
  box = await makeSandbox({ profileId: 'estimated-tokens' });
  await writeFixture(resolve(box.vault, path), `---\ntype: Concept\ntitle: Solar cache\ndescription: A solar cache lasts ten minutes.\n---\n\n${body}`);
  ai.mockReset();
});
afterEach(async () => { closeDbs(); await box.cleanup(); });

describe('Reported token uncertainty survives feature and cache boundaries', () => {
  it('never invents measured zero when the legacy CLI omits usage', () => {
    const result = parseClaudeJson(JSON.stringify({ result: 'The cache lasts ten minutes.' }));
    expect(result.estimated).toBe(true); expect(result.usage).toEqual({ input: null, output: null });
    expect(result.tokens.input).toBeGreaterThan(0); expect(result.tokens.output).toBeGreaterThan(0);
  });
  it('retains translation uncertainty across a cache hit without another model call', async () => {
    const config = await box.config(); ai.mockImplementation(async (_config, out) => unknown(out.prompt));
    const first = await translateNote(config, path, 'fr', 'brief', box.env);
    expect(first.estimated).toBe(true); expect(first.tokens).toBe(150);
    const cached = await translateNote(config, path, 'fr', 'brief', box.env);
    expect(cached.estimated).toBe(true); expect(cached.tokens).toBe(0); expect(cached.cached).toBeGreaterThan(0);
    expect(ai).toHaveBeenCalledTimes(1);
  });
  it('marks a composed answer as estimated while preserving the measured representation', async () => {
    const config = await box.config(); ai.mockResolvedValue(unknown('Ten minutes [1].'));
    expect(await composeAnswer(config, 'How long?', [{ n: 1, path, title: 'Solar cache', text: 'A solar cache lasts ten minutes.', line: 5 }], box.env)).toMatchObject({ tokens: 150, estimated: true, used: [1] });
  });
  it('keeps estimated reading provenance in SQLite and returns true for cached views and readiness', async () => {
    const config = await box.config(); ai.mockImplementation(async (_config, out) => {
      const request = JSON.parse(out.prompt) as { kind: string };
      return unknown(JSON.stringify(request.kind === 'readiness' ? { grade: 'partial', feedback: 'Give the duration.', missing: [], sources: [{ path, quote: 'A solar cache lasts ten minutes.' }] } : { explanation: 'Ten minutes.', example: 'Read before expiry.', conditions: [], unclear: [], sources: [{ path, quote: 'A solar cache lasts ten minutes.' }], revisedMarkdown: body }));
    });
    const reading = await understandingReading(config, { path }, box.env);
    expect(reading.estimated).toBe(true);
    expect(JSON.parse(openDb(config).get<{ payload: string }>('SELECT payload FROM understanding_views WHERE id=?', reading.id)!.payload).estimated).toBe(true);
    expect(await understandingReading(config, { path }, box.env)).toMatchObject({ tokens: 0, cached: true, estimated: true });
    expect(await checkReadiness(config, { path, answer: 'A limited duration.' }, box.env)).toMatchObject({ estimated: true, tokens: 150 });
    expect(ai).toHaveBeenCalledTimes(2);
  });
  it('marks the whole exam estimated when only one of its two calls has unknown usage, including persisted history', async () => {
    const config = await box.config(); const repo = { id: 'solar-fixture', name: 'Solar', folder: 'concepts' };
    const question = await addExamQuestion(config, repo, 'How long does the solar cache last?', 'Ten minutes.');
    const result = await runExam(config, repo, { env: box.env, only: [question.id], ask: async (request) => request.system.includes('grade')
      ? { text: JSON.stringify({ grades: [{ id: question.id, grade: 'right', why: 'The note gives ten minutes.' }] }), tokens: { input: 3, output: 2 }, provider: 'claude-code', estimated: false }
      : unknown(JSON.stringify({ answers: [{ id: question.id, answer: 'Ten minutes.' }] })) });
    expect(result).toMatchObject({ estimated: true, tokens: 155 });
    expect(await lastExam(config, repo)).toMatchObject({ estimated: true, tokens: 155 });
  });
});
