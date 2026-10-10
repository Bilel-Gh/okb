// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkipLink } from '../../web-app/src/app/Shell.js';
import { Review } from '../../web-app/src/pages/Learn.js';
import { Waiting } from '../../web-app/src/pages/Today.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const card = (id: string, front: string) => ({ id, front, back: `${front} : réponse`, path: `c/${id}.md`, title: front, subject: 'Sujet', level: 'new' });
const learn = (cards: ReturnType<typeof card>[]) => ({ due: cards, fresh: [], counts: { cards: 10, due: cards.length, newLeft: 0 }, map: [] });

describe('the defects of the 9 October review, in the web app', () => {
  it('F2.0-41: a list of proposals that failed to load shows an error, not « nothing waits for you »', async () => {
    const qc = client();
    qc.setQueryData(['suggestions'], { suggestions: [] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/proposals')
      ? new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ suggestions: [] }), { headers: { 'content-type': 'application/json' } }))));
    render(<QueryClientProvider client={qc}><Waiting /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('app.waiting.emptyTitle')).toBeNull();
  });

  it('F2.0-39: two key presses while the grade is on its way grade the card once', async () => {
    const qc = client();
    qc.setQueryData(['learn'], learn([card('a', 'Alpha'), card('b', 'Bravo')]));
    qc.setQueryData(['progress'], { show: false });
    let release: () => void = () => undefined;
    const fetch = vi.fn((url: string) => (String(url).includes('/api/learn/grade')
      ? new Promise<Response>((ok) => { release = () => ok(new Response(JSON.stringify({ ok: true, level: 'learning' }), { headers: { 'content-type': 'application/json' } })); })
      : Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))));
    vi.stubGlobal('fetch', fetch);
    render(<QueryClientProvider client={qc}><Review /></QueryClientProvider>);
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    act(() => { fireEvent.keyDown(window, { key: '3' }); fireEvent.keyDown(window, { key: '3' }); });
    await act(async () => { release(); await Promise.resolve(); });
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/learn/grade'))).toHaveLength(1);
  });

  it('F2.0-39: a new page of due cards starts from its first card, not at « done »', async () => {
    const qc = client();
    qc.setQueryData(['learn'], learn([card('a', 'Alpha')]));
    qc.setQueryData(['progress'], { show: false });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/api/learn/grade') ? { ok: true, level: 'learning' } : learn([card('c', 'Charlie')])), { headers: { 'content-type': 'application/json' } })));
    render(<QueryClientProvider client={qc}><Review /></QueryClientProvider>);
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    await act(async () => { fireEvent.keyDown(window, { key: '3' }); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Charlie' })).toBeTruthy());
  });

  it('F2.0-42: « skip to content » moves the focus to the page and leaves the address alone', () => {
    window.location.hash = '#/brain';
    render(<><SkipLink label="Aller au contenu" /><main id="main" tabIndex={-1}>Contenu</main></>);
    const link = screen.getByText('Aller au contenu');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('main');
    expect(window.location.hash).toBe('#/brain');
  });
});
