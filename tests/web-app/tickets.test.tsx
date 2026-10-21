// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketSheet, TicketView } from '../../web-app/src/app/tickets.js';
import Tickets from '../../web-app/src/pages/Tickets.js';
import { NotesToRecheck } from '../../web-app/src/ui/NotesToRecheck.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(): TicketView {
  return {
    ticket: { ref: 'ABC-42', title: 'Rejouer sans doublon', status: 'active', repos: [{ id: 'api', branch: 'ABC-42' }], journal: [], startedAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-11T10:00:00Z' },
    brief: { goal: 'Conserver un seul effet', lastAction: 'Ajout du test de retry', next: 'Vérifier la durée de conservation', failed: [{ id: 'attempt-1', approach: 'Une clé en mémoire', conditions: 'Deux instances', result: 'Effet répété', next: 'Stocker en base', at: '2026-10-10T12:00:00Z' }] },
    detail: { goal: '', lastAction: '', next: '', attempts: [{ id: 'attempt-1', approach: 'Une clé en mémoire', conditions: 'Deux instances', result: 'Effet répété', next: 'Stocker en base', at: '2026-10-10T12:00:00Z' }], states: [
      { dimension: 'work', environment: null, status: 'in-progress', source: 'person', detail: '', url: null, at: '2026-10-11T10:00:00Z' },
      { dimension: 'pr', environment: null, status: 'merged', source: 'github', detail: '', url: 'https://github.com/acme/api/pull/42', at: '2026-10-11T10:00:00Z' },
      { dimension: 'checks', environment: null, status: 'unknown', source: 'person', detail: '', url: null, at: null },
      { dimension: 'waiting', environment: null, status: 'unknown', source: 'person', detail: '', url: null, at: null },
      { dimension: 'delivery', environment: 'production', status: 'unknown', source: 'person', detail: '', url: null, at: null },
    ], criteria: [{ id: 'tests', kind: 'tests', text: 'tests', required: true, status: 'pending', at: '2026-10-11T10:00:00Z' }], reuses: [], external: null, close: { allowed: false, missing: ['tests'] } },
  };
}
/** The sheet of the same ticket (D70): what the page reads first. */
function sheetOf(view: TicketView): TicketSheet {
  const at = '2026-10-11T10:00:00Z';
  return {
    ref: view.ticket.ref, followed: true, status: view.ticket.status, title: { field: 'title', value: view.ticket.title, origin: 'person', url: null, at, manual: true },
    fields: { title: { field: 'title', value: view.ticket.title, origin: 'person', url: null, at, manual: true }, summary: { field: 'summary', value: view.brief.goal, origin: 'agent', url: null, at, manual: false }, done: { field: 'done', value: view.brief.lastAction, origin: 'agent', url: null, at, manual: false } },
    notApplicable: {}, conflicts: [],
    next: { id: 'A-000001', text: view.brief.next, status: 'open', importance: 'medium', pinned: true, source: 'person', createdAt: at, doneAt: null, workRef: view.ticket.ref }, todos: [],
    completeness: { percent: 60, present: [], missing: ['criteria'], notApplicable: [] },
    journey: [{ id: 'understood', state: 'wait', label: '60', source: null, at: null }, { id: 'work', state: 'now', label: 'in-progress', source: 'person', at }, { id: 'pr', state: 'done', label: 'merged', source: 'github', at }, { id: 'checks', state: 'unknown', label: 'unknown', source: null, at: null }, { id: 'delivery', state: 'unknown', label: 'unknown', source: null, at: null }],
    links: [], requests: [], criteria: view.detail.criteria, states: view.detail.states, attempts: view.detail.attempts, external: null, repos: view.ticket.repos, pinned: false, history: [], close: view.detail.close,
  };
}
function mount(list = false) {
  let view = fixture(); let permission = { enabled: false, host: 'github.com', repositories: [] as string[] };
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!; const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; calls.push({ url: u, body });
    if (body && u === '/api/ticket/criterion') { view = { ...view, detail: { ...view.detail, criteria: [{ ...view.detail.criteria[0]!, status: body.status as 'met' }], close: { allowed: true, missing: [] } } }; }
    if (body && u === '/api/ticket/close') view = { ...view, ticket: { ...view.ticket, status: 'done' } };
    if (body && u === '/api/ticket/github/config') permission = { enabled: true, host: 'github.com', repositories: body.repositories as string[] };
    const result = u === '/api/ticket/sheet' ? sheetOf(view) : u === '/api/projects' ? { projects: [] } : u === '/api/tickets' ? { tickets: [view.ticket] } : u === '/api/repos' ? { repos: [{ id: 'api', name: 'API' }] } : u === '/api/ticket/github/config' ? permission : view;
    return new Response(JSON.stringify(result));
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tickets route={list ? { name: 'tickets' } : { name: 'tickets', ref: 'ABC-42' }} /></QueryClientProvider>);
  return calls;
}
describe('developer daily ticket follow-up (F2.4)', () => {
  it('resumes the goal, last action, conditions of failed attempts and next step while merge leaves delivery unknown', async () => {
    const calls = mount(); await screen.findByRole('heading', { name: 'En 30 secondes' });
    expect(screen.getAllByText('Ajout du test de retry')[0]).toBeTruthy(); expect(screen.getAllByText('Vérifier la durée de conservation')[0]).toBeTruthy();
    expect((await screen.findAllByText('Deux instances'))[0]).toBeTruthy();
    expect(screen.getByRole('button', { name: /^PR et revue : Fusionnée/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Livraison : Inconnu/ })).toBeTruthy();
    expect(calls.some((c) => c.body || c.url === '/api/ticket/github')).toBe(false);
  });
  it('requires an explicit satisfied or waived exit criterion and closing confirmation', async () => {
    const calls = mount(); const close = await screen.findByRole('button', { name: 'Clôturer le travail' });
    expect(close.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Modifier le critère'));
    fireEvent.change(screen.getByLabelText('État du critère : Tests'), { target: { value: 'met' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le critère' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clôturer le travail' }).hasAttribute('disabled')).toBe(false));
    expect(calls.some((c) => c.url.endsWith('/close'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clôturer le travail' }));
    expect(calls.some((c) => c.url.endsWith('/close'))).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la clôture' }));
    await screen.findByText('Travail clôturé.');
    expect(calls.find((c) => c.url.endsWith('/criterion'))?.body).toMatchObject({ ref: 'ABC-42', id: 'tests', status: 'met', required: true });
    expect(calls.find((c) => c.url.endsWith('/close'))?.body).toMatchObject({ ref: 'ABC-42' });
  });
  it('keeps attempt conditions and reuse only from their submitted human forms', async () => {
    const calls = mount(); await screen.findByRole('heading', { name: 'En 30 secondes' });
    fireEvent.click(await screen.findByText('Garder une tentative et ses conditions'));
    fireEvent.change(screen.getByLabelText('Piste essayée'), { target: { value: 'Verrou distribué' } });
    fireEvent.change(screen.getByLabelText('Conditions de cette tentative'), { target: { value: 'Deux pods après timeout' } });
    fireEvent.change(screen.getByLabelText('Résultat observé'), { target: { value: 'Le verrou expirait trop tôt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Garder cette tentative' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/attempt'))?.body).toMatchObject({ approach: 'Verrou distribué', conditions: 'Deux pods après timeout', result: 'Le verrou expirait trop tôt' }));
    fireEvent.click(screen.getByText('Marquer qu’une note a aidé'));
    fireEvent.change(screen.getByLabelText('Chemin de la note utilisée'), { target: { value: 'Concepts/Retry.md' } });
    fireEvent.change(screen.getByLabelText('Comment cette note m’a aidé'), { target: { value: 'Même identifiant sur tous les retries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer cette réutilisation' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/reuse'))?.body).toMatchObject({ path: 'Concepts/Retry.md', why: 'Même identifiant sur tous les retries' }));
  });
  it('declares delivery in its own environment without changing PR or checks', async () => {
    const calls = mount(); await screen.findByRole('heading', { name: 'En 30 secondes' });
    fireEvent.click(screen.getByRole('button', { name: /^Livraison : Inconnu/ }));
    const editor = (await screen.findByRole('heading', { name: 'Déclarer : Livraison' })).closest('section')!;
    fireEvent.change(within(editor).getByLabelText('Environnement de livraison'), { target: { value: 'recette' } });
    fireEvent.change(within(editor).getByLabelText('Nouvel état déclaré'), { target: { value: 'verified' } });
    fireEvent.change(within(editor).getByLabelText('Ce qui confirme cet état'), { target: { value: 'Recette de Sam du 11 octobre' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Enregistrer cet état' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/state'))?.body).toMatchObject({ ref: 'ABC-42', dimension: 'delivery', environment: 'recette', status: 'verified', detail: 'Recette de Sam du 11 octobre' }));
    expect(calls.filter((c) => c.body)).toHaveLength(1);
  });
  it('keeps Jira as a dated person-provided observation and never contacts it', async () => {
    const calls = mount(); await screen.findByRole('heading', { name: 'En 30 secondes' });
    fireEvent.click(await screen.findByText('Déclarer un état Jira observé'));
    fireEvent.change(screen.getByLabelText('État Jira que j’ai observé'), { target: { value: 'Ready for QA' } });
    fireEvent.change(screen.getByLabelText('Lien du ticket Jira'), { target: { value: 'https://jira.example/browse/ABC-42' } });
    fireEvent.change(screen.getByLabelText('Date de cette observation'), { target: { value: '2026-10-11T12:30' } });
    expect(calls.some((c) => c.body)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Garder cette observation Jira' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/jira'))?.body).toMatchObject({ ref: 'ABC-42', issue: 'ABC-42', status: 'Ready for QA', url: 'https://jira.example/browse/ABC-42', observedAt: new Date('2026-10-11T12:30').toISOString() }));
    expect(calls.every((c) => c.url.startsWith('/api/'))).toBe(true);
  });
  it('does not read GitHub before a consented repository and an explicit PR read', async () => {
    const calls = mount(); await screen.findByRole('heading', { name: 'En 30 secondes' });
    fireEvent.click(await screen.findByText('Lire une PR GitHub'));
    fireEvent.change(screen.getByLabelText('Dépôt GitHub'), { target: { value: 'acme/api' } });
    fireEvent.change(screen.getByLabelText('Numéro de PR'), { target: { value: '42' } });
    expect(screen.getByRole('button', { name: 'Lire cette PR maintenant' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Autoriser les dépôts GitHub'));
    fireEvent.change(screen.getByLabelText('Liste complète des dépôts autorisés (un par ligne)'), { target: { value: 'acme/api' } });
    expect(screen.getByRole('button', { name: 'Enregistrer cette autorisation' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('J’autorise OKB à lire les PR de ces dépôts avec ma session GitHub.'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer cette autorisation' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lire cette PR maintenant' }).hasAttribute('disabled')).toBe(false));
    expect(calls.some((c) => c.url === '/api/ticket/github')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Lire cette PR maintenant' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/ticket/github')?.body).toMatchObject({ ref: 'ABC-42', repository: 'acme/api', number: 42 }));
  });
  it('starts follow-up only for the chosen registered repository on submit', async () => {
    const calls = mount(true); await screen.findByText('Mes tickets');
    fireEvent.click(screen.getByRole('button', { name: 'Suivre un ticket' }));
    await screen.findByRole('option', { name: 'API' });
    fireEvent.change(screen.getByLabelText('Référence ou nom du ticket'), { target: { value: 'ABC-43' } });
    fireEvent.change(screen.getByLabelText('Dépôt concerné'), { target: { value: 'api' } });
    expect(calls.some((c) => c.body)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Suivre ce ticket' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/tickets/start')?.body).toMatchObject({ ref: 'ABC-43', repo: 'api' }));
  });
  it('reports changed cited code without claiming the note is wrong and keeps unavailable rechecks visible', () => {
    render(<NotesToRecheck notes={[{ path: 'Repos/API.md', title: 'API', scope: 'Atlas', verdict: 'changed', files: ['src/retry.ts'], at: '2026-10-11T10:00:00Z', next: 'okb repo update api' }]} unavailable={['Repo inaccessible']} />);
    expect(screen.getByRole('link', { name: 'API' }).getAttribute('href')).toBe('#/note/Repos%2FAPI.md');
    expect(screen.getByText(/son texte peut encore être juste/)).toBeTruthy();
    expect(screen.getByText('src/retry.ts')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('La fraîcheur de ces notes reste inconnue.');
  });
});
