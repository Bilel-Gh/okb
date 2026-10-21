import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs, openDb } from '../src/state/db.js';
import { loadTicket, startTicket } from '../src/work/tickets.js';
import { clearField, isMeaningful, markNotApplicable, readFields, resolveConflict, setField } from '../src/work/ticket-fields.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function ticket() {
  const { config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-1', repo });
  return config;
}
const journal = async (config: Awaited<ReturnType<typeof ticket>>) => (await loadTicket(config, 'DEMO-1'))!.journal.length;

describe('ticket fields keep their origin (F2.4-08/09)', () => {
  it('refuses empty, unknown and the reference itself', async () => {
    const config = await ticket();
    for (const value of ['DEMO-1', '  TBD ', 'Inconnu', '', 'unknown', 'à définir', 'demo-1']) {
      await expect(setField(config, 'DEMO-1', { field: 'title', value, origin: 'agent' })).rejects.toMatchObject({ code: 'E_INVALID' });
    }
    expect(isMeaningful('Le panier perd les remises', 'DEMO-1')).toBe(true);
    expect(readFields(config, 'DEMO-1').fields.title).toBeUndefined();
  });

  it('protects a value the person wrote and keeps the other as a conflict', async () => {
    const config = await ticket();
    await setField(config, 'DEMO-1', { field: 'team', value: 'Équipe Panier', origin: 'person' });
    const r = await setField(config, 'DEMO-1', { field: 'team', value: 'Équipe Paiement', origin: 'jira', url: 'https://jira.example.com/browse/DEMO-1' });
    expect(r.changed).toBe(false);
    expect(r.conflict).toMatchObject({ field: 'team', value: 'Équipe Paiement', origin: 'jira' });
    const read = readFields(config, 'DEMO-1');
    expect(read.fields.team).toMatchObject({ value: 'Équipe Panier', origin: 'person', manual: true });
    expect(read.conflicts).toHaveLength(1);
    await resolveConflict(config, 'DEMO-1', 'team', 'jira');
    const after = readFields(config, 'DEMO-1');
    expect(after.fields.team).toMatchObject({ value: 'Équipe Paiement', origin: 'jira', manual: false, url: 'https://jira.example.com/browse/DEMO-1' });
    expect(after.conflicts).toEqual([]);
  });

  it('keeps the person value when the person keeps it', async () => {
    const config = await ticket();
    await setField(config, 'DEMO-1', { field: 'product', value: 'Boutique', origin: 'person' });
    await setField(config, 'DEMO-1', { field: 'product', value: 'Catalogue', origin: 'servicenow' });
    await resolveConflict(config, 'DEMO-1', 'product', 'mine');
    const read = readFields(config, 'DEMO-1');
    expect(read.fields.product).toMatchObject({ value: 'Boutique', manual: true });
    expect(read.conflicts).toEqual([]);
  });

  it('changes nothing on an identical write', async () => {
    const config = await ticket();
    expect((await setField(config, 'DEMO-1', { field: 'summary', value: 'Les remises disparaissent.', origin: 'agent' })).changed).toBe(true);
    const n = await journal(config);
    expect((await setField(config, 'DEMO-1', { field: 'summary', value: 'Les remises disparaissent.', origin: 'agent' })).changed).toBe(false);
    expect(await journal(config)).toBe(n);
  });

  it('lets a source replace the agent and journals the old value', async () => {
    const config = await ticket();
    await setField(config, 'DEMO-1', { field: 'sourceStatus', value: 'Open', origin: 'agent' });
    await setField(config, 'DEMO-1', { field: 'sourceStatus', value: 'In progress', origin: 'jira' });
    expect(readFields(config, 'DEMO-1').fields.sourceStatus).toMatchObject({ value: 'In progress', origin: 'jira' });
    expect((await loadTicket(config, 'DEMO-1'))!.journal.at(-1)!.text).toContain('Open → In progress');
  });

  it('stores the same conflict once', async () => {
    const config = await ticket();
    await setField(config, 'DEMO-1', { field: 'team', value: 'A', origin: 'person' });
    await Promise.all([setField(config, 'DEMO-1', { field: 'team', value: 'B', origin: 'jira' }), setField(config, 'DEMO-1', { field: 'team', value: 'B', origin: 'jira' })]);
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) n FROM ticket_field_conflicts')!.n).toBe(1);
    expect(readFields(config, 'DEMO-1').fields.team).toMatchObject({ value: 'A', manual: true });
  });

  it('needs a reason for not applicable and refuses it for the blocker', async () => {
    const config = await ticket();
    await expect(markNotApplicable(config, 'DEMO-1', 'description', ' ')).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(markNotApplicable(config, 'DEMO-1', 'blocker' as never, 'aucun')).rejects.toMatchObject({ code: 'E_INVALID' });
    await markNotApplicable(config, 'DEMO-1', 'criteria', 'investigation sans recette');
    expect(readFields(config, 'DEMO-1').notApplicable).toEqual({ criteria: 'investigation sans recette' });
  });

  it('refuses secrets and values over the limit', async () => {
    const config = await ticket();
    await expect(setField(config, 'DEMO-1', { field: 'description', value: 'clé AKIA' + 'Q3J7Z2M5K8W1R4T6', origin: 'agent' })).rejects.toBeTruthy();
    await expect(setField(config, 'DEMO-1', { field: 'summary', value: 'x'.repeat(601), origin: 'agent' })).rejects.toMatchObject({ code: 'E_INVALID' });
  });

  it('clears a value', async () => {
    const config = await ticket();
    await setField(config, 'DEMO-1', { field: 'blocker', value: 'Accès refusé au bac à sable', origin: 'person' });
    await clearField(config, 'DEMO-1', 'blocker');
    expect(readFields(config, 'DEMO-1').fields.blocker).toBeUndefined();
  });

  it('needs a followed ticket', async () => {
    const config = await ticket();
    await expect(setField(config, 'DEMO-9', { field: 'title', value: 'Autre', origin: 'person' })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});
