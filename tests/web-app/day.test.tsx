// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hrefFor, parseRoute } from '../../web-app/src/app/router.js';
import { screenOf } from '../../web-app/src/app/nav.js';
import DayPage, { looksLikeDay } from '../../web-app/src/pages/Day.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(view: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify(view), { headers: { 'content-type': 'application/json' } }); }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DayPage day="2027-03-02" /></QueryClientProvider>);
  return calls;
}

describe('one day of the journal in the app (F2.0-21)', () => {
  it('has its address, on the Today screen', () => {
    expect(parseRoute('#/day/2027-03-02')).toEqual({ name: 'day', day: '2027-03-02' });
    expect(hrefFor({ name: 'day', day: '2027-03-02' })).toBe('#/day/2027-03-02');
    expect(screenOf({ name: 'day', day: '2027-03-02' })).toBe('today');
  });

  it('shows the lines of that day with their project, and the days around it', async () => {
    const calls = mount({ day: '2027-03-02', previous: '2027-03-01', next: '2027-03-03', entries: [
      { id: 'J-1', projectId: 'P-1', project: { id: 'P-1', title: 'Sortie de juin' }, at: '2027-03-02T16:00:00.000Z', day: '2027-03-02', kind: 'decision', text: 'On part sur le car de 55 places', source: 'person' },
      { id: 'J-2', projectId: null, project: null, at: '2027-03-02T10:00:00.000Z', day: '2027-03-02', kind: 'note', text: 'Devis du transporteur reçu', source: 'person' },
    ] });
    expect(await screen.findByText('On part sur le car de 55 places')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sortie de juin' }).getAttribute('href')).toBe('#/project/P-1');
    expect(screen.getByRole('link', { name: 'app.day.previous' }).getAttribute('href')).toBe('#/day/2027-03-01');
    expect(screen.getByRole('link', { name: 'app.day.next' }).getAttribute('href')).toBe('#/day/2027-03-03');
    expect(calls[0]).toContain('/api/day?day=2027-03-02');
  });

  it('says so when nothing was noted, and today has no day after', async () => {
    mount({ day: '2027-03-02', previous: '2027-03-01', next: null, entries: [] });
    expect(await screen.findByText('app.day.nothing')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'app.day.next' })).toBeNull();
  });

  it('the search knows the words of a day before asking the server', () => {
    for (const q of ['mardi', 'ce que j’ai fait mardi', 'hier', 'yesterday', "aujourd'hui", '2027-03-02', 'le 14 février', '14/02']) expect(looksLikeDay(q), q).toBe(true);
    for (const q of ['cache', 'marché', 'réserver le car', 'mars']) expect(looksLikeDay(q), q).toBe(false);
  });
});
