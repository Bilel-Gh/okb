// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../web-app/src/app/api.js';
import { Shell } from '../../web-app/src/app/Shell.js';
import type { Route } from '../../web-app/src/app/router.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSession({ token: '', ui: 'fr', version: '', active: null, outdated: false, kbs: [] }, null); });

function mount(route: Route, calls: { url: string; body?: unknown }[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['status'], { name: 'Démo', notes: 12, concepts: 2, toReview: 1 });
  qc.setQueryData(['suggestions'], { suggestions: [{ status: 'pending' }, { status: 'pending' }, { status: 'later' }] });
  qc.setQueryData(['modules'], { modules: [{ id: 'dev', enabled: true }] });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const u = String(url);
    const body = u.includes('/api/suggestions') ? { suggestions: [] } : u.includes('/api/status') ? { name: 'Démo', notes: 12, concepts: 2 }
      : u.includes('/api/actions/detect') ? { action: u.includes('avant') ? { kind: 'todo', text: 'Réserver le car', due: '2027-05-15' } : null } : u.includes('/api/projects') ? { projects: [{ id: 'P-1a2b3c', title: 'Sortie de juin' }] } : { ok: true };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));
  return render(<QueryClientProvider client={qc}><Shell route={route} title="Titre"><p>Page</p></Shell></QueryClientProvider>);
}

describe('the shell of the 2.0 (F2.0-01)', () => {
  it('shows five screens, the current one marked, and its pages as tabs', () => {
    mount({ name: 'graph' });
    const rail = screen.getByRole('navigation', { name: 'app.nav.screens' });
    const links = [...rail.querySelectorAll('a')].map((a) => [a.getAttribute('aria-label'), a.getAttribute('aria-current')]);
    expect(links.slice(0, 5)).toEqual([
      ['app.screen.today', null], ['app.screen.projects', null], ['app.screen.memory', 'page'], ['app.screen.assistant', null], ['app.screen.progress', null],
    ]);
    const tabs = screen.getByRole('navigation', { name: 'app.screen.memory' });
    expect([...tabs.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('aria-current')])).toEqual([['app.memory.notes', null], ['app.memory.graph', 'page'], ['app.memory.documents', null]]);
  });

  it('« À valider » is on every screen, with what waits', () => {
    mount({ name: 'today' });
    const validate = screen.getByRole('link', { name: 'app.nav.inbox, 3' });
    expect(validate.getAttribute('href')).toBe('#/review');
  });

  it('« Garde ça » opens with ⌘J and keeps what the person wrote at once', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    mount({ name: 'today' }, calls);
    act(() => { fireEvent.keyDown(window, { key: 'j', metaKey: true }); });
    const field = await screen.findByPlaceholderText('app.keep.placeholder');
    fireEvent.change(field, { target: { value: 'Le quota passe à 500 lundi' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/capture'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/api/capture'))!.body).toMatchObject({ text: 'Le quota passe à 500 lundi' });
  });

  it('the person picks a space, then one of its brains: Mon bagage first, Travail after', async () => {
    setSession({ token: 't', ui: 'fr', version: '2.0.0', active: 'travail', outdated: false, kbs: [
      { id: 'travail', name: 'Acme', root: '/a', active: true, writingLanguage: 'fr', exists: true, kind: 'topic', brain: 'work', space: 'work' },
      { id: 'bagage', name: 'Mes acquis', root: '/b', active: false, writingLanguage: 'fr', exists: true, kind: 'topic', brain: 'career', space: 'baggage' },
    ] }, 'travail');
    mount({ name: 'today' });
    const button = screen.getByRole('button', { name: /app\.kb\.switch/ });
    expect(button.textContent).toContain('Acme');
    expect(button.textContent).toContain('app.space.work');
    fireEvent.click(button);
    const menu = await screen.findByRole('dialog');
    expect([...menu.querySelectorAll('.menu-heading, [role=menuitemradio]')].map((e) => e.textContent)).toEqual(['app.space.baggage', 'Mes acquis', 'app.space.work', 'Acme']);
  });

  it('« Garde ça » also takes a file, kept as it is in the chosen project', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    mount({ name: 'today' }, calls);
    act(() => { fireEvent.keyDown(window, { key: 'j', metaKey: true }); });
    await screen.findByPlaceholderText('app.keep.placeholder');
    expect(screen.getByRole('button', { name: 'app.keep.file' })).toBeTruthy();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'P-1a2b3c' } });
    const input = document.querySelector('.keep-pop input[type=file]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['480 euros'], 'devis.txt')] } }); });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/documents')).toBe(true));
    expect(calls.find((c) => c.url === '/api/documents')!.body).toMatchObject({ name: 'devis.txt', project: 'P-1a2b3c', data: Buffer.from('480 euros').toString('base64') });
  });

  it('« Garde ça » offers the action it spots, and puts the line in the chosen project’s journal', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    mount({ name: 'today' }, calls);
    act(() => { fireEvent.keyDown(window, { key: 'j', metaKey: true }); });
    const field = await screen.findByPlaceholderText('app.keep.placeholder');
    fireEvent.change(field, { target: { value: 'réserver le car avant le 15 mai' } });
    await screen.findByText('Réserver le car');
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'P-1a2b3c' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/actions') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/api/entries'))!.body).toMatchObject({ text: 'réserver le car avant le 15 mai', project: 'P-1a2b3c' });
    expect(calls.find((c) => c.url.endsWith('/api/actions'))!.body).toMatchObject({ text: 'Réserver le car', kind: 'todo', due: '2027-05-15', project: 'P-1a2b3c' });
    expect(calls.some((c) => c.url.includes('/api/capture'))).toBe(false);
  });
});
