import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { runSetup } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { MAX_OFFERS, notNow, spot } from '../src/suggest/session.js';
import { loadQueue } from '../src/suggest/suggest.js';
import { TEST_ROOT } from './helpers/sandbox.js';
import { json } from './helpers/team.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function brain() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-moments-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await mkdir(kb, { recursive: true });
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  await ensureState(statePaths(config));
  last = { dir, env };
  return config;
}
let last: { dir: string; env: NodeJS.ProcessEnv };

const LONG = 'Une explication. '.repeat(60);
const T0 = Date.parse('2027-03-01T09:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const ask = (term: string) => ({ prompt: `c'est quoi ${term} ?`, answer: LONG });
const BYE = { prompt: 'merci, à demain', answer: 'Bonne soirée.' };

describe('what is spotted waits for the end of the session (F2.0-09)', () => {
  it('nothing is offered along the way; the closing gathers three things at most, the cards first', async () => {
    const config = await brain();
    const say = (input: { prompt: string; answer: string }, earlier: string[], minute: number) => spot(config, { session: 's1', ...input, earlier, toolErrors: 0 }, { mode: 'session', now: at(minute) });
    for (const [i, term] of ['OData', 'un WBS', 'le CDS'].entries()) {
      const out = await say(ask(term), [], i);
      expect(out.moments.map((m) => m.kind)).toEqual(['explained']);
      expect(out.context).toBeUndefined();
    }
    await say({ prompt: 'ok on part sur SQLite plutôt que des fichiers JSON', answer: 'Entendu.' }, [], 4);
    await say({ prompt: 'ça marche enfin', answer: 'Parfait.' }, ['le build plante', 'toujours pas'], 5);
    expect((await loadQueue(config)).map((s) => s.title).sort()).toEqual(['CDS', 'OData', 'WBS']);

    const end = await say(BYE, [], 6);
    expect(MAX_OFFERS).toBe(3);
    expect(end.offer!.cards.map((c) => c.title).sort()).toEqual(['CDS', 'OData', 'WBS']);
    expect(end.offer!.toName).toEqual([]);
    for (const card of end.offer!.cards) expect(end.context).toContain(card.id);
    expect(end.context).toContain('Pas maintenant');
    expect(end.context).toContain('okb suggest later --session s1');
    // Three were offered: the session offers nothing more, whatever else was spotted.
    expect((await say(BYE, [], 7)).context).toBeUndefined();
  });

  it('a moment the words do not name is handed to the assistant, with the command that makes its card', async () => {
    const config = await brain();
    await spot(config, { session: 's1', prompt: 'ça marche enfin, merci', answer: 'Parfait.', earlier: ['le build plante avec ENOENT', 'toujours pas'], toolErrors: 0 }, { mode: 'session', now: at(0) });
    const end = await spot(config, { session: 's1', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(1) });
    expect(end.offer!.toName.map((m) => [m.kind, m.hint])).toEqual([['solved', 'le build plante avec ENOENT']]);
    expect(end.context).toContain('okb suggest add --type known-error');
    expect(end.context).toContain('le build plante avec ENOENT');
    // Nothing was written, and no card was made in the person's name.
    expect(await loadQueue(config)).toEqual([]);
  });

  it('« pas maintenant » is remembered: the cards wait in the app, and are not offered again for a week', async () => {
    const config = await brain();
    await spot(config, { session: 's1', ...ask('OData'), earlier: [], toolErrors: 0 }, { mode: 'session', now: at(0) });
    const end = await spot(config, { session: 's1', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(1) });
    const id = end.offer!.cards[0]!.id;
    expect((await notNow(config, 's1', at(2))).later).toEqual([id]);
    const card = (await loadQueue(config, at(3))).find((s) => s.id === id)!;
    expect([card.status, card.laterUntil]).toEqual(['later', new Date(at(2).getTime() + 7 * 86_400_000).toISOString()]);

    // The next day, the same question: the card exists, it is not pushed again.
    const day = 24 * 60;
    await spot(config, { session: 's2', ...ask('OData'), earlier: [], toolErrors: 0 }, { mode: 'session', now: at(day) });
    expect((await spot(config, { session: 's2', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(day + 1) })).context).toBeUndefined();
    // Eight days later it comes back with the question.
    await spot(config, { session: 's3', ...ask('OData'), earlier: [], toolErrors: 0 }, { mode: 'session', now: at(8 * day) });
    const later = await spot(config, { session: 's3', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(8 * day + 1) });
    expect(later.offer!.cards.map((c) => c.id)).toEqual([id]);
  });

  it('after « pas maintenant », the session stays quiet', async () => {
    const config = await brain();
    await spot(config, { session: 's1', ...ask('OData'), earlier: [], toolErrors: 0 }, { mode: 'session', now: at(0) });
    await spot(config, { session: 's1', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(1) });
    await notNow(config, 's1', at(2));
    await spot(config, { session: 's1', ...ask('un WBS'), earlier: [], toolErrors: 0 }, { mode: 'session', now: at(3) });
    expect((await spot(config, { session: 's1', ...BYE, earlier: [], toolErrors: 0 }, { mode: 'session', now: at(4) })).context).toBeUndefined();
  });

  it('in live mode a strong card is offered at once, and the session still stops at three', async () => {
    const config = await brain();
    const offered: boolean[] = [];
    for (const [i, term] of ['OData', 'un WBS', 'le CDS', 'un BAPI'].entries()) {
      const out = await spot(config, { session: 's1', ...ask(term), earlier: [], toolErrors: 0 }, { mode: 'live', now: at(i * 30) });
      offered.push(out.context !== undefined);
    }
    expect(offered).toEqual([true, true, true, false]);
  });

  it('with suggestions off, nothing is spotted nor kept', async () => {
    const config = await brain();
    const out = await spot(config, { session: 's1', ...ask('OData'), earlier: [], toolErrors: 0 }, { mode: 'never', now: at(0) });
    expect([out.moments, out.context]).toEqual([[], undefined]);
    expect(await loadQueue(config)).toEqual([]);
  });

  it('the hook at the end of an answer, OKB quiet (D76): silent along the way and at the closing, the card waits in the app', async () => {
    await brain();
    const { dir, env } = last;
    const transcript = resolve(dir, 'transcript.jsonl');
    const said = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
    const hook = (answer: string) => spawnSync(process.execPath, [resolve(TEST_ROOT, '..', 'plugin', 'hooks', 'stop.mjs')], {
      input: JSON.stringify({ session_id: 'abc-123', transcript_path: transcript, last_assistant_message: answer, cwd: dir }), env: { ...env, OKB_HEADLESS: '' }, encoding: 'utf8',
    }).stdout;
    await writeFile(transcript, said("c'est quoi OData ?"));
    expect(hook(LONG)).toBe('');
    await appendFile(transcript, said('merci, à demain'));
    expect(hook('Bonne soirée.')).toBe('');
    expect((await json(['suggest', 'list', '--all'], env, dir)).suggestions.map((x: { title: string; status: string }) => [x.title, x.status])).toEqual([['OData', 'pending']]);
  });

  it('the hook at the end of an answer, OKB as in 2.4: silent along the way, one grouped question when the person closes the session', async () => {
    await brain();
    const { dir, env } = last;
    const { writeSetting } = await import('../src/settings/settings.js');
    await writeSetting('travail', 'presence', 'assist', env);
    const transcript = resolve(dir, 'transcript.jsonl');
    const said = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
    const hook = (answer: string) => spawnSync(process.execPath, [resolve(TEST_ROOT, '..', 'plugin', 'hooks', 'stop.mjs')], {
      input: JSON.stringify({ session_id: 'abc-123', transcript_path: transcript, last_assistant_message: answer, cwd: dir }), env: { ...env, OKB_HEADLESS: '' }, encoding: 'utf8',
    }).stdout;
    await writeFile(transcript, said("c'est quoi OData ?"));
    expect(hook(LONG)).toBe('');
    // A tool result is not something the person said.
    await appendFile(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'exit 1' }] } })}\n${said('merci, à demain')}`);
    const end = JSON.parse(hook('Bonne soirée.')) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(end.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(end.hookSpecificOutput.additionalContext).toContain('« OData »');
    expect(end.hookSpecificOutput.additionalContext).toContain('okb suggest later --session abc-123');

    // The person answers « pas maintenant »: the card waits in the app, the session says no more.
    const later = await json(['suggest', 'later', '--session', 'abc-123'], env, dir);
    expect(later.later).toHaveLength(1);
    expect((await json(['suggest', 'list', '--all'], env, dir)).suggestions.map((x: { title: string; status: string }) => [x.title, x.status])).toEqual([['OData', 'later']]);
    await appendFile(transcript, said('bonne nuit'));
    expect(hook('À demain.')).toBe('');
  });
});
