import { describe, expect, it } from 'vitest';
import { BRIEF_BUDGET, headline, renderBrief, startLine, type Brief } from '../src/work/brief.js';

const base: Brief = {
  workspace: null, kb: { id: 'travail', name: 'Travail', root: '/kb' }, sharedKb: null, via: 'folder',
  repo: { id: 'orders', name: 'orders', path: '/code/orders' }, notes: [], recentTickets: [], shared: [], talksTo: [], calledBy: [],
  ticket: null, repos: [], activeTickets: [], landscape: null, requests: [],
};
const ticket = {
  ref: 'DEMO-4211', title: 'Le panier perd les remises quand on change de devise', status: 'active' as const, auto: false, repos: [], journal: [], textFile: null, note: null,
  resume: { goal: 'garder les remises', lastAction: 'test rouge écrit', next: 'corriger le calcul dans pricing.ts', failed: [] },
  states: [
    { dimension: 'pr' as const, environment: null, status: 'review', source: 'github' as never, at: '2026-11-03T10:00:00Z', detail: '', url: null },
    { dimension: 'waiting' as const, environment: null, status: 'blocked', source: 'person' as never, at: '2026-11-03T10:00:00Z', detail: '', url: null },
  ],
};

describe('the line the person reads first (D76)', () => {
  it('says the ticket, the repository, the PR, the wait and the next step, in the person’s language', () => {
    expect(headline({ ...base, ticket }, 'fr')).toBe('🎫 DEMO-4211 Le panier perd les remises quand on change de d… · 📦 orders · PR en revue · bloqué · ➡️ corriger le calcul dans pricing.ts');
    expect(headline({ ...base, ticket }, 'en')).toContain('PR in review · blocked');
  });
  it('says only what is known', () => {
    expect(headline({ ...base, ticket: { ...ticket, resume: undefined, states: [] } }, 'fr')).toBe('🎫 DEMO-4211 Le panier perd les remises quand on change de d… · 📦 orders');
    expect(headline(base, 'fr')).toBe('📦 orders · 📚 Travail · aucun ticket en cours');
    expect(headline({ ...base, repo: null, workspace: { id: 'acme', name: 'Acme', roots: [] }, repos: [{ id: 'a', name: 'a', notes: 1 }], activeTickets: [{ ref: 'A-1', title: 't', repos: ['a'] }] }, 'fr')).toBe('🗂️ Acme · 1 repo · 1 ticket en cours');
  });
});

describe('a quiet brief (D76)', () => {
  it('opens on the line, offers nothing and announces nothing', () => {
    const text = renderBrief({ ...base, ticket: { ...ticket, status: 'done' as const } }, { presence: 'quiet', lang: 'fr' });
    expect(text).toContain('Start your first answer of this session with this line, as it is, and repeat it only when it changes: 🎫 DEMO-4211');
    expect(text).toContain('never offer an OKB command, a note, a card or a check');
    expect(text).toContain('without announcing them');
    expect(text).not.toMatch(/offer \/okb-dev|announce each|ask first/);
    expect(renderBrief(base, { presence: 'quiet' })).not.toContain('offer /okb-dev:onboard');
    expect(startLine('DEMO-1', 'orders', 'quiet')).toContain('silently');
  });
  it('keeps the 2.4 offers when the person chose them', () => {
    const text = renderBrief({ ...base, ticket: { ...ticket, status: 'done' as const } }, { presence: 'assist' });
    expect(text).toContain('offer /okb-dev:ticket');
    expect(text).toContain('announce each in one line');
    expect(text).not.toContain('Start your first answer');
  });
  it('stays within its budget whatever the ticket’s history', () => {
    const failed = Array.from({ length: 200 }, (_, i) => ({ approach: `essai ${i} `.repeat(20), conditions: 'local', result: 'rouge', next: '' }));
    const notes = Array.from({ length: 40 }, (_, i) => ({ path: `repos/orders/${'n'.repeat(60)}-${i}.md`, title: `Note ${i} `.repeat(8), kind: 'guide' }));
    const text = renderBrief({ ...base, notes, ticket: { ...ticket, resume: { ...ticket.resume, failed } } }, { presence: 'quiet' });
    expect(text.length).toBeLessThanOrEqual(BRIEF_BUDGET);
    expect(text).toContain('okb scope --json');
    expect(text).toContain('OKB works in the background');
    expect(text).toContain('Start your first answer of this session with this line');
    expect(text.match(/Failed approach/g)?.length).toBe(3);
  });
});
