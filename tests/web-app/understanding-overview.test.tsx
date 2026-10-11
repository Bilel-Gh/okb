// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UnderstandingPage, { UnderstandingProgress } from '../../web-app/src/pages/Understanding.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const overview = { subjects: [{ path: 'Retry.md', subject: 'Retry', level: 'consulted', events: 3, lastAt: '2026-10-11T09:00:00Z', evidence: [] }], graph: { nodes: [{ id: 'Retry.md', title: 'Retry', level: 'consulted' }], edges: [] }, debts: [{ id: 'debt-1', path: 'Retry.md', subject: 'Retry', point: 'Combien de temps conserver la clé ?', reason: 'unclear', encounters: 3, since: '2026-10-10', minutes: 5 }], progress: { enabled: false, private: true, xp: 0, level: { level: 1, from: 0, to: 20 }, counts: { resolved: 0, explained: 0, reused: 0 }, badges: [] }, limitations: ['Les gestes ne certifient pas une compétence.'] };
function mount(progress = false) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: u, method: init?.method ?? 'GET', body });
    const data = u === '/api/understanding/overview' ? { ...overview, today: overview.debts[0] }
      : u === '/api/projects' ? { projects: [{ id: 'project-1', title: 'Imports' }] }
      : u === '/api/understanding/learning' ? { pathways: [], limitations: [] }
      : u === '/api/understanding/meeting' ? { project: { id: 'project-1', title: 'Imports', where: 'Test', next: 'Fixer le délai' }, known: [{ path: 'Retry.md', title: 'Retry', description: 'Un nouvel essai.', sources: [] }], open: [{ id: 'q-1', text: 'Quelle durée ?', kind: 'question', source: 'person' }], questions: [{ text: 'Quelle durée ?', source: { kind: 'action', id: 'q-1' } }], limitations: ['La réunion peut poser d’autres questions.'] }
      : { ok: true };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{progress ? <UnderstandingProgress /> : <UnderstandingPage />}</QueryClientProvider>);
  return calls;
}
describe('personal understanding overview', () => {
  it('links the five-minute debt to an open card without calculating any reading', async () => {
    const calls = mount();
    await screen.findByText('Combien de temps conserver la clé ?');
    expect(screen.getByRole('link', { name: 'Comprendre en 5 minutes' }).getAttribute('href')).toBe('#/note/Retry.md?understand=1');
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
    expect(screen.getByRole('img', { name: 'Carte des sujets par gestes enregistrés' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Retry · Consulté' }).length).toBeGreaterThan(0);
  });
  it('enables private XP only after an explicit choice', async () => {
    const calls = mount(true);
    await screen.findByLabelText('Activer ma progression privée');
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByLabelText('Activer ma progression privée'));
    await waitFor(() => expect(calls.find((x) => x.url.endsWith('/progress'))?.body).toMatchObject({ enabled: true }));
    expect(screen.queryByText(/classement/i)).toBeNull();
  });
  it('prepares a meeting only when asked, and shows recorded questions instead of claiming readiness', async () => {
    const calls = mount();
    await screen.findByRole('option', { name: 'Imports' });
    fireEvent.change(screen.getByLabelText('Projet de la réunion'), { target: { value: 'project-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Préparer ma réunion' }));
    await screen.findByText('Fixer le délai');
    expect(screen.getAllByText('Quelle durée ?')).toHaveLength(2);
    expect(calls.find((x) => x.url.endsWith('/meeting'))?.body).toMatchObject({ projectId: 'project-1' });
    expect(calls.some((x) => x.url.endsWith('/readiness') || x.url.endsWith('/read'))).toBe(false);
  });
});
