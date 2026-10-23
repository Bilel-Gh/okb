// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import { RepoTeam } from '../../web-app/src/pages/RepoTeam.js';
import { FR } from '../../src/i18n/fr.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const empty = { kind: 'repo', subject: 'orders-api', value: null, inherited: null, notApplicable: null, conflicts: [], suggestion: null, request: null };
function mount(team: Record<string, unknown>, product: Record<string, unknown> | null = null) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> }); return new Response(JSON.stringify({ ok: true, id: 'T-abc123' })); }
    if (String(url).includes('/api/team/prompt')) return new Response(JSON.stringify({ prompt: 'Trouve l’équipe responsable du repo orders-api' }));
    return new Response(JSON.stringify(String(url).includes('kind=product') ? product : { ...empty, ...team }));
  }));
  render(<I18n.Provider value={makeT(FR, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RepoTeam repo="orders-api" product={product ? 'Commerce' : null} /></QueryClientProvider></I18n.Provider>);
  return calls;
}

describe('F2.4-19 · the team on a repository page', () => {
  it('is discreet when unknown: one slot to fill it, one to ask the agent', async () => {
    const calls = mount({});
    fireEvent.click(await screen.findByRole('button', { name: 'Équipe · Renseigner' }));
    fireEvent.change(screen.getByLabelText('Équipe responsable'), { target: { value: 'Équipe Commandes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/team')?.body).toMatchObject({ kind: 'repo', subject: 'orders-api', value: 'Équipe Commandes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Demander à l’agent' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/team/ask')?.body).toMatchObject({ kind: 'repo', subject: 'orders-api' }));
  });

  it('shows where the value comes from, and lets the person settle a conflict', async () => {
    const calls = mount({ value: { field: 'team', value: 'Équipe Finance', origin: 'person', url: null, at: '2026-10-12T08:00:00Z', manual: true }, conflicts: [{ field: 'team', value: 'Équipe Paiement', origin: 'servicenow', url: null, at: '2026-10-19T08:00:00Z' }] });
    expect(await screen.findByText('Équipe Finance')).toBeTruthy();
    expect(screen.getByText(/ServiceNow dit : Équipe Paiement/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Prendre celle-ci/ }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/team/conflict')?.body).toMatchObject({ keep: 'servicenow' }));
  });

  it('shows the product’s team as inherited, and the CODEOWNERS suggestion as a suggestion', async () => {
    const calls = mount({ inherited: { product: 'Commerce', value: { field: 'team', value: 'Équipe Commerce', origin: 'wiki', url: null, at: '2026-10-15T08:00:00Z', manual: false } }, suggestion: { value: '@acme/orders-team', origin: 'github', file: 'CODEOWNERS', line: 2 } });
    expect(await screen.findByText('Équipe Commerce')).toBeTruthy();
    expect(screen.getByText('(du produit Commerce)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser @acme/orders-team' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/team')?.body).toMatchObject({ value: '@acme/orders-team' }));
  });

  it('says when the agent was asked, with the prompt to paste', async () => {
    mount({ request: { id: 'T-abc123', kind: 'repo', subject: 'orders-api', fields: ['team'], state: 'pending', createdAt: '2026-10-19T08:00:00Z', closedAt: null, report: null } });
    expect(await screen.findByText(/demandée à l’agent/)).toBeTruthy();
    expect(await screen.findByText(/Trouve l’équipe responsable du repo orders-api/)).toBeTruthy();
  });
});
