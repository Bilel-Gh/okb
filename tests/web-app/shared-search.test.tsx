// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Palette } from '../../web-app/src/app/Palette.js';
import type { Appearance } from '../../web-app/src/app/Shell.js';
import Ask from '../../web-app/src/pages/Ask.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

const appearance: Appearance = { look: 'atelier', mode: 'light', rail: 'expanded', logo: 'linked', style: 'gradient', setLook: vi.fn(), setMode: vi.fn(), setLogo: vi.fn(), setStyle: vi.fn(), toggleRail: vi.fn() };
const shared = { drawer: 'sam', by: 'Sam', path: 'concepts/Cache.md', title: 'Cache du service', snippet: 'Le cache expire au bout de dix minutes.', score: 5 };

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('shared notes in search and answers (F2.1-04)', () => {
  it('shows zero present usage for a cached answer instead of rounding it up to a thousand tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { ok: true, answer: 'Réponse en cache [1].', tokens: 0, estimated: false, used: [1] } : { question: 'cache', passages: [{ n: 1, path: 'Mine.md', title: 'Ma note', text: 'Mon passage.', line: 1 }], notes: [] }))));
    mount(<Ask route={{ name: 'ask', q: 'cache' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'app.ask.write' }));
    await screen.findByText('0 tokens');
    expect(screen.queryByText(/1k tokens/)).toBeNull();
  });
  it('distinguishes an unavailable shared repository from no matches while keeping personal passages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ question: 'cache', passages: [{ n: 1, path: 'Mine.md', title: 'Ma note', text: 'Mon passage reste disponible.', line: 1 }], notes: [], sharedIssue: { code: 'E_IO', message: 'La copie commune est inaccessible.' } }))));
    mount(<Ask route={{ name: 'ask', q: 'cache' }} />);
    await screen.findByText('Mon passage reste disponible.');
    expect(screen.getByText(/La copie commune est inaccessible/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vérifier le dépôt commun' }).getAttribute('href')).toBe('#/sharing');
  });
  it('finds a colleague’s note when no personal note matches, with attribution and its own address', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const result = String(url).includes('/api/find') ? { hits: [], shared: [shared] } : String(url).includes('/api/categories') ? { categories: [] } : { notes: [] };
      return new Response(JSON.stringify(result));
    }));
    const close = vi.fn();
    mount(<Palette open onOpenChange={close} appearance={appearance} devOn />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cache' } });
    const option = await screen.findByRole('option', { name: /Cache du service.*Partagée par Sam/ });
    expect(screen.queryByText('app.search.none')).toBeNull();
    fireEvent.click(option);
    expect(close).toHaveBeenCalledWith(false);
    expect(window.location.hash).toBe('#/shared/sam/concepts%2FCache.md');
  });

  it('keeps an answer’s citation snapshot and attributes passages from a colleague', async () => {
    const old = { n: 1, path: shared.path, title: 'Ancien titre', text: 'Texte au moment de la recherche.', line: 1, shared: { drawer: 'sam', by: 'Sam' } };
    const current = { ...old, title: 'Titre de la source au moment de la réponse', text: 'Texte exact cité par cette réponse.' };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { ok: true, answer: 'Réponse [1].', tokens: 100, used: [1], passages: [current] } : { question: 'cache', passages: [old], notes: [] }))));
    mount(<Ask route={{ name: 'ask', q: 'cache' }} />);
    await screen.findByText('Texte au moment de la recherche.');
    fireEvent.click(screen.getByRole('button', { name: 'app.ask.write' }));
    const link = await screen.findByRole('link', { name: current.title });
    expect(link.getAttribute('href')).toBe('#/shared/sam/concepts%2FCache.md');
    await waitFor(() => expect(screen.queryByText(old.text)).toBeNull());
    expect(screen.getByText(/Partagée par Sam/)).toBeTruthy();
    expect(screen.getByText(current.text)).toBeTruthy();
  });
});
