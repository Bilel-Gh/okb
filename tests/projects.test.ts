import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { setModule } from '../src/modules/catalog.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { finishTicket, startTicket } from '../src/work/tickets.js';
import { demoBrain } from './helpers/brain.js';
import { registered, useRepoSandboxes } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);

describe('the project, at the centre (F2.0-03)', () => {
  it('a project is created by the person, says where it stands and what comes next, and can be closed', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const made = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
    expect(made).toMatchObject({ kind: 'subject', title: 'Sortie de juin', status: 'active', where: '', next: '' });
    expect(made.id).toMatch(/^P-[a-z0-9]{6}$/);
    const edited = await invoke('projects.update', { id: made.id, where: 'Le car est réservé.', next: 'Envoyer les autorisations' }, ctx);
    expect(edited).toMatchObject({ where: 'Le car est réservé.', next: 'Envoyer les autorisations' });
    expect((await invoke('projects.list', {}, ctx)).projects.map((p) => p.title)).toEqual(['Sortie de juin']);
    await invoke('projects.update', { id: made.id, status: 'done' }, ctx);
    expect((await invoke('projects.list', {}, ctx)).projects).toEqual([]);
    expect((await invoke('projects.list', { status: 'done' }, ctx)).projects.map((p) => p.id)).toEqual([made.id]);
    expect((await invoke('projects.get', { id: made.id }, ctx)).project.status).toBe('done');
  });

  it('an unknown project and an empty title are refused', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    expect((await failure(invoke('projects.get', { id: 'P-nope00' }, ctx))).code).toBe('E_NOT_FOUND');
    expect((await failure(invoke('projects.create', { title: '  ' }, ctx))).key).toBe('invalidInput');
  });

  it('with the developer module, a repository and a ticket are projects; turned off, they are hidden and nothing is lost', async () => {
    const { config, repo, s } = await registered();
    const env = { ...process.env, OKB_HOME: s.home };
    const ctx = { config, env, actor: 'person' as const };
    await startTicket(config, { ref: 'ABC-231', title: 'Accélérer l’export CSV', repo });
    const first = (await invoke('projects.list', {}, ctx)).projects;
    expect(first.map((p) => [p.kind, p.ref, p.title])).toEqual(expect.arrayContaining([['repo', repo.id, repo.name], ['ticket', 'ABC-231', 'Accélérer l’export CSV']]));
    const ticket = first.find((p) => p.kind === 'ticket')!;
    await invoke('projects.update', { id: ticket.id, where: 'La pagination marche.' }, ctx);

    await setModule('dev', false, env);
    expect((await invoke('projects.list', {}, ctx)).projects).toEqual([]);
    await setModule('dev', true, env);
    const back = (await invoke('projects.list', {}, ctx)).projects.find((p) => p.kind === 'ticket')!;
    expect(back).toMatchObject({ id: ticket.id, where: 'La pagination marche.' });

    await finishTicket(config, 'ABC-231');
    expect((await invoke('projects.list', { status: 'done' }, ctx)).projects.map((p) => p.ref)).toContain('ABC-231');
  });
});
