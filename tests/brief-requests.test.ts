import { describe, expect, it } from 'vitest';
import { renderBrief, type Brief } from '../src/work/brief.js';

const base: Brief = {
  workspace: null, kb: { id: 'travail', name: 'Travail', root: '/kb' }, sharedKb: null, via: 'folder',
  repo: { id: 'orders', name: 'orders', path: '/code/orders' }, notes: [], recentTickets: [], shared: [], talksTo: [], calledBy: [],
  ticket: null, repos: [], activeTickets: [], landscape: null, requests: [],
};

describe('the session brief names the open requests to the agent (F2.4-10)', () => {
  it('lists the open requests of this repository, with how to report', () => {
    const text = renderBrief({ ...base, requests: [{ id: 'R-1a2b3c', ref: 'DEMO-4211', fields: ['team', 'criteria'], since: '2026-10-19T08:00:00Z' }] });
    expect(text).toContain('Open OKB requests: DEMO-4211 (team, criteria) [R-1a2b3c]');
    expect(text).toContain('okb ticket requests close');
    expect(text).toContain('never claim');
  });

  it('says nothing without a request', () => {
    expect(renderBrief(base)).not.toContain('Open OKB requests');
  });
});

describe('the brief without a repository also names the requests', () => {
  it('lists them in the workspace view', () => {
    const text = renderBrief({ ...base, repo: null, requests: [{ id: 'R-1a2b3c', ref: 'DEMO-4211', fields: ['team'], since: '' }] });
    expect(text).toContain('Open OKB requests: DEMO-4211 (team) [R-1a2b3c]');
  });
});

describe('the session brief gives the agent the rule for a ticket’s todos (F2.4-24, D74)', () => {
  const ticket = { ref: 'DEMO-4211', title: 'Le panier perd les remises', status: 'active' as const, auto: false, repos: [], journal: [], textFile: null, note: null };
  it('says how many todos, how to add them, and what it may not touch', () => {
    const text = renderBrief({ ...base, ticket });
    expect(text).toContain('okb action add');
    expect(text).toContain('--ticket DEMO-4211');
    expect(text).toContain('--why');
    expect(text).toContain('at most 3');
    expect(text).toMatch(/never rewrite or remove the person's todos/);
    expect(text).toContain('removed');
  });
  it('says nothing about todos without a ticket', () => {
    expect(renderBrief(base)).not.toContain('okb action add');
  });
});
