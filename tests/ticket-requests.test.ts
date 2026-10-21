import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs } from '../src/state/db.js';
import { setField } from '../src/work/ticket-fields.js';
import { cancelRequest, closeRequest, openRequests, requestFields, requestPrompt } from '../src/work/ticket-requests.js';
import { ticketSheet } from '../src/work/ticket-sheet.js';
import { startTicket } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function kb() {
  const { config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-1', title: 'Le panier perd les remises', repo });
  return config;
}
const report = { found: [], missing: [], read: [], unavailable: [], note: '' };

describe('what the person asks the agent to find (F2.4-10)', () => {
  it('keeps one open request per ticket and adds to it', async () => {
    const config = await kb();
    const a = await requestFields(config, 'DEMO-1', ['team']);
    const b = await requestFields(config, 'demo-1', ['product', 'team']);
    expect(b.id).toBe(a.id);
    expect(b.fields).toEqual(['team', 'product']);
    expect(openRequests(config)).toHaveLength(1);
  });

  it('asks for what is missing when no field is named', async () => {
    const config = await kb();
    await setField(config, 'DEMO-1', { field: 'summary', value: 'Les remises disparaissent', origin: 'agent' });
    expect((await requestFields(config, 'DEMO-1', [])).fields).toEqual(['description', 'criteria', 'sourceStatus', 'team', 'product', 'done', 'blocker']);
  });

  it('closes as done, partial or failed from the report', async () => {
    const config = await kb();
    const r1 = await requestFields(config, 'DEMO-1', ['team']);
    expect(closeRequest(config, r1.id, { ...report, found: ['team'], read: ['jira'] }).state).toBe('done');
    const r2 = await requestFields(config, 'DEMO-1', ['team', 'product']);
    expect(closeRequest(config, r2.id, { ...report, found: ['team'], missing: ['product'], read: ['jira'] }).state).toBe('partial');
    const r3 = await requestFields(config, 'DEMO-1', ['product']);
    expect(closeRequest(config, r3.id, { ...report, missing: ['product'], unavailable: ['servicenow'] })).toMatchObject({ state: 'failed', report: { unavailable: ['servicenow'] } });
    expect(openRequests(config)).toEqual([]);
  });

  it('cancels', async () => {
    const config = await kb();
    const r = await requestFields(config, 'DEMO-1', ['team']);
    cancelRequest(config, r.id);
    expect(openRequests(config)).toEqual([]);
  });

  it('writes a prompt that names the fields and the commands, and asks not to invent', async () => {
    const config = await kb();
    const r = await requestFields(config, 'DEMO-1', ['team', 'criteria']);
    const fr = requestPrompt(r, 'fr');
    expect(fr).toContain('DEMO-1');
    expect(fr).toContain('équipe, critères');
    expect(fr).toContain('okb ticket set');
    expect(fr).toContain(`okb ticket requests close ${r.id}`);
    expect(fr).toContain('N’invente rien');
    expect(requestPrompt(r, 'en')).toContain('Do not invent');
  });

  it('shows the open requests on the sheet', async () => {
    const config = await kb();
    await requestFields(config, 'DEMO-1', ['team']);
    expect((await ticketSheet(config, 'DEMO-1', 'person')).requests.map((r) => r.fields)).toEqual([['team']]);
  });

  it('filters by repository', async () => {
    const config = await kb();
    await requestFields(config, 'DEMO-1', ['team']);
    expect(openRequests(config, { repo: 'orders' })).toHaveLength(1);
    expect(openRequests(config, { repo: 'billing' })).toHaveLength(0);
  });
});
