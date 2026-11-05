import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { closeDbs } from '../src/state/db.js';
import { setField } from '../src/work/ticket-fields.js';
import { ticketSheet } from '../src/work/ticket-sheet.js';
import { addAttempt, setTicketState } from '../src/work/ticket-state.js';
import { ticketStory } from '../src/work/ticket-story.js';
import { addJournal, startTicket, ticketId } from '../src/work/tickets.js';
import { trackerOf } from '../src/work/tracker.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

describe('where a ticket lives (chantier 4)', () => {
  it('tells Jira from ServiceNow by the link first, then by the reference', () => {
    expect(trackerOf('ORD-42')).toBe('jira');
    expect(trackerOf('INC0012345')).toBe('servicenow');
    expect(trackerOf('RITM0004567')).toBe('servicenow');
    expect(trackerOf('T-panier-lent')).toBe('other');
    expect(trackerOf('ORD-42', { provider: 'servicenow', url: 'https://x.service-now.com/x' })).toBe('servicenow');
    expect(trackerOf('T-x', { url: 'https://acme.atlassian.net/browse/ORD-42' })).toBe('jira');
  });

  it('keeps a ServiceNow number as a reference, not a title', () => {
    expect(ticketId('inc0012345')).toBe('INC0012345');
    expect(ticketId('ord-42')).toBe('ORD-42');
    expect(ticketId('Le panier est lent')).toBe('T-le-panier-est-lent');
  });
});

describe('how I solved it (chantier 4)', () => {
  const at = (d: number) => `2026-11-0${d}T10:00:00.000Z`;
  it('is a short explanation when the ticket went through at once', () => {
    const story = ticketStory({ journal: [{ at: at(1), kind: 'start', text: 'branch feature/ORD-42' }, { at: at(2), kind: 'note', text: 'La conversion passe avant la remise.' }, { at: at(3), kind: 'done', text: '' }], attempts: [], states: [{ dimension: 'pr', environment: null, status: 'merged', source: 'github', at: at(3), detail: '', url: 'https://github.com/o/r/pull/7' }], done: 'Conversion avant remise, test ajouté.' });
    expect(story).toMatchObject({ shape: 'straight', summary: 'Conversion avant remise, test ajouté.', pr: 'https://github.com/o/r/pull/7' });
  });

  it('is a timeline, in order, when there was a blocker, a review or a reopening', () => {
    const story = ticketStory({
      journal: [
        { at: at(1), kind: 'start', text: '' },
        { at: at(2), kind: 'note', text: 'Première explication.' },
        { at: at(2), kind: 'commit', text: 'fix: a' }, { at: at(2), kind: 'commit', text: 'fix: b' },
        { at: at(5), kind: 'note', text: 'Nouvelle explication.' },
      ],
      attempts: [{ id: 'a1', approach: 'Arrondir à la fin', conditions: 'devise USD', result: 'faux de 1 centime', next: 'convertir avant', at: at(3) }],
      states: [{ dimension: 'pr', environment: null, status: 'changes-requested', source: 'github', at: at(4), detail: 'mauvais composant de bouton', url: null }],
    });
    expect(story.shape).toBe('timeline');
    expect(story.steps.map((s) => s.kind)).toEqual(['start', 'explain', 'commits', 'blocker', 'fix', 'review', 'explain']);
    expect(story.steps.find((s) => s.kind === 'commits')!.text).toBe('fix: a · fix: b');
  });

  it('is empty when nothing was kept', () => {
    expect(ticketStory({ journal: [{ at: at(1), kind: 'start', text: '' }], attempts: [], states: [] }).shape).toBe('empty');
  });

  it('reaches the sheet and the list, with the mission and the source', async () => {
    const { config } = await workKb();
    const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
    await startTicket(config, { ref: 'INC0012345', repo });
    await setField(config, 'INC0012345', { field: 'summary', value: 'Le client ne voit plus ses remises.\nDétails plus bas.', origin: 'agent' });
    await addJournal(config, 'INC0012345', { kind: 'trap', text: 'La remise est en euros.' });
    await addAttempt(config, 'INC0012345', { approach: 'Recalculer', conditions: 'USD', result: 'échec', next: '' });
    await setTicketState(config, 'INC0012345', { dimension: 'pr', status: 'review', detail: '' }, 'person');
    const sheet = await ticketSheet(config, 'INC0012345', 'person');
    expect(sheet.tracker).toBe('servicenow');
    expect(sheet.story.shape).toBe('timeline');
    const { tickets } = await invoke('tickets.list', {}, { config, env: process.env, actor: 'person' }) as { tickets: { ref: string; tracker: string; mission: string; pr: string }[] };
    expect(tickets[0]).toMatchObject({ ref: 'INC0012345', tracker: 'servicenow', mission: 'Le client ne voit plus ses remises.', pr: 'review' });
  });
});
