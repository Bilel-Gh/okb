// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FR_V1 } from '../../src/i18n/v1.fr.js';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import { ExamPanel } from '../../web-app/src/pages/Exam.js';
import { Translate } from '../../web-app/src/reader/Translate.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(node: React.ReactNode) { render(<I18n.Provider value={makeT(FR_V1, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider></I18n.Provider>); }
describe('provider estimates remain estimates in the UI', () => {
  it('marks the saved exam’s usage as approximate', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ repo: { id: 'api', name: 'API' }, plan: { questions: [], tokens: 0, budget: { spent: 123, daily: 3000 } }, last: { at: '2026-10-11T10:00:00Z', score: null, counts: { right: 0, partial: 0, wrong: 0, ungraded: 0 }, items: [], tokens: 123, estimated: true, history: [] }, custom: [], ai: false })));
    vi.stubGlobal('fetch', fetch); mount(<ExamPanel repo="api" color="var(--accent)" />);
    await screen.findByText(/Examen du.*≈ 123 jetons/);
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it('shows an estimated translation count after its explicit request, without turning cache zero into usage', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { if (init) requests.push(init); return new Response(JSON.stringify(init?.method === 'POST' ? { ok: true, title: 'Retry', html: '<p>Retry</p>', translated: 1, failed: 0, cached: 0, tokens: 123, estimated: true } : { tokens: 500, cached: 0, toTranslate: 1, hash: 'note-hash' })); }));
    mount(<Translate path="Retry.md" source="fr" onShow={vi.fn()} shown={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Traduire' }));
    await screen.findByText('Coût estimé : ≈ 500 tokens.');
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Traduire' }).find((b) => b.classList.contains('primary'))!);
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Coût estimé : ≈ 500 tokens.')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Traduire' }));
    await screen.findByText('Dernière traduction : ≈ 123 tokens · estimation');
  });
});
