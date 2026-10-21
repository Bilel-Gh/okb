import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { closeDbs } from '../src/state/db.js';
import { startTicket } from '../src/work/tickets.js';
import type { TicketSheet } from '../src/work/ticket-sheet.js';
import { engineRoutes } from '../src/web/api-engine.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function kb() {
  const { s, config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-1', repo });
  const person = { config, env: s.env, actor: 'person' as const };
  const agent = { ...person, actor: 'agent' as const };
  return { s, config, person, agent };
}

describe('the sheet through the engine (F2.4-08..14)', () => {
  it('writes as the person from the app, and never as the person from an agent', async () => {
    const { person, agent } = await kb();
    await invoke('tickets.field.set', { ref: 'DEMO-1', field: 'team', value: 'Équipe Panier' }, person);
    await invoke('tickets.field.set', { ref: 'DEMO-1', field: 'team', value: 'Équipe Paiement', origin: 'jira', url: 'https://jira.example.com/browse/DEMO-1' }, agent);
    await expect(invoke('tickets.field.set', { ref: 'DEMO-1', field: 'product', value: 'Boutique', origin: 'person' }, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    const sheet = await invoke('tickets.sheet', { ref: 'DEMO-1' }, person) as TicketSheet;
    expect(sheet.fields.team).toMatchObject({ value: 'Équipe Panier', origin: 'person' });
    expect(sheet.conflicts).toEqual([expect.objectContaining({ field: 'team', origin: 'jira' })]);
  });

  it('keeps settling a conflict, unfollowing and pinning to the person', async () => {
    const { agent, person } = await kb();
    for (const [id, input] of [['tickets.conflict.resolve', { ref: 'DEMO-1', field: 'team', keep: 'mine' }], ['tickets.unfollow', { ref: 'DEMO-1' }], ['tickets.pin', { ref: 'DEMO-1', pinned: true }], ['tickets.rename', { ref: 'DEMO-1', title: 'Titre' }]] as const) {
      await expect(invoke(id, input, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    }
    await invoke('tickets.rename', { ref: 'DEMO-1', title: 'Le panier perd les remises' }, person);
    expect(((await invoke('tickets.sheet', { ref: 'DEMO-1' }, person)) as TicketSheet).title?.value).toBe('Le panier perd les remises');
  });

  it('serves a ticket documented but not followed', async () => {
    const { config, person } = await kb();
    await writeFixture(resolve(config.kb.root, 'notes/old.md'), '---\ntitle: Ancien cas\ntype: note\ndescription: x\nx_okb: {"v":1,"tickets":["DEMO-9"]}\n---\n\nTexte.\n');
    expect(await invoke('tickets.sheet', { ref: 'demo-9' }, person)).toMatchObject({ ref: 'DEMO-9', followed: false, links: [expect.objectContaining({ path: 'notes/old.md' })] });
    await expect(invoke('tickets.sheet', { ref: 'DEMO-404' }, person)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('asks the agent, lists, closes and gives the prompt', async () => {
    const { person, agent } = await kb();
    const r = await invoke('tickets.requests.create', { ref: 'DEMO-1', fields: ['team'] }, person) as { id: string };
    expect(((await invoke('tickets.requests.list', {}, agent)) as { requests: unknown[] }).requests).toHaveLength(1);
    expect(((await invoke('tickets.requests.prompt', { id: r.id, lang: 'fr' }, person)) as { prompt: string }).prompt).toContain('DEMO-1');
    expect(await invoke('tickets.requests.close', { id: r.id, found: ['team'], missing: [], read: ['jira'], unavailable: [], note: '' }, agent)).toMatchObject({ state: 'done' });
  });

  it('ties todos to a ticket through the app, normalising the reference, and deletes them', async () => {
    const { s, config, person } = await kb();
    const routes = engineRoutes(async () => config);
    const added = await routes['POST /api/actions']!({ env: s.env }, new URLSearchParams(), { text: 'Vérifier la confirmation', workRef: 'demo_1', importance: 'high' }) as { id: string; workRef: string; importance: string };
    expect(added).toMatchObject({ workRef: 'DEMO-1', importance: 'high' });
    await routes['POST /api/action/update']!({ env: s.env }, new URLSearchParams(), { id: added.id, pinned: true, text: 'Vérifier la page de confirmation' });
    expect(((await invoke('tickets.sheet', { ref: 'DEMO-1' }, person)) as TicketSheet).next).toMatchObject({ text: 'Vérifier la page de confirmation', pinned: true });
    await routes['POST /api/action/delete']!({ env: s.env }, new URLSearchParams(), { id: added.id });
    expect(((await invoke('tickets.sheet', { ref: 'DEMO-1' }, person)) as TicketSheet).next).toBeNull();
  });

  it('links a note by hand and scans', async () => {
    const { config, person } = await kb();
    await writeFixture(resolve(config.kb.root, 'notes/cas.md'), '---\ntitle: Cas DEMO-1\ntype: note\ndescription: x\n---\n\nTexte.\n');
    expect(await invoke('tickets.links.scan', {}, person)).toEqual({ suggested: 1 });
    await invoke('tickets.links.set', { ref: 'DEMO-1', path: 'notes/cas.md', state: 'confirmed' }, person);
    expect(((await invoke('tickets.links.list', { ref: 'DEMO-1' }, person)) as { links: { state: string }[] }).links.map((l) => l.state)).toEqual(['confirmed']);
  });
});
