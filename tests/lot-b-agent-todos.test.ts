import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);

async function ctxs() {
  const { config, env } = await demoBrain();
  return { config, person: { config, env, actor: 'person' as const }, agent: { config, env, actor: 'agent' as const } };
}

describe('the agent adds todos to a ticket (F2.4-21, D74)', () => {
  it('an agent todo is the agent’s, with its reason, and counts at once', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Ajouter un test pour le yen', workRef: 'DEMO-4211', importance: 'high', why: 'd’après les critères Jira' }, agent);
    expect(a).toMatchObject({ source: 'ai', why: 'd’après les critères Jira', status: 'open', doneBy: null, importanceBy: null });
    expect((await invoke('actions.list', {}, person)).actions.map((x) => x.id)).toContain(a.id);
  });

  it('the same open todo is given back, not added twice', async () => {
    const { agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Ouvrir la PR', workRef: 'DEMO-1' }, agent);
    const b = await invoke('actions.add', { text: 'ouvrir la PR.', workRef: 'DEMO-1' }, agent);
    expect(b.id).toBe(a.id);
  });
});

describe('what the agent may do on a ticket’s todos (F2.4-22)', () => {
  it('ticks and sets the importance of the person’s todo, and says so', async () => {
    const { person, agent } = await ctxs();
    const mine = await invoke('actions.add', { text: 'Relire la PR', workRef: 'DEMO-2' }, person);
    await invoke('actions.update', { id: mine.id, importance: 'high' }, agent);
    const done = await invoke('actions.update', { id: mine.id, status: 'done' }, agent);
    expect(done).toMatchObject({ status: 'done', doneBy: 'agent', importanceBy: 'agent', text: 'Relire la PR' });
    const back = await invoke('actions.update', { id: mine.id, importance: 'low' }, person);
    expect(back.importanceBy).toBe('person');
  });

  it('never rewrites, drops or deletes the person’s todo', async () => {
    const { person, agent } = await ctxs();
    const mine = await invoke('actions.add', { text: 'Relire la PR', workRef: 'DEMO-3' }, person);
    expect((await failure(invoke('actions.update', { id: mine.id, text: 'Autre chose' }, agent))).code).toBe('E_NOT_APPROVED');
    expect((await failure(invoke('actions.update', { id: mine.id, status: 'dropped' }, agent))).code).toBe('E_NOT_APPROVED');
    expect((await failure(invoke('actions.delete', { id: mine.id }, agent))).code).toBe('E_NOT_APPROVED');
  });

  it('rewrites and removes its own', async () => {
    const { agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Vérifier les arrondis', workRef: 'DEMO-4' }, agent);
    expect((await invoke('actions.update', { id: a.id, text: 'Vérifier les arrondis en livre' }, agent)).text).toBe('Vérifier les arrondis en livre');
    await invoke('actions.delete', { id: a.id }, agent);
    expect((await invoke('actions.list', { status: 'dropped' }, agent)).actions.map((x) => x.id)).toContain(a.id);
  });
});

describe('a todo removed is never proposed again on that ticket (F2.4-23)', () => {
  it('refuses the same todo, or one worded a little differently, and lets another through', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Vérifier les arrondis en livre sterling', workRef: 'DEMO-5' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    expect((await invoke('actions.list', { status: 'dropped' }, person)).actions.map((x) => x.id)).toContain(a.id);
    const again = await failure(invoke('actions.add', { text: 'vérifier les arrondis en Livre Sterling !', workRef: 'DEMO-5' }, agent));
    expect(again).toMatchObject({ code: 'E_CONFLICT' });
    expect((await failure(invoke('actions.add', { text: 'Vérifier les arrondis de la livre sterling', workRef: 'DEMO-5' }, agent))).code).toBe('E_CONFLICT');
    await expect(invoke('actions.add', { text: 'Ouvrir la PR', workRef: 'DEMO-5' }, agent)).resolves.toBeTruthy();
    await expect(invoke('actions.add', { text: 'Vérifier les arrondis en livre sterling', workRef: 'DEMO-6' }, agent)).resolves.toBeTruthy();
  });

  it('the person can still add it themself, and « Annuler » brings it back', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Tester le yen', workRef: 'DEMO-7' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    const back = await invoke('actions.restore', { id: a.id }, person);
    expect(back.status).toBe('open');
    await expect(invoke('actions.add', { text: 'Tester le yen', workRef: 'DEMO-7' }, agent)).resolves.toMatchObject({ id: a.id });
    expect((await failure(invoke('actions.restore', { id: a.id }, agent))).code).toBe('E_NOT_APPROVED');
  });

  it('the person’s own todo is still deleted for good', async () => {
    const { person } = await ctxs();
    const mine = await invoke('actions.add', { text: 'Appeler Paul', workRef: 'DEMO-8' }, person);
    await invoke('actions.delete', { id: mine.id }, person);
    expect((await invoke('actions.list', { status: 'all' }, person)).actions.map((x) => x.id)).not.toContain(mine.id);
  });
});

describe('migration (F2.4-21)', () => {
  it('adds who ticked and set the importance, the reason, and the refusals', async () => {
    const { config } = await ctxs();
    const cols = openDb(config).all<{ name: string }>('PRAGMA table_info(actions)').map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['done_by', 'importance_by', 'why']));
    expect(openDb(config).all<{ name: string }>('PRAGMA table_info(action_refusals)').map((c) => c.name)).toEqual(['work_ref', 'key', 'text', 'at']);
  });
});

describe('review fixes of lot B (D74)', () => {
  it('C1: the agent cannot reopen its todo the person removed; only « Annuler » does', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Tester le franc suisse', workRef: 'DEMO-20' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    expect((await failure(invoke('actions.update', { id: a.id, status: 'open' }, agent))).code).toBe('E_NOT_APPROVED');
    expect((await failure(invoke('actions.update', { id: a.id, status: 'done' }, agent))).code).toBe('E_NOT_APPROVED');
  });

  it('I1: the agent reopens only what was done, never what the person dropped', async () => {
    const { person, agent } = await ctxs();
    const mine = await invoke('actions.add', { text: 'Appeler Inès', workRef: 'DEMO-21' }, person);
    await invoke('actions.update', { id: mine.id, status: 'dropped' }, person);
    expect((await failure(invoke('actions.update', { id: mine.id, status: 'open' }, agent))).code).toBe('E_NOT_APPROVED');
    const other = await invoke('actions.add', { text: 'Relire la doc', workRef: 'DEMO-21' }, person);
    await invoke('actions.update', { id: other.id, status: 'done' }, person);
    await expect(invoke('actions.update', { id: other.id, status: 'open' }, agent)).resolves.toMatchObject({ status: 'open' });
  });

  it('I2: the person dropping an agent todo refuses it too', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Tester le dollar canadien', workRef: 'DEMO-22' }, agent);
    await invoke('actions.update', { id: a.id, status: 'dropped' }, person);
    expect((await failure(invoke('actions.add', { text: 'Tester le dollar canadien', workRef: 'DEMO-22' }, agent))).code).toBe('E_CONFLICT');
  });

  it('I3: numbers and short texts are not taken for a refused todo', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Relire la PR 42', workRef: 'DEMO-23' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    await expect(invoke('actions.add', { text: 'Relire la PR 57', workRef: 'DEMO-23' }, agent)).resolves.toBeTruthy();
    expect((await failure(invoke('actions.add', { text: 'relire la PR 42 !', workRef: 'DEMO-23' }, agent))).code).toBe('E_CONFLICT');
  });

  it('I4: the agent cannot reach a refused todo by rewriting or moving another one', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Tester la livre turque', workRef: 'DEMO-24' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    const b = await invoke('actions.add', { text: 'Autre chose', workRef: 'DEMO-24' }, agent);
    expect((await failure(invoke('actions.update', { id: b.id, text: 'Tester la livre turque' }, agent))).code).toBe('E_CONFLICT');
    const c = await invoke('actions.add', { text: 'Tester la livre turque', workRef: 'DEMO-25' }, agent);
    expect((await failure(invoke('actions.update', { id: c.id, workRef: 'DEMO-24' }, agent))).code).toBe('E_CONFLICT');
  });

  it('M3: a ticket reference in another case does not get past a refusal', async () => {
    const { person, agent } = await ctxs();
    const a = await invoke('actions.add', { text: 'Tester le rand', workRef: 'DEMO-26' }, agent);
    await invoke('actions.delete', { id: a.id }, person);
    expect((await failure(invoke('actions.add', { text: 'Tester le rand', workRef: 'demo-26' }, agent))).code).toBe('E_CONFLICT');
  });

  it('restore only brings back a removed todo of the agent', async () => {
    const { person } = await ctxs();
    const mine = await invoke('actions.add', { text: 'Mon idée', workRef: 'DEMO-27' }, person);
    expect((await failure(invoke('actions.restore', { id: mine.id }, person))).code).toBe('E_CONFLICT');
  });
});
