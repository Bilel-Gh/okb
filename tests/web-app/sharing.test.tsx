// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../web-app/src/app/api.js';
import Sharing from '../../web-app/src/pages/Sharing.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSession({ token: '', ui: 'fr', version: '2.1', active: null, outdated: false, kbs: [] }, null); });

const ready = { ready: true, folder: '/shared/team', drawer: 'alex', allowedAt: '2026-10-11T10:00:00Z', git: true, remote: 'https://github.com/example/knowledge.git', marked: ['2 Produits/Atlas'], leaving: 1, held: [], drawers: [{ drawer: 'sam', name: 'Sam', person: 'p-sam', notes: 1, updatedAt: '2026-10-11T10:00:00Z', mine: false }] };
const preview = { previewHash: 'reviewed-hash', leaving: [{ path: '2 Produits/Atlas/API.md', title: 'API Atlas', markdown: 'Le contenu exact qui sera partagé.' }], held: [{ path: '2 Produits/Atlas/Secret.md', title: 'Note protégée', reason: 'secret' }], removed: [{ path: 'Ancienne.md', title: 'Ancienne note' }] };

function mount(options: { configured?: boolean; baggage?: boolean; stale?: boolean; note?: boolean } = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  setSession({ token: 'test', ui: 'fr', version: '2.1', active: 'demo', outdated: false, kbs: [{ id: 'demo', name: 'Demo', root: '/fake/notes', active: true, writingLanguage: 'fr', exists: true, kind: 'subject', brain: null, space: options.baggage ? 'baggage' : 'work' }] }, 'demo');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: u, method, body });
    if (u === '/api/share/send' && options.stale) return new Response(JSON.stringify({ title: 'Aperçu périmé', message: 'Les notes ont changé.', key: 'sharePreviewChanged' }), { status: 409 });
    const result = u === '/api/share' ? options.configured === false ? { ready: false } : ready
      : u === '/api/share/preview' ? preview
      : u === '/api/notes' ? { notes: [{ path: '2 Produits/Atlas/API.md', title: 'API Atlas', type: 'concept', category: 'concept', status: 'stable' }] }
      : u === '/api/projects' ? { projects: [{ id: 'P-atlas', title: 'Atlas', folder: '2 Produits/Atlas' }] }
      : u === '/api/shared/note' ? { drawer: 'sam', by: 'Sam', path: 'Concept.md', title: 'Un concept de Sam', description: '', markdown: 'Texte de Sam', html: '<p>Texte de Sam</p><a href="#/note/2%20Produits%2FAtlas%2FAPI.md">Autre note de Sam</a>' }
      : u === '/api/shared/keep' ? { proposal: 'proposal-from-sam', target: 'Concept.md', title: 'Un concept de Sam', by: 'Sam' }
      : u === '/api/share/send' ? { written: 1, removed: 1, kept: 0, held: 1, unknown: [], committed: body?.push === true, pushed: body?.push === true }
      : { ok: true, marked: ready.marked, changed: true };
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Sharing route={options.note ? { name: 'sharing', drawer: 'sam', note: 'Concept.md' } : { name: 'sharing' }} /></QueryClientProvider>);
  return calls;
}

describe('sharing through drawers (F2.1-01…09)', () => {
  it('requires the company-location confirmation and never sets up on its own', async () => {
    const calls = mount({ configured: false });
    fireEvent.change(await screen.findByLabelText('Copie locale du dépôt commun'), { target: { value: '/shared/team' } });
    fireEvent.change(screen.getByLabelText('Mon tiroir'), { target: { value: 'Alex' } });
    expect(screen.getByRole('button', { name: 'Relier ce dépôt' }).hasAttribute('disabled')).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByLabelText(/Cet emplacement est autorisé/));
    fireEvent.click(screen.getByRole('button', { name: 'Relier ce dépôt' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/share/setup')?.body).toMatchObject({ folder: '/shared/team', drawer: 'Alex', allowed: true }));
  });

  it('shows content, protected notes and removals before a deliberate local preparation', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Voir ce qui sera partagé' }));
    await screen.findByText('Le contenu exact qui sera partagé.');
    expect(screen.getByText('Note protégée')).toBeTruthy();
    expect(screen.getByText('Ancienne note')).toBeTruthy();
    const prepare = screen.getByRole('button', { name: 'Préparer dans la copie locale' });
    expect(prepare.hasAttribute('disabled')).toBe(true);
    expect(calls.some((c) => c.url === '/api/share/send')).toBe(false);
    fireEvent.click(screen.getByLabelText(/J’ai relu cet aperçu/));
    fireEvent.click(prepare);
    await waitFor(() => expect(calls.find((c) => c.url === '/api/share/send')?.body).toMatchObject({ push: false, previewHash: 'reviewed-hash' }));
    expect(calls.filter((c) => c.url === '/api/share/send')).toHaveLength(1);
  });

  it('only pushes after the distinct explicit button and passes the reviewed snapshot', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Voir ce qui sera partagé' }));
    await screen.findByText('Le contenu exact qui sera partagé.');
    fireEvent.click(screen.getByLabelText(/J’ai relu cet aperçu/));
    fireEvent.click(screen.getByRole('button', { name: 'Préparer et envoyer au dépôt commun' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/share/send')?.body).toMatchObject({ push: true, previewHash: 'reviewed-hash' }));
  });

  it('withdraws stale approval and asks for a fresh preview after notes change', async () => {
    mount({ stale: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Voir ce qui sera partagé' }));
    await screen.findByText('Le contenu exact qui sera partagé.');
    fireEvent.click(screen.getByLabelText(/J’ai relu cet aperçu/));
    fireEvent.click(screen.getByRole('button', { name: 'Préparer dans la copie locale' }));
    await screen.findByText('Les notes ont changé.');
    expect(screen.queryByLabelText(/J’ai relu cet aperçu/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Préparer et envoyer au dépôt commun' })).toBeNull();
  });

  it('keeps baggage out of all sharing screens and requests', async () => {
    const calls = mount({ baggage: true });
    await screen.findByText('Mon bagage reste personnel');
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Voir ce qui sera partagé' })).toBeNull();
  });

  it('attributes a colleague’s note and keeps it through a proposal, never approval', async () => {
    const calls = mount({ note: true });
    await screen.findByText('Texte de Sam');
    expect(screen.getByText('Partagée par Sam')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Autre note de Sam' }).getAttribute('href')).toBe('#/shared/sam/2%20Produits%2FAtlas%2FAPI.md');
    fireEvent.click(screen.getByRole('button', { name: 'Garder dans mon cerveau' }));
    await screen.findByRole('link', { name: 'Relire la proposition' });
    expect(calls.find((c) => c.url === '/api/shared/keep')?.body).toMatchObject({ drawer: 'sam', path: 'Concept.md' });
    expect(calls.some((c) => /approve|apply/.test(c.url))).toBe(false);
  });

  it('marks a project without sending any note or copying its personal journal', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Un projet' }));
    await screen.findByRole('option', { name: 'Atlas' });
    fireEvent.change(screen.getByLabelText('À rendre partageable'), { target: { value: '2 Produits/Atlas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme partageable' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/share/mark')?.body).toMatchObject({ paths: ['2 Produits/Atlas'] }));
    expect(calls.some((c) => c.url === '/api/share/send')).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && /entries|journal/.test(c.url))).toBe(false);
  });
});
