import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendToAi } from '../src/ai/gate.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { gradeCard, parseRating, reviewLog } from '../src/learn/learn.js';
import { addAction } from '../src/projects/actions.js';
import { createProject } from '../src/projects/projects.js';
import { closeDbs } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { understandingReading, keepReading, checkReadiness } from '../src/understanding/reading.js';
import { recordUnderstanding, understandingOverview, setUnderstandingProgress } from '../src/understanding/state.js';
import { prepareMeeting, understandingLearning } from '../src/understanding/planning.js';
import { asBundlePath } from '../src/util/paths.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

vi.mock('../src/ai/gate.js', () => ({ sendToAi: vi.fn() }));
const ai = vi.mocked(sendToAi);
const note = asBundlePath('concepts/retry.md');
const other = asBundlePath('concepts/checklist.md');
const BODY = '# Retry\n\n## En bref\n\nUne opération répétée ne produit pas un second effet.\n\n## Exemple\n\nUtiliser `requestId` pour identifier une requête.\n\n> Une requête garde son identifiant.\n';
const raw = (body = BODY, secret = false) => `---\ntype: Concept\ntitle: Retry\ndescription: Répéter sans doubler les effets.\nstatus: stable\ncustom_field: keep-me\nx_okb:\n  brain:\n    type: concept\n${secret ? '  confidentiality: secret\n' : ''}---\n\n${body}`;
let sand: Sandbox;
beforeEach(async () => {
  sand = await makeSandbox({ profileId: 'understanding' });
  await writeFixture(resolve(sand.vault, note), raw());
  ai.mockReset();
  ai.mockImplementation(async (_config, out) => {
    const p = JSON.parse(out.prompt) as { kind: string; note: { path: string; hash: string; body: string }; mode: string };
    const sources = [{ path: p.note.path, quote: 'Une opération répétée ne produit pas un second effet.' }];
    const value = p.kind === 'readiness'
      ? { grade: 'partial', feedback: 'Le second effet est évité ; préciser comment.', missing: ['Identifiant stable'], sources }
      : { explanation: `Lecture ${p.mode} : éviter un second effet.`, example: 'La même demande garde son identifiant.', conditions: ['Garder un identifiant stable.'], unclear: ['Durée de conservation non précisée.'], sources, revisedMarkdown: p.note.body.replace('Une opération répétée ne produit pas un second effet.', `Une opération répétée ne produit pas un second effet. Explication ${p.mode}.`) };
    return { text: JSON.stringify(value), tokens: { input: 80, output: 120 }, provider: 'fake' };
  });
});
afterEach(async () => { closeDbs(); await sand.cleanup(); });

describe('F2.2-01..03: sourced, cached readings, not knowledge writes', () => {
  it('reuses an identical request, across concurrent callers, and invalidates changed source', async () => {
    const c = await sand.config();
    const [a, b] = await Promise.all([understandingReading(c, { path: note, mode: 'simple' }, sand.env), understandingReading(c, { path: note, mode: 'simple' }, sand.env)]);
    expect(a.id).toBe(b.id); expect(ai).toHaveBeenCalledTimes(1);
    expect((await understandingReading(c, { path: note, mode: 'simple' }, sand.env)).cached).toBe(true);
    await writeFile(resolve(sand.vault, note), raw(`${BODY}\nUn délai de reprise est requis.\n`));
    const changed = await understandingReading(c, { path: note, mode: 'simple' }, sand.env);
    expect(changed.id).not.toBe(a.id); expect(ai).toHaveBeenCalledTimes(2);
    expect(changed.sources[0]?.hash).toBe(changed.sourceHash);
  });

  it.each(['simple', 'technical', 'short', 'detailed', 'project-example', 'analogy'] as const)('keeps %s as a distinct useful reading', async (mode) => {
    const c = await sand.config();
    const r = await understandingReading(c, { path: note, mode }, sand.env);
    expect(r.mode).toBe(mode); expect(r.explanation).toContain(mode);
    expect(r.sources[0]?.quote).toBe('Une opération répétée ne produit pas un second effet.');
    expect(r.limitations.length).toBeGreaterThan(0);
  });

  it('refuses nonexistent evidence and does not cache the unusable AI result', async () => {
    const c = await sand.config();
    ai.mockResolvedValueOnce({ text: JSON.stringify({ explanation: 'x', example: 'x', conditions: [], unclear: [], sources: [{ path: note, quote: 'A fabricated quote.' }], revisedMarkdown: BODY }), tokens: { input: 1, output: 2 }, provider: 'fake' });
    await expect(understandingReading(c, { path: note }, sand.env)).rejects.toMatchObject({ code: 'E_INVALID' });
    await understandingReading(c, { path: note }, sand.env);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('refuses a secret note before cache or model, and filters secret project context', async () => {
    const c = await sand.config();
    await writeFixture(resolve(sand.vault, other), raw('# Confidential project context', true));
    const p = createProject(c, { title: 'Project Alpha', folder: 'concepts' });
    await understandingReading(c, { path: note, mode: 'project-example', projectId: p.id }, sand.env);
    expect(ai.mock.calls[0]?.[1].prompt).not.toContain('Confidential project context');
    await writeFile(resolve(sand.vault, note), raw(BODY, true));
    await expect(understandingReading(c, { path: note }, sand.env)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('invalidates a project reading when a contextual note changes', async () => {
    const c = await sand.config();
    await writeFixture(resolve(sand.vault, other), raw('# Project example\n\nUse the same request ID.'));
    const p = createProject(c, { title: 'Project Alpha', folder: 'concepts' });
    const a = await understandingReading(c, { path: note, mode: 'project-example', projectId: p.id }, sand.env);
    await writeFile(resolve(sand.vault, other), raw('# Project example\n\nSave the request ID for two days.'));
    const b = await understandingReading(c, { path: note, mode: 'project-example', projectId: p.id }, sand.env);
    expect(b.id).not.toBe(a.id); expect(ai).toHaveBeenCalledTimes(2);
  });

  it('prepares a normal revision, preserving protected elements and unknown metadata', async () => {
    const c = await sand.config();
    const r = await understandingReading(c, { path: note, mode: 'simple' }, sand.env);
    const before = await readFile(resolve(sand.vault, note), 'utf8');
    const p = await keepReading(c, r.id);
    expect(p.status).toBe('prepared'); expect(p.changes.some((x) => x.kind === 'replace-document')).toBe(true);
    expect(p.changes[0]?.replaceDocument?.content).toContain('custom_field: keep-me');
    expect(p.changes[0]?.replaceDocument?.content).toContain('`requestId`');
    expect(await readFile(resolve(sand.vault, note), 'utf8')).toBe(before);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('rejects keeping a stale reading or a revision that drops a protected quotation', async () => {
    const c = await sand.config();
    const a = await understandingReading(c, { path: note }, sand.env);
    await writeFile(resolve(sand.vault, note), raw(`${BODY}\nChanged.\n`));
    await expect(keepReading(c, a.id)).rejects.toMatchObject({ code: 'E_STALE' });
    ai.mockImplementationOnce(async () => ({ text: JSON.stringify({ explanation: 'x', example: 'x', conditions: [], unclear: [], sources: [{ path: note, quote: 'Une opération répétée ne produit pas un second effet.' }], revisedMarkdown: BODY.replace('> Une requête garde son identifiant.', '') }), tokens: { input: 1, output: 2 }, provider: 'fake' }));
    const b = await understandingReading(c, { path: note, mode: 'short' }, sand.env);
    await expect(keepReading(c, b.id)).rejects.toMatchObject({ code: 'E_INVALID' });
  });
});

describe('F2.2-02,04..06,10: observable understanding, private optional progress', () => {
  it('never infers practiced or explained from consultation; auto style follows recorded work', async () => {
    const c = await sand.config();
    await recordUnderstanding(c, { path: note, kind: 'consulted', eventId: 'consult-1' });
    expect((await understandingReading(c, { path: note }, sand.env)).mode).toBe('simple');
    expect((await understandingOverview(c)).subjects.find((s) => s.path === note)?.level).toBe('consulted');
    await recordUnderstanding(c, { path: note, kind: 'practiced', point: 'Implemented stable request IDs in the sandbox.', eventId: 'practice-1' });
    await recordUnderstanding(c, { path: note, kind: 'explained', point: 'Explained duplicate effects and stable identifiers to a colleague.', eventId: 'explain-1' });
    expect((await understandingReading(c, { path: note }, sand.env)).mode).toBe('technical');
    expect((await understandingOverview(c)).subjects.find((s) => s.path === note)?.level).toBe('explained');
  });

  it('requires a description for higher levels, preserves idempotency and rejects replay with changed input', async () => {
    const c = await sand.config();
    await expect(recordUnderstanding(c, { path: note, kind: 'explained', eventId: 'x' })).rejects.toMatchObject({ code: 'E_INVALID' });
    const input = { path: note, kind: 'reused' as const, point: 'Applied to a second import job.', eventId: 'reuse-1' };
    await Promise.all([recordUnderstanding(c, input), recordUnderstanding(c, input)]);
    expect((await understandingOverview(c)).subjects.find((s) => s.path === note)?.events).toBe(1);
    await expect(recordUnderstanding(c, { ...input, point: 'Different outcome.' })).rejects.toMatchObject({ code: 'E_CONFLICT' });
  });

  it('offers one five-minute debt after repeated encounters, and clears explicitly resolved points', async () => {
    const c = await sand.config();
    for (let n = 0; n < 3; n++) await recordUnderstanding(c, { path: note, kind: 'encountered', eventId: `seen-${n}` });
    const a = await understandingOverview(c);
    expect(a.debts.find((d) => d.path === note)?.reason).toBe('repeated');
    expect(a.today?.minutes).toBe(5);
    await recordUnderstanding(c, { path: note, kind: 'unclear', point: 'How long to retain an identifier?', eventId: 'unclear-1' });
    await recordUnderstanding(c, { path: note, kind: 'resolved', point: 'How long to retain an identifier?', eventId: 'resolve-1' });
    const b = await understandingOverview(c);
    expect(b.debts.some((d) => d.point === 'How long to retain an identifier?')).toBe(false);
    await expect(recordUnderstanding(c, { path: note, kind: 'resolved', point: 'Never opened', eventId: 'invalid-resolution' })).rejects.toMatchObject({ code: 'E_INVALID' });
  });

  it('resolves a repeated-exposure debt inherited only from actual note usage', async () => {
    const c = await sand.config(); const folder = resolve(statePaths(c).root, 'usage');
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, 'notes.jsonl'), [1, 2, 3].map((day) => JSON.stringify({ path: note, at: `2026-10-0${day}T09:00:00.000Z`, kind: 'open' })).join('\n') + '\n');
    expect((await understandingOverview(c)).debts.find((d) => d.path === note)?.reason).toBe('repeated');
    await recordUnderstanding(c, { path: note, kind: 'resolved', point: '', eventId: 'resolved-inherited' });
    const overview = await understandingOverview(c);
    expect(overview.debts.some((d) => d.path === note)).toBe(false);
    expect(overview.subjects.find((s) => s.path === note)?.level).toBe('consulted');
  });

  it('keeps XP disabled until chosen, then rewards explanations, resolved debt and reuse only', async () => {
    const c = await sand.config();
    await recordUnderstanding(c, { path: note, kind: 'consulted', eventId: 'read' });
    expect((await understandingOverview(c)).progress).toMatchObject({ enabled: false, private: true, xp: 0 });
    setUnderstandingProgress(c, true);
    await recordUnderstanding(c, { path: note, kind: 'explained', point: 'Explained request IDs with an example.', eventId: 'explain' });
    await recordUnderstanding(c, { path: note, kind: 'reused', point: 'Reused the method in a second task.', eventId: 'reuse' });
    const p = (await understandingOverview(c)).progress;
    expect(p.enabled).toBe(true); expect(p.xp).toBeGreaterThan(0);
    expect(p.counts).toEqual({ resolved: 0, explained: 1, reused: 1 });
    expect(p).not.toHaveProperty('rank');
    await writeFile(resolve(sand.vault, note), raw(BODY, true));
    expect((await understandingOverview(c)).subjects.some((s) => s.path === note)).toBe(false);
  });
});

describe('F2.2-07..09: prepare, explain with own words and keep FSRS', () => {
  it('prepares a meeting without a model: sourced knowledge, open questions and limits', async () => {
    const c = await sand.config();
    const p = createProject(c, { title: 'Imports', folder: 'concepts', next: 'Agree on the retention period.' });
    addAction(c, { text: 'How long is an identifier retained?', kind: 'question', project: p.id });
    const m = await prepareMeeting(c, { projectId: p.id }, sand.env);
    expect(m.known.some((x) => x.path === note)).toBe(true);
    expect(m.questions.some((x) => x.text.includes('retained'))).toBe(true);
    expect(m.limitations.length).toBeGreaterThan(0); expect(ai).not.toHaveBeenCalled();
  });

  it('compares the person’s words to exact note evidence and never claims real-world readiness', async () => {
    const c = await sand.config();
    const r = await checkReadiness(c, { path: note, answer: 'The second request should not create a second effect.' }, sand.env);
    expect(r.grade).toBe('partial'); expect(r.sources[0]?.path).toBe(note);
    expect(r.limitations.length).toBeGreaterThan(0);
    expect((await understandingOverview(c)).subjects.find((s) => s.path === note)?.level).not.toBe('explained');
  });

  it('uses existing FSRS cards and grades without resetting the review schedule', async () => {
    const c = await sand.config();
    const first = await understandingLearning(c, {});
    const card = [...first.review.due, ...first.review.fresh].find((x) => x.path === note)!;
    expect(card).toBeDefined();
    await gradeCard(c, card.id, parseRating('good')!, new Date('2026-10-11T09:00:00Z'));
    const history = await reviewLog(c);
    await understandingLearning(c, {});
    expect(await reviewLog(c)).toEqual(history);
    expect((await loadBundleFor(c)).byPath.has(note)).toBe(true);
  });
});
