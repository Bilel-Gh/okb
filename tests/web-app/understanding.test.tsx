// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Understanding } from '../../web-app/src/reader/Understanding.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reading = { id: 'reading-1', path: 'concepts/retry.md', title: 'Retry', subject: 'Retry', sourceHash: 'source-a', mode: 'simple', level: 'consulted', explanation: 'Un nouvel essai ne doit pas doubler les effets.', example: 'La requête garde son identifiant.', conditions: ['Un identifiant stable'], unclear: ['La durée de conservation'], sources: [{ path: 'concepts/retry.md', title: 'Retry', hash: 'source-a', quote: 'Une opération répétée ne produit pas un second effet.' }], markdown: '# Retry\n\nNouvelle rédaction.', cached: true, tokens: 0, limitations: ['Les notes peuvent être incomplètes.'] };

function mount(estimated = false) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: u, method: init?.method ?? 'GET', body });
    const result = u === '/api/understanding/read' ? { ...reading, ...(estimated ? { cached: false, tokens: 123, estimated: true } : {}), mode: body?.mode === 'auto' ? 'simple' : body?.mode }
      : u === '/api/understanding/keep' ? { id: 'understanding-proposal', status: 'prepared' }
      : u === '/api/understanding/readiness' ? { grade: 'partial', feedback: 'Préciser la durée de conservation.', missing: ['La durée'], sources: reading.sources, limitations: ['Cela vérifie les notes, pas une compétence.'] }
      : u === '/api/projects' ? { projects: [] }
      : { ok: true };
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><Understanding path="concepts/retry.md" /></QueryClientProvider>);
  return calls;
}

describe('understanding a note (F2.2)', () => {
  it('opens without calculating a reading, then shows a sourced cached explanation on request', async () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre' }));
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Lire autrement' }));
    await screen.findByText(reading.explanation);
    expect(screen.getByText(reading.sources[0]!.quote)).toBeTruthy();
    expect(screen.getByText('Lecture gardée en cache')).toBeTruthy();
    expect(calls.find((x) => x.url === '/api/understanding/read')?.body).toMatchObject({ path: reading.path, mode: 'auto' });
  });

  it('previews the revised wording and only prepares a proposal after a separate keep gesture', async () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lire autrement' }));
    await screen.findByText(reading.explanation);
    expect(screen.getByText((_text, el) => el?.tagName === 'PRE' && el.textContent === reading.markdown)).toBeTruthy();
    expect(calls.some((x) => x.url.endsWith('/keep'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Garder cette version' }));
    const link = await screen.findByRole('link', { name: 'Relire la proposition' });
    expect(link.getAttribute('href')).toBe('#/review/understanding-proposal');
    expect(calls.find((x) => x.url.endsWith('/keep'))?.body).toMatchObject({ readingId: 'reading-1' });
    expect(calls.some((x) => /approve|apply/.test(x.url))).toBe(false);
  });
  it('marks an estimated provider count instead of calling it exact consumption', async () => {
    mount(true);
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lire autrement' }));
    await screen.findByText('≈ 123 tokens · estimation');
    expect(screen.queryByText(/Tokens consommés/)).toBeNull();
  });

  it('requires the person’s explanation to record a higher level and keeps the act explicit', async () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre' }));
    fireEvent.change(screen.getByLabelText('Geste réalisé'), { target: { value: 'explained' } });
    const save = screen.getByRole('button', { name: 'Enregistrer ce geste' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Ce que j’ai fait'), { target: { value: 'J’ai expliqué les doubles effets avec un exemple.' } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((x) => x.url.endsWith('/record'))?.body).toMatchObject({ path: reading.path, kind: 'explained', point: 'J’ai expliqué les doubles effets avec un exemple.', eventId: expect.any(String) }));
    expect(calls.filter((x) => x.url.endsWith('/record'))).toHaveLength(1);
  });

  it('checks the person’s own words without marking them as explained or resolved', async () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lire autrement' }));
    await screen.findByText(reading.explanation);
    fireEvent.click(screen.getByRole('button', { name: 'Vérifie ma compréhension' }));
    fireEvent.change(screen.getByLabelText('Avec mes mots'), { target: { value: 'Un nouvel essai garde le même identifiant.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avec mes notes' }));
    await screen.findByText('Préciser la durée de conservation.');
    expect(calls.find((x) => x.url.endsWith('/readiness'))?.body).toMatchObject({ path: reading.path, answer: 'Un nouvel essai garde le même identifiant.' });
    expect(calls.some((x) => x.url.endsWith('/record'))).toBe(false);
  });
});
