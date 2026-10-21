import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { setModule } from '../src/modules/catalog.js';
import { addAction } from '../src/projects/actions.js';
import { listProjects, updateProject } from '../src/projects/projects.js';
import { syncProjects } from '../src/projects/sources.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { readFields, setField } from '../src/work/ticket-fields.js';
import { linksFor } from '../src/work/ticket-links.js';
import { migrateTicketFields } from '../src/work/ticket-migrate.js';
import { nextStep } from '../src/work/ticket-next.js';
import { cancelRequest, closeRequest, requestFields } from '../src/work/ticket-requests.js';
import { setTicketState } from '../src/work/ticket-state.js';
import { pinTicket, restoreTicket, startTicket, unfollowTicket } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function kb(title?: string) {
  const { s, config } = await workKb();
  await setModule('dev', true, s.env);
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-42', repo, ...(title ? { title } : {}) });
  const person = { config, env: s.env, actor: 'person' as const };
  return { s, config, repo, person, agent: { ...person, actor: 'agent' as const } };
}

describe('final review fixes of lot A (D70)', () => {
  it('an agent correcting the brief writes as the agent, never as the person', async () => {
    const { config, agent } = await kb('Titre');
    await setField(config, 'DEMO-42', { field: 'summary', value: 'Écrit par la personne', origin: 'person' });
    await invoke('tickets.brief', { ref: 'DEMO-42', goal: 'Écrit par un agent' }, agent);
    expect(readFields(config, 'DEMO-42').fields.summary).toMatchObject({ value: 'Écrit par la personne', manual: true });
    expect(readFields(config, 'DEMO-42').conflicts).toEqual([expect.objectContaining({ origin: 'agent', value: 'Écrit par un agent' })]);
  });

  it('an agent cannot declare a field not applicable, change the source link or dismiss a note for good', async () => {
    const { agent } = await kb('Titre');
    await expect(invoke('tickets.field.na', { ref: 'DEMO-42', field: 'summary', reason: 'x' }, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    await expect(invoke('tickets.source', { ref: 'DEMO-42', provider: 'jira', url: 'https://jira.example.com/browse/DEMO-42' }, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    await expect(invoke('tickets.links.set', { ref: 'DEMO-42', path: 'notes/a.md', state: 'dismissed' }, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
  });

  it('restoring a ticket brings back its project, its end-of-session resumption, its journal and its pin', async () => {
    const { s, config } = await kb('Titre');
    await syncProjects(config, s.env);
    const project = (await listProjects(config, s.env, { status: 'all' })).find((p) => p.ref === 'DEMO-42')!;
    updateProject(config, project.id, { leftOff: { done: 'Tests faits', tried: '', waiting: '', resume: 'Reprendre ici', at: '2026-10-19T08:00:00Z', edited: true } });
    const a = addAction(config, { text: 'Action du projet', project: project.id });
    openDb(config).run("INSERT INTO journal (id, project_id, at, day, kind, text) VALUES ('E-old001', ?, '2026-10-19T08:00:00Z', '2026-10-19', 'note', 'Ligne du projet')", project.id);
    await pinTicket(config, 'DEMO-42', true);
    await unfollowTicket(config, 'DEMO-42', new Date('2026-10-19T10:00:00Z'));
    await restoreTicket(config, 'DEMO-42', new Date('2026-10-20T10:00:00Z'));
    const back = openDb(config).get<{ id: string; left_off: string }>("SELECT id, left_off FROM projects WHERE kind = 'ticket' AND ref = 'DEMO-42'")!;
    expect(back.id).toBe(project.id);
    expect(JSON.parse(back.left_off).resume).toBe('Reprendre ici');
    expect(openDb(config).get<{ project_id: string }>("SELECT project_id FROM journal WHERE id = 'E-old001'")!.project_id).toBe(project.id);
    expect(openDb(config).get<{ project_id: string }>('SELECT project_id FROM actions WHERE id = ?', a.id)!.project_id).toBe(project.id);
    expect(openDb(config).get<{ pinned: number }>("SELECT pinned FROM ticket_flags WHERE ref = 'DEMO-42'")!.pinned).toBe(1);
  });

  it('the one-time migration checks its mark inside the transaction', async () => {
    const { config } = await kb('Titre');
    openDb(config).run("UPDATE ticket_details SET next_step = 'Étape' WHERE ref = 'DEMO-42'");
    openDb(config).run("INSERT OR IGNORE INTO ticket_details (ref, next_step) VALUES ('DEMO-42', 'Étape')");
    openDb(config).run("DELETE FROM meta WHERE key = 'tickets.fields.v1'");
    await Promise.all([migrateTicketFields(config), migrateTicketFields(config)]);
    expect(openDb(config).get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE ticket_ref = 'DEMO-42'")!.n).toBe(1);
  });

  it('a blocker that only starts like « no blocker » is still a blocker', async () => {
    const { config, person } = await kb('Titre');
    await setField(config, 'DEMO-42', { field: 'blocker', value: 'Pas de réponse de Paul', origin: 'person' });
    expect((await invoke('today.view', {}, person)).resumeCards.counts.blocked).toBe(1);
    await setField(config, 'DEMO-42', { field: 'blocker', value: 'Aucun blocage', origin: 'person' });
    expect((await invoke('today.view', {}, person)).resumeCards.counts.blocked).toBe(0);
  });

  it('something one waits for is never the next step', async () => {
    const { config } = await kb('Titre');
    addAction(config, { text: 'L’avis de Paul', kind: 'waiting', workRef: 'DEMO-42', importance: 'high' });
    const todo = addAction(config, { text: 'Écrire le test', workRef: 'DEMO-42' });
    expect(nextStep(config, 'DEMO-42')?.id).toBe(todo.id);
  });

  it('a mention of DEMO-4211 is not a mention of DEMO-42', async () => {
    const { config } = await kb('Titre');
    await writeFixture(resolve(config.kb.root, 'notes/autre.md'), '---\ntitle: Vu sur DEMO-4211\ntype: note\ndescription: x\n---\n\nTexte.\n');
    await writeFixture(resolve(config.kb.root, 'notes/bon.md'), '---\ntitle: Vu sur DEMO-42.\ntype: note\ndescription: x\n---\n\nTexte.\n');
    expect((await linksFor(config, 'DEMO-42', 'person')).map((l) => l.path)).toEqual(['notes/bon.md']);
  });

  it('a title typed by the person at start is theirs', async () => {
    const { config, person } = await kb();
    await invoke('tickets.start', { ref: 'DEMO-43', repo: 'orders', title: 'Titre de la personne' }, person).catch(() => undefined);
    await startTicket(config, { ref: 'DEMO-44', repo: { id: 'orders', name: 'Orders', path: (await gitFixture()), kb: 'travail', addedAt: '', remote: null }, title: 'Titre tapé', origin: 'person' });
    expect(readFields(config, 'DEMO-44').fields.title).toMatchObject({ origin: 'person', manual: true });
  });

  it('a cancelled request cannot be closed', async () => {
    const { config } = await kb('Titre');
    const r = await requestFields(config, 'DEMO-42', ['team']);
    cancelRequest(config, r.id);
    expect(() => closeRequest(config, r.id, { found: ['team'], missing: [], read: ['jira'], unavailable: [], note: '' })).toThrow();
  });

  it('waiting states still count as waiting', async () => {
    const { config, person } = await kb('Titre');
    await setTicketState(config, 'DEMO-42', { dimension: 'waiting', status: 'waiting', detail: 'Paul' }, 'person');
    expect((await invoke('today.view', {}, person)).resumeCards.counts.waiting).toBe(1);
  });
});
