import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { setModule } from '../src/modules/catalog.js';
import { addAction } from '../src/projects/actions.js';
import { closeDbs } from '../src/state/db.js';
import { setField } from '../src/work/ticket-fields.js';
import { requestFields } from '../src/work/ticket-requests.js';
import { ticketSheet } from '../src/work/ticket-sheet.js';
import { setTicketState } from '../src/work/ticket-state.js';
import { pinTicket, startTicket } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function kb(n: number) {
  const { s, config } = await workKb();
  await setModule('dev', true, s.env);
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  for (let i = 1; i <= n; i++) await startTicket(config, { ref: `DEMO-${i}`, title: `Ticket numéro ${i}`, repo });
  const ctx = { config, env: s.env, actor: 'person' as const };
  return { s, config, ctx };
}

describe('Today picks up tickets from their sheet (F2.4-13, D70)', () => {
  it('shows up to 3 cards, then 5 lines, with the counts', async () => {
    const { ctx } = await kb(12);
    const today = await invoke('today.view', {}, ctx);
    expect(today.resumeCards.first).toHaveLength(3);
    expect(today.resumeCards.more).toHaveLength(5);
    expect(today.resumeCards.total).toBe(12);
    expect(today.resumeCards.counts).toEqual({ progress: 12, waiting: 0, blocked: 0 });
    // Filters run over every work in progress, not only the eight shown.
    expect(today.resumeCards.pool).toHaveLength(12);
  }, 60_000);

  it('works with 0 and 1 ticket', async () => {
    const none = await kb(0);
    expect((await invoke('today.view', {}, none.ctx)).resumeCards).toMatchObject({ first: [], more: [], total: 0 });
    closeDbs();
    const one = await kb(1);
    expect((await invoke('today.view', {}, one.ctx)).resumeCards.first.map((c) => c.card?.ref)).toEqual(['DEMO-1']);
  });

  it('puts the pinned first, then the unblocked, then the most recent', async () => {
    const { config, ctx } = await kb(4);
    await pinTicket(config, 'DEMO-1', true);
    await setTicketState(config, 'DEMO-2', { dimension: 'waiting', status: 'blocked', detail: 'Accès' }, 'person');
    await setTicketState(config, 'DEMO-2', { dimension: 'waiting', status: 'none' }, 'person');
    const first = (await invoke('today.view', {}, ctx)).resumeCards.first.map((c) => c.card?.ref);
    expect(first.slice(0, 2)).toEqual(['DEMO-1', 'DEMO-2']);
  });

  it('gives each card the same next step as the sheet, and its filter', async () => {
    const { config, ctx } = await kb(2);
    addAction(config, { text: 'Vérifier la confirmation', workRef: 'DEMO-1', importance: 'high' });
    await setTicketState(config, 'DEMO-2', { dimension: 'waiting', status: 'waiting', detail: 'L’avis de Paul' }, 'person');
    await setField(config, 'DEMO-1', { field: 'blocker', value: 'Aucun blocage', origin: 'person' });
    const cards = new Map((await invoke('today.view', {}, ctx)).resumeCards.first.map((c) => [c.card!.ref, c.card!]));
    expect(cards.get('DEMO-1')).toMatchObject({ next: (await ticketSheet(config, 'DEMO-1', 'person')).next!.text, filter: 'progress', title: 'Ticket numéro 1' });
    expect(cards.get('DEMO-2')).toMatchObject({ waitingFor: 'L’avis de Paul', filter: 'waiting' });
  });

  it('lists the open requests and ties each todo to its work', async () => {
    const { config, ctx } = await kb(1);
    await requestFields(config, 'DEMO-1', ['team']);
    addAction(config, { text: 'Ouvrir la PR', workRef: 'DEMO-1' });
    addAction(config, { text: 'Préparer la démo' });
    const today = await invoke('today.view', {}, ctx);
    expect(today.requests).toEqual([expect.objectContaining({ ref: 'DEMO-1', fields: ['team'] })]);
    expect(today.todo.map((a) => [a.text, a.work?.ref ?? null])).toEqual(expect.arrayContaining([['Ouvrir la PR', 'DEMO-1'], ['Préparer la démo', null]]));
  });

  it('with the developer module off: no ticket cards, no requests, ticket todos shown without a link', async () => {
    const { s, config, ctx } = await kb(1);
    await requestFields(config, 'DEMO-1', ['team']);
    addAction(config, { text: 'Ouvrir la PR', workRef: 'DEMO-1' });
    await setModule('dev', false, s.env);
    const today = await invoke('today.view', {}, ctx);
    expect(today.resumeCards.first.filter((c) => c.card)).toEqual([]);
    expect(today.requests).toEqual([]);
    expect(today.todo.find((a) => a.text === 'Ouvrir la PR')?.work).toBeNull();
  });
});

describe('field changes stay on the sheet, not in what happened (D70)', () => {
  it('keeps field changes out of Today’s journal but in the sheet history', async () => {
    const { config, ctx } = await kb(1);
    await setField(config, 'DEMO-1', { field: 'team', value: 'Équipe Panier', origin: 'person' });
    const today = await invoke('today.view', {}, ctx);
    expect(today.done.map((e) => e.text).join('\n')).not.toContain('Équipe Panier');
    expect((await ticketSheet(config, 'DEMO-1', 'person')).history.map((h) => h.text).join('\n')).toContain('Équipe Panier');
  });
});

describe('a repository is a place, not work to pick up', () => {
  it('leaves registered repositories out of the cards and the counts', async () => {
    const { addRepo } = await import('../src/repo/registry.js');
    const { s, config, ctx } = await kb(2);
    await addRepo({ path: await gitFixture(), kb: config.profile.id }, s.env);
    const today = await invoke('today.view', {}, ctx);
    expect(today.resumeCards.total).toBe(2);
    expect(today.resumeCards.pool.map((p) => p.kind)).toEqual(['ticket', 'ticket']);
  });
});
