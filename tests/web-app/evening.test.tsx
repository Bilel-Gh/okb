// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Evening } from '../../web-app/src/pages/Evening.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const VIEW = {
  cards: [{ id: 'S-aaaaaa', title: 'Idempotence', type: 'concept', where: 'Démo › Concepts', why: 'tu as demandé ce que c’est', tokens: 4000 }, { id: 'S-bbbbbb', title: 'Percentile', type: 'concept', where: 'Démo › Concepts', why: 'tu as demandé ce que c’est', tokens: 4000 }],
  changes: [{ id: 'p-1', title: 'Rejouer chaque appel', files: 1, created: 1, updated: 0 }],
  apart: [{ id: 'p-9', title: 'Un changement refusé par une règle', reason: 'outside the KB' }],
  tokens: 8000, budget: { daily: 50000, spent: 0 },
};

function mount(view: unknown = VIEW, answer: unknown = { presence: 'confirmed', changes: [{ id: 'p-1', ok: true }], cards: [{ id: 'S-aaaaaa', ok: true }] }) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    return new Response(JSON.stringify(u.startsWith('/api/evening/yes') ? answer : view), { headers: { 'content-type': 'application/json' } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Evening /></QueryClientProvider>);
  return calls;
}

describe('the evening screen: « oui à tout, sauf… » (F2.0-13)', () => {
  it('shows everything that waits, ticked, with what the notes will cost', async () => {
    mount();
    const boxes = (await screen.findAllByRole('checkbox')) as HTMLInputElement[];
    expect(boxes.map((b) => [b.getAttribute('aria-label'), b.checked])).toEqual([['Rejouer chaque appel', true], ['Idempotence', true], ['Percentile', true]]);
    expect(screen.getByRole('button', { name: 'app.evening.yes.other' })).toBeTruthy();
    expect(screen.getByText('app.evening.cost')).toBeTruthy();
    // A change a rule refuses is not in the lot: it is shown apart, to read on its own.
    expect(screen.getByRole('link', { name: 'Un changement refusé par une règle' }).getAttribute('href')).toBe('#/review/p-9');
  });

  it('says yes to what stays ticked, and only that', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Percentile' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.evening.yes.other' })); });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/evening/yes')).toBe(true));
    expect(calls.find((c) => c.url === '/api/evening/yes')!.body).toMatchObject({ changes: ['p-1'], cards: ['S-aaaaaa'] });
    expect((await screen.findByRole('status')).textContent).toContain('app.evening.done');
  });

  it('says what was not done and why: over the budget, or no way to confirm on this screen', async () => {
    mount(VIEW, { presence: 'unavailable', changes: [{ id: 'p-1', ok: false, key: 'presenceUnavailable' }], cards: [{ id: 'S-aaaaaa', ok: true }, { id: 'S-bbbbbb', ok: false, reason: 'budget' }] });
    await screen.findAllByRole('checkbox');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.evening.yes.other' })); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('app.evening.noPresence');
    expect(alert.textContent).toContain('app.evening.overBudget');
  });

  it('with nothing ticked the button waits, and with nothing waiting the screen says so', async () => {
    mount({ ...VIEW, changes: [], cards: [VIEW.cards[0]], apart: [] });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Idempotence' }));
    expect((screen.getByRole('button', { name: 'app.evening.none' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount({ cards: [], changes: [], apart: [], tokens: 0, budget: { daily: 50000, spent: 0 } });
    expect(await screen.findByText('app.evening.emptyTitle')).toBeTruthy();
  });
});
