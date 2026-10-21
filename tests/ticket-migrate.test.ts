import { afterEach, describe, expect, it } from 'vitest';
import { listActions } from '../src/projects/actions.js';
import { syncProjects } from '../src/projects/sources.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { readFields } from '../src/work/ticket-fields.js';
import { migrateTicketFields } from '../src/work/ticket-migrate.js';
import { startTicket } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function legacy(ref: string, title: string, detail: { goal?: string; last?: string; next?: string }, commit?: string) {
  const { config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref, title, repo });
  const db = openDb(config);
  const row = db.get<{ payload: string }>('SELECT payload FROM tickets WHERE ref = ?', ref)!;
  const record = JSON.parse(row.payload);
  record.title = title;
  if (commit) record.journal.push({ at: '2026-10-14T10:00:00Z', kind: 'commit', text: commit });
  db.run('UPDATE tickets SET payload = ? WHERE ref = ?', JSON.stringify(record), ref);
  db.run('INSERT OR REPLACE INTO ticket_details (ref, goal, last_action, next_step) VALUES (?, ?, ?, ?)', ref, detail.goal ?? '', detail.last ?? '', detail.next ?? '');
  db.run("DELETE FROM meta WHERE key = 'tickets.fields.v1'");
  db.run('DELETE FROM ticket_fields');
  return config;
}

describe('the 2.0 tickets move to their sheet without loss (F2.4-08, D70)', () => {
  it('keeps the reference out of the title and the summary, and a commit out of done', async () => {
    const config = await legacy('DEMO-1', 'DEMO-1', { goal: 'DEMO-1', last: 'fix(cart): keep discounts' }, 'fix(cart): keep discounts');
    await migrateTicketFields(config);
    expect(readFields(config, 'DEMO-1').fields).toEqual({});
  });

  it('moves a real title, goal and last action', async () => {
    const config = await legacy('DEMO-2', 'Le panier perd les remises', { goal: 'Garder les remises après conversion', last: 'Remises recalculées dans le service panier' });
    await migrateTicketFields(config);
    const f = readFields(config, 'DEMO-2').fields;
    expect(f.title).toMatchObject({ value: 'Le panier perd les remises', origin: 'agent', manual: false });
    expect(f.summary?.value).toBe('Garder les remises après conversion');
    expect(f.done?.value).toBe('Remises recalculées dans le service panier');
  });

  it('turns the next step into a pinned todo, and a different project next step into another', async () => {
    const config = await legacy('DEMO-3', 'Titre', { next: 'Écrire le test des soldes' });
    await syncProjects(config, process.env);
    openDb(config).run("UPDATE projects SET next_step = 'Relire la PR' WHERE kind = 'ticket' AND ref = 'DEMO-3'");
    openDb(config).run("DELETE FROM meta WHERE key = 'tickets.fields.v1'");
    expect(await migrateTicketFields(config)).toEqual({ tickets: 1, todos: 2 });
    const todos = (await listActions(config, process.env)).filter((a) => a.workRef === 'DEMO-3');
    expect(todos.map((a) => [a.text, a.pinned])).toEqual(expect.arrayContaining([['Écrire le test des soldes', true], ['Relire la PR', false]]));
  });

  it('ties the actions of a ticket project to the ticket', async () => {
    const config = await legacy('DEMO-4', 'Titre', {});
    await syncProjects(config, process.env);
    const project = openDb(config).get<{ id: string }>("SELECT id FROM projects WHERE kind = 'ticket' AND ref = 'DEMO-4'")!;
    openDb(config).run("INSERT INTO actions (id, project_id, text, kind, status, source, created_at) VALUES ('A-old001', ?, 'Demander l’accès', 'todo', 'open', 'person', '2026-10-10T00:00:00Z')", project.id);
    openDb(config).run("DELETE FROM meta WHERE key = 'tickets.fields.v1'");
    await migrateTicketFields(config);
    expect(openDb(config).get<{ ticket_ref: string }>("SELECT ticket_ref FROM actions WHERE id = 'A-old001'")!.ticket_ref).toBe('DEMO-4');
  });

  it('runs once', async () => {
    const config = await legacy('DEMO-5', 'Titre réel', { next: 'Faire X' });
    await migrateTicketFields(config);
    expect(await migrateTicketFields(config)).toEqual({ tickets: 0, todos: 0 });
    expect(openDb(config).get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE ticket_ref = 'DEMO-5'")!.n).toBe(1);
  });

  it('leaves the old columns readable', async () => {
    const config = await legacy('DEMO-6', 'Titre', { goal: 'Objectif ancien', next: 'Étape ancienne' });
    await migrateTicketFields(config);
    expect(openDb(config).get('SELECT goal, next_step FROM ticket_details WHERE ref = ?', 'DEMO-6')).toEqual({ goal: 'Objectif ancien', next_step: 'Étape ancienne' });
  });
});
