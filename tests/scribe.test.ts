import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiResult } from '../src/ai/provider.js';
import type { Outgoing } from '../src/ai/gate.js';
import { loadConfig } from '../src/config/load.js';
import { renderDigest, triage } from '../src/scribe/digest.js';
import { readLedger } from '../src/scribe/ledger.js';
import { checkPlan, scribeSession, skipSession, sweep } from '../src/work/scribe.js';
import { parseLines, readTranscript } from '../src/scribe/transcript.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { registered, useRepoSandboxes } from './helpers/repo.js';

useRepoSandboxes();
const made: string[] = [];
afterEach(async () => { closeDbs(); for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

const row = (o: Record<string, unknown>) => `${JSON.stringify({ sessionId: 's-1', timestamp: '2026-11-04T10:00:00Z', ...o })}\n`;
const person = (text: string, extra: Record<string, unknown> = {}) => row({ type: 'user', message: { role: 'user', content: text }, ...extra });
const claude = (content: unknown[]) => row({ type: 'assistant', message: { role: 'assistant', content } });
const say = (text: string) => claude([{ type: 'text', text }]);

describe('reading a Claude Code transcript (D77)', () => {
  it('keeps what the person and the assistant said and did, and skips the rest', () => {
    const text = [
      person('Le panier perd les remises sur ORD-42', { cwd: '/code/orders', gitBranch: 'feature/ORD-42-remises' }),
      row({ type: 'user', isMeta: true, message: { content: 'caveat' } }),
      person('<command-name>/clear</command-name>'),
      claude([{ type: 'text', text: 'Je regarde.' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/code/orders/srv/pricing.js' } }]),
      claude([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' } }]),
      row({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'exit 1' }] } }),
      row({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent' }] } }),
      'not json\n',
      person('Toujours rouge'),
    ].join('');
    const out = parseLines(text);
    expect(out.cwd).toBe('/code/orders');
    expect(out.branch).toBe('feature/ORD-42-remises');
    expect(out.skipped).toBe(1);
    expect(out.turns.map((t) => [t.who, t.text])).toEqual([['person', 'Le panier perd les remises sur ORD-42'], ['assistant', 'Je regarde.'], ['person', 'Toujours rouge']]);
    expect(out.turns[1]).toMatchObject({ edited: ['/code/orders/srv/pricing.js'], commands: ['npm test'] });
    expect(out.turns[2]!.errors).toBe(1);
  });

  it('reads complete lines only, from where it stopped', async () => {
    const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-transcript-')));
    made.push(dir);
    const file = resolve(dir, 's-1.jsonl');
    await writeFile(file, `${person('un')}${say('deux')}{"type":"user","mess`);
    const first = await readTranscript(file);
    expect(first.turns).toHaveLength(2);
    expect(first.to).toBeLessThan(first.size);
    await appendFile(file, `age":{"content":"trois"}}\n`);
    const next = await readTranscript(file, first.to);
    expect(next.turns.map((t) => t.text)).toEqual(['trois']);
  });
});

describe('deciding without a model whether a conversation is worth it (D77)', () => {
  const turns = (texts: [string, string][]) => texts.map(([who, text]) => ({ at: null, who: who as 'person' | 'assistant', text, edited: [], commands: [], errors: 0 }));
  it('a short or idle exchange costs nothing', () => {
    expect(triage({ branch: null, turns: turns([['person', 'merci'], ['assistant', 'Avec plaisir.']]) })).toMatchObject({ worth: false, reason: 'short' });
    expect(triage({ branch: null, turns: turns([['person', 'salut'], ['assistant', 'Bonjour.'], ['person', 'ça va ?'], ['assistant', 'Oui.']]) })).toMatchObject({ worth: false, reason: 'small-talk' });
  });
  it('work, a decision or a solved bug is worth it, and the ticket comes from the branch and the words', () => {
    const work = triage({ branch: 'feature/ORD-42-remises', turns: [...turns([['person', 'on part sur un cache local pour ORD-42']]), { at: null, who: 'assistant', text: 'Fait.', edited: ['a.js'], commands: [], errors: 0 }] });
    expect(work).toMatchObject({ worth: true, reason: 'work', refs: ['ORD-42'] });
    expect(work.moments).toContain('decision');
  });
  it('a paragraph holding a secret never reaches the digest', () => {
    const digest = renderDigest({ session: 's-1', cwd: '/code', branch: null, turns: turns([['person', 'voici la clé\n\ntoken ' + 'ghp_' + 'R7kq2Lm9Xw4Tz8Vb3Nc6Hd1Jf5Gs0Yp2Qe'], ['assistant', 'Ne la partage pas.']]) }, 'fr');
    expect(digest).toContain('voici la clé');
    expect(digest).not.toContain('ghp_');
  });
});

describe('the model’s answer is checked against the conversation (D77)', () => {
  it('drops every line whose quote was not said', () => {
    const digest = '## Personne\n\nOn garde le cache local parce que le WMS est lent.\n';
    const plan = checkPlan(JSON.stringify({
      ticket: { ref: 'ORD-42', goal: 'garder les remises' },
      journal: [{ kind: 'decision', text: 'Cache local, le WMS est lent', quote: 'On garde le cache local parce que le WMS est lent' }, { kind: 'decision', text: 'Inventé', quote: 'on passe à Kafka' }],
      notes: [{ type: 'decision', title: 'Cache local', why: 'x', quotes: ['le WMS est lent'] }, { type: 'concept', title: 'Kafka', why: 'x', quotes: ['Kafka est un bus'] }],
    }), digest);
    expect(plan.journal.map((j) => j.text)).toEqual(['Cache local, le WMS est lent']);
    expect(plan.notes.map((n) => n.title)).toEqual(['Cache local']);
    expect(() => checkPlan('pas de json', digest)).toThrow();
  });
});

describe('the scribe files a finished conversation (D77)', () => {
  async function setup() {
    const r = await registered();
    const claudeDir = resolve(r.s.dir, 'claude');
    const env = { ...process.env, OKB_HOME: r.s.home, CLAUDE_CONFIG_DIR: claudeDir };
    await mkdir(resolve(claudeDir, 'projects', 'orders'), { recursive: true });
    const file = resolve(claudeDir, 'projects', 'orders', 's-1.jsonl');
    await writeFile(file, [
      person('Le panier perd les remises sur ORD-42 quand on change de devise', { cwd: r.root, gitBranch: 'feature/ORD-42-remises' }),
      claude([{ type: 'text', text: 'La remise est calculée avant la conversion de devise dans srv/pricing.js.' }, { type: 'tool_use', name: 'Edit', input: { file_path: resolve(r.root, 'srv', 'pricing.js') } }]),
      person('On garde la conversion en premier parce que les remises sont en euros.'),
      say('Corrigé : la conversion passe avant la remise, et le test est vert.'),
    ].join(''));
    return { ...r, env, file };
  }
  const plan = JSON.stringify({
    ticket: { ref: 'ORD-42', goal: 'Garder les remises quand on change de devise', lastAction: 'Conversion déplacée avant la remise', next: 'Faire relire la PR' },
    journal: [{ kind: 'decision', text: 'La conversion passe avant la remise, car les remises sont en euros.', quote: 'On garde la conversion en premier parce que les remises sont en euros.' }],
    attempts: [],
    notes: [{ type: 'decision', title: 'Conversion de devise avant la remise', why: 'une règle qui reviendra', quotes: ['les remises sont en euros'] }],
  });
  /** A model that answers the plan, then a note citing the block that holds its words. */
  const fakeAsk = (calls: Outgoing[]) => async (out: Outgoing): Promise<AiResult> => {
    calls.push(out);
    if (out.system.includes('list only what is worth remembering')) return { text: plan, tokens: { input: 1000, output: 200 }, provider: 'fake' };
    const block = /\[([^\]]+)\][^\n]*les remises sont en euros/.exec(out.prompt)![1]!;
    const roles = [...out.prompt.matchAll(/^([a-z-]+) \(required\):/gm)].map((m) => m[1]!);
    const sections = roles.map((role, i) => ({ role, claims: [{ id: `c${i}`, text: 'La conversion de devise passe avant la remise, car les remises sont en euros.', kind: 'reported', evidence: [{ blockId: block, quote: 'les remises sont en euros' }] }], aids: [] }));
    return { text: JSON.stringify({ sections, openQuestions: [] }), tokens: { input: 1500, output: 400 }, provider: 'fake' };
  };

  it('does nothing while the person has not turned it on', async () => {
    const { env, file } = await setup();
    const calls: Outgoing[] = [];
    expect(await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) })).toMatchObject({ status: 'waiting', reason: 'off' });
    expect(calls).toHaveLength(0);
  });

  it('fills the ticket’s journal and sheet, and files the note to review, with its quote checked', async () => {
    const { env, file, config } = await setup();
    await writeSetting('', 'scribe.mode', 'after', env);
    await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', env);
    const calls: Outgoing[] = [];
    const out = await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) });
    expect(out).toMatchObject({ status: 'done', ticket: 'ORD-42', journal: 1, kb: 'travail' });
    expect(out.notes).toEqual([expect.objectContaining({ title: 'Conversion de devise avant la remise', result: 'kept' })]);
    expect(calls.every((c) => c.purpose === 'scribe')).toBe(true);
    const c = (await loadConfig({ env, profileId: 'travail' })).config;
    const { loadTicket } = await import('../src/work/tickets.js');
    expect((await loadTicket(c, 'ORD-42'))!.journal.map((j) => j.text)).toContain('La conversion passe avant la remise, car les remises sont en euros.');
    const written = await readFile(resolve(c.kb.root, out.notes[0]!.path!), 'utf8');
    expect(written).toContain('les remises sont en euros');
    // Read once: a second pass finds nothing new and costs nothing.
    const again = await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) });
    expect(again.reason).toBe('nothing-new');
    expect(calls).toHaveLength(2);
    expect((await readLedger(env)).spent[new Date().toISOString().slice(0, 10)]).toBe(3100);
  });

  it('in a KB that asks for the person’s yes, the note waits as a proposal', async () => {
    const { env, file } = await setup();
    await writeSetting('', 'scribe.mode', 'after', env);
    const out = await scribeSession(file, { pass: 'after', env, ask: fakeAsk([]) });
    expect(out.notes[0]).toMatchObject({ result: 'proposed' });
  });

  it('a live pass waits for a batch and writes no note', async () => {
    const { env, file } = await setup();
    await writeSetting('', 'scribe.mode', 'live', env);
    const calls: Outgoing[] = [];
    expect(await scribeSession(file, { pass: 'live', env, ask: fakeAsk(calls) })).toMatchObject({ reason: 'batch-not-full' });
    const forced = await scribeSession(file, { pass: 'live', env, ask: fakeAsk(calls), force: true });
    expect(forced).toMatchObject({ status: 'waiting', journal: 1, notes: [] });
    // The full pass at the end writes the note, and does not file the same journal twice.
    const end = await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) });
    expect(end).toMatchObject({ status: 'done', journal: 0 });
  });

  it('never reads a conversation the person skipped, nor an excluded folder, and stops at its budget', async () => {
    const { env, file, root } = await setup();
    await writeSetting('', 'scribe.mode', 'after', env);
    await skipSession('s-1', env);
    const calls: Outgoing[] = [];
    expect(await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) })).toMatchObject({ status: 'skipped' });
    const { resumeSession } = await import('../src/work/scribe.js');
    await resumeSession('s-1', env);
    await writeSetting('', 'scribe.skip', [root], env);
    expect(await scribeSession(file, { pass: 'after', env, ask: fakeAsk(calls) })).toMatchObject({ status: 'skipped', reason: 'folder-excluded' });
    expect(calls).toHaveLength(0);
  });

  it('the evening run leaves a conversation still going on, and respects the share of the budget', async () => {
    const { env } = await setup();
    await writeSetting('', 'scribe.mode', 'after', env);
    const calls: Outgoing[] = [];
    expect(await sweep({ env, ask: fakeAsk(calls) })).toEqual([]);
    const later = new Date(Date.now() + 30 * 60_000);
    expect(await sweep({ env, ask: fakeAsk(calls), now: later, share: 0 })).toEqual([]);
    expect((await sweep({ env, ask: fakeAsk(calls), now: later })).map((o) => o.status)).toEqual(['done']);
  });
});
