import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { complete } from '../src/ai/provider.js';
import { jsonSchemaOf } from '../src/engine/schema.js';
import { UNDERSTANDING_OPERATIONS } from '../src/engine/ops/understanding.js';
import { addObjective, collectCards, gradeCard, parseRating } from '../src/learn/learn.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { openDb, closeDbs } from '../src/state/db.js';
import { spentToday } from '../src/suggest/suggest.js';
import { understandingReading, keepReading, checkReadiness } from '../src/understanding/reading.js';
import { understandingLearning } from '../src/understanding/planning.js';
import { recordUnderstanding, understandingOverview } from '../src/understanding/state.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

vi.mock('../src/ai/provider.js', () => ({ complete: vi.fn() }));
const model = vi.mocked(complete);
const path = 'concepts/retry.md';
const credential = 'AKIA' + 'Q3J7Z2M5K8W1R4T6';
const body = '# Retry\n\n## En bref\n\nRepeat without a second effect.\n';
const raw = `---\ntype: Concept\ntitle: Retry\ndescription: Repeat without a second effect.\n---\n\n${body}`;
let sand: Sandbox;
beforeEach(async () => {
  sand = await makeSandbox({ profileId: 'understanding-gate' });
  await writeFixture(resolve(sand.vault, path), raw);
  model.mockReset();
  model.mockImplementation(async (request) => {
    const p = JSON.parse(request.prompt) as { note: { path: string; body: string } };
    return { provider: 'fake', tokens: { input: 100, output: 200 }, text: JSON.stringify({ explanation: 'Repeating the request avoids a second effect.', example: 'Repeat the request.', conditions: [], unclear: ['The mechanism is not specified.'], sources: [{ path: p.note.path, quote: 'Repeat without a second effect.' }], revisedMarkdown: p.note.body.replace('Repeat without a second effect.', 'Repeat without a second effect. Check the conditions.') }) };
  });
});
afterEach(async () => { closeDbs(); await sand.cleanup(); });

describe('F2.2: the real egress gate with a fictitious transport', () => {
  it('refuses a secret anywhere in the final note title before a model sees it', async () => {
    const c = await sand.config();
    await writeFile(resolve(sand.vault, path), raw.replace('title: Retry', `title: "token ${credential}"`));
    await expect(understandingReading(c, { path }, sand.env)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(model).not.toHaveBeenCalled();
  });

  it('refuses a secret in the person’s answer before a readiness call', async () => {
    const c = await sand.config();
    await expect(checkReadiness(c, { path, answer: `Use token ${credential}` }, sand.env)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(model).not.toHaveBeenCalled();
  });

  it('counts unusable answers, caches none, and spends zero for a cache hit', async () => {
    const c = await sand.config();
    model.mockResolvedValueOnce({ text: 'unreadable JSON', tokens: { input: 100, output: 200 }, provider: 'fake' });
    await expect(understandingReading(c, { path }, sand.env)).rejects.toMatchObject({ code: 'E_INVALID' });
    expect(await spentToday(c)).toBe(300);
    expect(openDb(c).get<{ n: number }>('SELECT COUNT(*) AS n FROM understanding_views')?.n).toBe(0);
    await understandingReading(c, { path }, sand.env);
    await understandingReading(c, { path }, sand.env);
    expect(await spentToday(c)).toBe(600); expect(model).toHaveBeenCalledTimes(2);
  });

  it('checks the bounded request against the existing daily budget', async () => {
    const c = await sand.config();
    const file = resolve(sand.home, 'config.yaml');
    await writeFile(file, 'budget:\n  daily: 1\n');
    await expect(understandingReading(c, { path }, sand.env)).rejects.toMatchObject({ key: 'budgetExceeded' });
    expect(model).not.toHaveBeenCalled();
  });

  it('refuses a source changed while the model was working and never saves a stale view', async () => {
    const c = await sand.config();
    const old = model.getMockImplementation()!;
    model.mockImplementationOnce(async (request, env) => { await writeFile(resolve(sand.vault, path), `${raw}\nNow changed.\n`); return old(request, env); });
    await expect(understandingReading(c, { path }, sand.env)).rejects.toMatchObject({ code: 'E_STALE' });
    expect(openDb(c).get<{ n: number }>('SELECT COUNT(*) AS n FROM understanding_views')?.n).toBe(0);
    expect(await spentToday(c)).toBe(300);
  });

  it('a note made protected after caching cannot be read or kept from cache', async () => {
    const c = await sand.config();
    const r = await understandingReading(c, { path }, sand.env);
    await writeFile(resolve(sand.vault, path), raw.replace('---\n\n', 'x_okb:\n  confidentiality: secret\n---\n\n'));
    await expect(understandingReading(c, { path }, sand.env)).rejects.toMatchObject({ code: 'E_SECRET' });
    await expect(keepReading(c, r.id)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe('F2.2: operation authority and chosen learning', () => {
  it('has supported input schemas and refuses person-only acts even when directly invoked by an agent', async () => {
    const config = await sand.config();
    for (const op of UNDERSTANDING_OPERATIONS) expect(jsonSchemaOf(op.input).type).toBe('object');
    for (const op of UNDERSTANDING_OPERATIONS.filter((o) => o.agents === false)) {
      await expect(op.run({ config, env: sand.env, actor: 'agent' }, {} as never)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    }
    expect(model).not.toHaveBeenCalled();
  });

  it('records all five levels explicitly and provides a source graph, never implying a higher act', async () => {
    const c = await sand.config();
    for (const kind of ['encountered', 'consulted', 'practiced', 'explained', 'reused'] as const) {
      await recordUnderstanding(c, { path, kind, eventId: kind, point: kind === 'practiced' || kind === 'explained' || kind === 'reused' ? `Declared work: ${kind}` : undefined });
      const overview = await understandingOverview(c);
      expect(overview.subjects.find((s) => s.path === path)?.level).toBe(kind);
      expect(overview.graph.nodes.find((n) => n.id === path)?.level).toBe(kind);
    }
  });

  it('turns a chosen objective into steps and uses actual FSRS review history for progress', async () => {
    const c = await sand.config();
    const o = await addObjective(c, { text: 'Understand retry effects', subject: 'concepts' }, new Date('2026-10-10T10:00:00Z'));
    const first = await understandingLearning(c, { subject: 'concepts' });
    expect(first.pathways.find((p) => p.id === o.id)?.steps.find((s) => s.path === path && s.kind === 'review')?.done).toBe(false);
    const card = collectCards(c, await loadBundleFor(c)).find((x) => x.path === path)!;
    await gradeCard(c, card.id, parseRating('good')!, new Date('2026-10-11T10:00:00Z'));
    const next = await understandingLearning(c, { subject: 'concepts' });
    expect(next.pathways.find((p) => p.id === o.id)?.steps.find((s) => s.path === path && s.kind === 'review')?.done).toBe(true);
    expect((await understandingOverview(c)).subjects.find((s) => s.path === path)?.level).not.toBe('practiced');
  });
});
