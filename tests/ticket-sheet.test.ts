import { afterEach, describe, expect, it } from 'vitest';
import { addAction, listActions } from '../src/projects/actions.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { readFields, setField } from '../src/work/ticket-fields.js';
import { ticketSheet } from '../src/work/ticket-sheet.js';
import { setTicketState, ticketDetail, updateTicketBrief } from '../src/work/ticket-state.js';
import { detachRepo, loadTicket, pinTicket, renameTicket, restoreTicket, setSourceLink, startTicket, unfollowTicket } from '../src/work/tickets.js';
import { devProjects } from '../src/work/projects.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function ticket(title?: string) {
  const { config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-1', repo, ...(title ? { title } : {}) });
  return { config, repo };
}

describe('one sheet per ticket (F2.4-08..13, D70)', () => {
  it('never shows the reference as a title or a goal, nor a commit as the last action', async () => {
    const { config } = await ticket();
    const sheet = await ticketSheet(config, 'DEMO-1', 'person');
    expect(sheet.title).toBeNull();
    expect((await ticketDetail(config, 'DEMO-1')).brief).toMatchObject({ goal: '', lastAction: '', next: '' });
  });

  it('reads the next step from the todos, the same everywhere', async () => {
    const { config } = await ticket('Le panier perd les remises');
    const todo = addAction(config, { text: 'Vérifier la page de confirmation', workRef: 'DEMO-1', importance: 'high' });
    const sheet = await ticketSheet(config, 'DEMO-1', 'person');
    expect(sheet.next?.id).toBe(todo.id);
    expect(sheet.todos.map((t) => t.id)).toEqual([todo.id]);
    expect((await ticketDetail(config, 'DEMO-1')).brief.next).toBe('Vérifier la page de confirmation');
    const [work] = await devProjects.work(config, process.env, { kind: 'ticket', ref: 'DEMO-1' });
    expect(work!.context!.next).toBe('Vérifier la page de confirmation');
  });

  it('maps the old brief gesture onto the sheet', async () => {
    const { config, } = await ticket('Titre');
    await updateTicketBrief(config, 'DEMO-1', { goal: 'Garder les remises', lastAction: 'Remises recalculées', next: 'Ouvrir la PR' });
    const f = readFields(config, 'DEMO-1').fields;
    expect(f.summary).toMatchObject({ value: 'Garder les remises', origin: 'person', manual: true });
    expect(f.done).toMatchObject({ value: 'Remises recalculées', origin: 'person' });
    expect((await ticketSheet(config, 'DEMO-1', 'person')).next).toMatchObject({ text: 'Ouvrir la PR', pinned: true });
    await updateTicketBrief(config, 'DEMO-1', { next: 'Demander la revue' });
    expect((await listActions(config, process.env)).filter((a) => a.workRef === 'DEMO-1').map((a) => a.text)).toEqual(['Demander la revue']);
  });

  it('draws the journey from completeness and the separate states', async () => {
    const { config } = await ticket('Le panier perd les remises');
    for (const [field, value] of [['summary', 'Les remises disparaissent'], ['description', 'Observé sur la page panier'], ['team', 'Équipe Panier'], ['done', 'Rien encore'], ['blocker', 'Aucun blocage']] as const) await setField(config, 'DEMO-1', { field, value, origin: 'agent' });
    addAction(config, { text: 'Faire', workRef: 'DEMO-1' });
    await setTicketState(config, 'DEMO-1', { dimension: 'waiting', status: 'blocked', detail: 'Accès refusé' }, 'person');
    const j = (await ticketSheet(config, 'DEMO-1', 'person')).journey;
    expect(j.map((s) => [s.id, s.state])).toEqual([['understood', 'done'], ['work', 'wait'], ['pr', 'unknown'], ['checks', 'unknown'], ['delivery', 'unknown']]);
    expect((await ticketSheet(config, 'DEMO-1', 'person')).completeness.percent).toBe(80);
  });

  it('renames as the person, and pins on Today', async () => {
    const { config } = await ticket();
    await renameTicket(config, 'DEMO-1', 'Le panier perd les remises');
    expect(readFields(config, 'DEMO-1').fields.title).toMatchObject({ value: 'Le panier perd les remises', manual: true });
    expect((await loadTicket(config, 'DEMO-1'))!.title).toBe('Le panier perd les remises');
    await pinTicket(config, 'DEMO-1', true);
    expect((await ticketSheet(config, 'DEMO-1', 'person')).pinned).toBe(true);
  });

  it('unfollows then restores everything, and refuses after 30 days', async () => {
    const { config } = await ticket('Titre');
    await setField(config, 'DEMO-1', { field: 'team', value: 'Équipe Panier', origin: 'person' });
    addAction(config, { text: 'Faire X', workRef: 'DEMO-1' });
    openDb(config).run("INSERT INTO ticket_requests (id, ref, fields, state, created_at) VALUES ('R-1', 'DEMO-1', '[\"team\"]', 'pending', '2026-10-19T00:00:00Z')");
    openDb(config).run("INSERT INTO ticket_links (ref, path, state, origin, at) VALUES ('DEMO-1', 'notes/a.md', 'confirmed', 'person', '2026-10-19T00:00:00Z')");
    await unfollowTicket(config, 'DEMO-1', new Date('2026-10-19T10:00:00Z'));
    expect(await loadTicket(config, 'DEMO-1')).toBeNull();
    expect((await listActions(config, process.env)).some((a) => a.workRef === 'DEMO-1')).toBe(false);
    await restoreTicket(config, 'DEMO-1', new Date('2026-11-01T10:00:00Z'));
    expect(readFields(config, 'DEMO-1').fields.team?.value).toBe('Équipe Panier');
    expect((await listActions(config, process.env)).filter((a) => a.workRef === 'DEMO-1').map((a) => a.text)).toEqual(['Faire X']);
    expect(openDb(config).get<{ n: number }>("SELECT COUNT(*) n FROM ticket_requests WHERE ref = 'DEMO-1'")!.n).toBe(1);
    expect(openDb(config).get<{ n: number }>("SELECT COUNT(*) n FROM ticket_links WHERE ref = 'DEMO-1'")!.n).toBe(1);
    await unfollowTicket(config, 'DEMO-1', new Date('2026-10-19T10:00:00Z'));
    await expect(restoreTicket(config, 'DEMO-1', new Date('2026-11-20T10:00:00Z'))).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('replaces the source link, never with credentials', async () => {
    const { config } = await ticket('Titre');
    await setSourceLink(config, 'DEMO-1', { provider: 'jira', url: 'https://jira.example.com/browse/DEMO-1' });
    expect((await ticketDetail(config, 'DEMO-1')).detail.external).toMatchObject({ provider: 'jira', url: 'https://jira.example.com/browse/DEMO-1' });
    await expect(setSourceLink(config, 'DEMO-1', { provider: 'jira', url: 'https://user:pw@jira.example.com/x' })).rejects.toMatchObject({ code: 'E_INVALID' });
  });

  it('cannot detach the last repository', async () => {
    const { config } = await ticket('Titre');
    await expect(detachRepo(config, 'DEMO-1', 'orders')).rejects.toMatchObject({ code: 'E_INVALID' });
  });
});
