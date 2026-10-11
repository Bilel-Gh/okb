import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { setModule } from '../src/modules/catalog.js';
import { closeDbs } from '../src/state/db.js';
import { addJournal, startTicket } from '../src/work/tickets.js';
import { demoBrain } from './helpers/brain.js';
import { registered, useRepoSandboxes } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

describe('the journal, by day and by project (F2.0-05)', () => {
  it('a line written in a project is found in its journal and in the day', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Cache des sessions' }, ctx);
    const entry = await invoke('journal.add', { text: 'On garde PostgreSQL', kind: 'decision', project: project.id }, ctx);
    expect(entry).toMatchObject({ kind: 'decision', text: 'On garde PostgreSQL', projectId: project.id, source: 'person' });
    await invoke('journal.add', { text: 'Index sur created_at : aucun gain', kind: 'tried', project: project.id }, ctx);
    await invoke('journal.add', { text: 'Une ligne sans projet' }, ctx);
    const mine = await invoke('journal.list', { project: project.id }, ctx);
    expect(mine.entries.map((e) => e.text)).toEqual(['Index sur created_at : aucun gain', 'On garde PostgreSQL']);
    const today = await invoke('journal.list', { day: entry.day }, ctx);
    expect(today.entries).toHaveLength(3);
    expect(today.entries.find((e) => e.text === 'On garde PostgreSQL')!.project).toEqual({ id: project.id, title: 'Cache des sessions' });
  });

  it('with the developer module, what happened on a ticket is in its project’s journal', async () => {
    const { config, repo, s } = await registered();
    const env = { ...process.env, OKB_HOME: s.home };
    const ctx = { config, env, actor: 'person' as const };
    await startTicket(config, { ref: 'ABC-231', title: 'Accélérer l’export CSV', repo });
    await addJournal(config, 'ABC-231', { kind: 'decision', text: 'Pagination par curseur' });
    const project = (await invoke('projects.list', {}, ctx)).projects.find((p) => p.ref === 'ABC-231')!;
    await invoke('journal.add', { text: 'Repris les tests', project: project.id }, ctx);
    const texts = (await invoke('journal.list', { project: project.id }, ctx)).entries.map((e) => [e.kind, e.text]);
    expect(texts).toContainEqual(['decision', 'Pagination par curseur']);
    expect(texts).toContainEqual(['note', 'Repris les tests']);
    await setModule('dev', false, env);
    expect((await invoke('journal.list', { day: new Date().toISOString().slice(0, 10) }, ctx)).entries.map((e) => e.text)).not.toContain('Pagination par curseur');
  });
});

describe('« Où j’en étais » (F2.0-07)', () => {
  it('leaving a project prepares where the person was, from what happened since the last time', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Export CSV', next: 'Finir les tests du batch' }, ctx);
    const done = await invoke('actions.add', { text: 'Écrire la pagination', project: project.id }, ctx);
    await invoke('actions.update', { id: done.id, status: 'done' }, ctx);
    await invoke('journal.add', { text: 'Un index sur created_at : aucun gain', kind: 'tried', project: project.id }, ctx);
    await invoke('actions.add', { text: 'L’avis de Paul sur la PR', kind: 'waiting', who: 'Paul', project: project.id }, ctx);
    const left = await invoke('projects.leave', { id: project.id }, ctx);
    expect(left.leftOff).toMatchObject({
      done: 'Écrire la pagination', tried: 'Un index sur created_at : aucun gain', waiting: 'L’avis de Paul sur la PR (Paul)', resume: 'Finir les tests du batch', edited: false,
    });
    expect((await invoke('journal.list', { project: project.id }, ctx)).entries[0]).toMatchObject({ kind: 'resume' });

    const corrected = await invoke('projects.leave', { id: project.id, resume: 'Les tests, fichier export.spec.ts' }, ctx);
    expect(corrected.leftOff).toMatchObject({ resume: 'Les tests, fichier export.spec.ts', done: 'Écrire la pagination', edited: true });
  });

  it('a second time counts only what happened after the first', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Export CSV' }, ctx);
    await invoke('journal.add', { text: 'Premier essai raté', kind: 'tried', project: project.id }, ctx);
    await invoke('projects.leave', { id: project.id }, ctx);
    await new Promise((r) => setTimeout(r, 15));
    await invoke('journal.add', { text: 'Deuxième essai raté', kind: 'tried', project: project.id }, ctx);
    const second = await invoke('projects.leave', { id: project.id }, ctx);
    expect(second.leftOff!.tried).toBe('Deuxième essai raté');
  });
});
