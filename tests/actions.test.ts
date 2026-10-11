import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { detectAction } from '../src/projects/detect.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);

describe('actions and what the person waits for (F2.0-06)', () => {
  it('an action belongs to a project, has a date, and doing it leaves a line in the project’s journal', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
    const todo = await invoke('actions.add', { text: 'Réserver le car', project: project.id, due: '2027-05-15' }, ctx);
    expect(todo).toMatchObject({ kind: 'todo', status: 'open', due: '2027-05-15', projectId: project.id, source: 'person' });
    expect(todo.id).toMatch(/^A-[a-z0-9]{6}$/);
    const waiting = await invoke('actions.add', { text: 'L’accord de la mairie', kind: 'waiting', who: 'Paul', project: project.id }, ctx);
    expect(waiting).toMatchObject({ kind: 'waiting', who: 'Paul' });
    expect((await invoke('actions.list', { project: project.id }, ctx)).actions.map((a) => a.id).sort()).toEqual([todo.id, waiting.id].sort());

    const done = await invoke('actions.update', { id: todo.id, status: 'done' }, ctx);
    expect(done.status).toBe('done');
    expect(done.doneAt).toBeTruthy();
    expect((await invoke('actions.list', { project: project.id }, ctx)).actions.map((a) => a.id)).toEqual([waiting.id]);
    expect((await invoke('actions.list', { project: project.id, status: 'done' }, ctx)).actions.map((a) => a.id)).toEqual([todo.id]);
    const journal = await invoke('journal.list', { project: project.id }, ctx);
    expect(journal.entries.map((e) => [e.kind, e.text])).toContainEqual(['done', 'Réserver le car']);
  });

  it('an action can stand alone; a wrong date or an unknown project is refused', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const alone = await invoke('actions.add', { text: 'Appeler le garage' }, ctx);
    expect(alone.projectId).toBeNull();
    expect((await failure(invoke('actions.add', { text: 'x', due: '15 mai' }, ctx))).key).toBe('invalidInput');
    expect((await failure(invoke('actions.add', { text: 'x', project: 'P-nope00' }, ctx))).code).toBe('E_NOT_FOUND');
    expect((await failure(invoke('actions.update', { id: 'A-nope00', status: 'done' }, ctx))).code).toBe('E_NOT_FOUND');
  });

  it('the open actions come the late ones first, then by date, the undated last', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    for (const [text, due] of [['sans date', undefined], ['plus tard', '2030-01-01'], ['en retard', '2020-01-01']] as const) await invoke('actions.add', { text, ...(due ? { due } : {}) }, ctx);
    expect((await invoke('actions.list', {}, ctx)).actions.map((a) => a.text)).toEqual(['en retard', 'plus tard', 'sans date']);
  });

  it('what an agent adds is marked as coming from the AI', async () => {
    const { config, env } = await demoBrain();
    const added = await invoke('actions.add', { text: 'Relancer la compta' }, { config, env, actor: 'agent' });
    expect(added.source).toBe('ai');
  });
});

describe('spotting an action in a line the person keeps (F2.0-06)', () => {
  const now = new Date('2026-10-16T09:00:00Z');
  it('a thing to do, with its date', () => {
    expect(detectAction('réserver le car avant le 15 mai', now)).toEqual({ kind: 'todo', text: 'Réserver le car', due: '2027-05-15' });
    expect(detectAction('Il faut relancer la compta demain', now)).toEqual({ kind: 'todo', text: 'Relancer la compta', due: '2026-10-17' });
    expect(detectAction('Remember to send the report by 3/11', now)).toEqual({ kind: 'todo', text: 'Send the report', due: '2026-11-03' });
    expect(detectAction('ne pas oublier de vérifier le quota lundi', now)).toEqual({ kind: 'todo', text: 'Vérifier le quota', due: '2026-10-19' });
  });
  it('something expected from someone', () => {
    expect(detectAction('J’attends l’avis de Paul sur la PR', now)).toEqual({ kind: 'waiting', text: 'L’avis de Paul sur la PR', who: 'Paul' });
    expect(detectAction('Waiting for Inès to confirm the dates', now)).toEqual({ kind: 'waiting', text: 'Inès to confirm the dates', who: 'Inès' });
  });
  it('a plain fact is not an action', () => {
    expect(detectAction('Paul dit que le quota passe à 500 par minute', now)).toBeNull();
    expect(detectAction('Le cache est vidé à la connexion', now)).toBeNull();
    expect(detectAction('', now)).toBeNull();
  });
});
