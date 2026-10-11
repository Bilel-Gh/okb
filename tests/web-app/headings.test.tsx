// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../../web-app/src/app/Shell.js';
import { Reader, type NoteView } from '../../web-app/src/reader/Reader.js';
import { Prose } from '../../web-app/src/reader/Prose.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('one page heading with Markdown nested below it (F3.0-07)', () => {
  it('uses the reader title as the single h1 after loading, preserving source heading anchors and restoring the shell title on leaving', async () => {
    const note: NoteView = { path: 'Retry.md', title: 'Retry', type: 'concept', status: 'stable', description: '', category: 'concept', confidentiality: 'public', sources: 0, crumbs: [], terms: [], score: null, backlinks: [], outlinks: [], html: '<h1 id="user-content-title">Retry</h1><p>Premier paragraphe.</p><h1 id="user-content-rappel" class="source-title"><strong>Rappel utile</strong></h1><h2 id="conditions">Conditions</h2><h3>Détails</h3><p><a href="#user-content-rappel">Revenir au rappel</a></p>' };
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/note?') ? new Promise<Response>((resolve) => { finish = resolve; }) : new Response(JSON.stringify({ nodes: [], edges: [], categories: [] }))));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['status'], { name: 'Démo', notes: 1, concepts: 1 });
    qc.setQueryData(['suggestions'], { suggestions: [] });
    qc.setQueryData(['modules'], { modules: [] });
    qc.setQueryData(['categories'], { categories: [] });
    const mount = (child: React.ReactNode) => <QueryClientProvider client={qc}><Shell route={{ name: 'brain', path: 'Retry.md' }} title="Mémoire">{child}</Shell></QueryClientProvider>;
    const view = render(mount(<Reader path="Retry.md" setTitle={vi.fn()} />));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mémoire');
    finish?.(new Response(JSON.stringify(note)));
    await screen.findByRole('heading', { level: 1, name: 'Retry' });
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
    expect(document.querySelector('.topbar-title')?.tagName).toBe('P');
    const source = screen.getByRole('heading', { level: 2, name: 'Rappel utile' });
    expect(source.id).toBe('user-content-rappel'); expect(source.className).toBe('source-title'); expect(source.querySelector('strong')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Conditions' }).id).toBe('conditions');
    expect(document.getElementById('user-content-title')).toBeTruthy();
    source.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('link', { name: 'Revenir au rappel' }));
    expect(source.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    view.rerender(mount(<p>Une autre page</p>));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mémoire'));
  });
  it('normalizes source h1 in a Prose preview while keeping the parent page heading and source ids', () => {
    render(<><h1>Projet</h1><Prose html={'<h1 id="rappel">Rappel</h1><h2 id="suite">Suite</h2>'} /></>);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Rappel' }).id).toBe('rappel');
    expect(screen.getByRole('heading', { level: 2, name: 'Suite' }).id).toBe('suite');
  });
  it('keeps the topbar heading when the overview is hidden, as in the mobile or table explorer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ modules: [], suggestions: [], name: 'Demo', notes: 1, concepts: 0 }))));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const content = (visible: boolean) => <QueryClientProvider client={qc}><Shell route={{ name: 'brain' }} title="Mémoire"><section style={{ display: visible ? 'block' : 'none' }}><h1>Vue d’ensemble</h1></section></Shell></QueryClientProvider>;
    const view = render(content(false));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mémoire');
    view.rerender(content(true));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Vue d’ensemble');
    expect(document.querySelector('.topbar-title')?.tagName).toBe('P');
  });
});
