// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Indicators } from '../../web-app/src/pages/Indicators.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DATA = { indicators: [
  { id: 'coverage', value: 80, of: { have: 8, total: 10 }, gaps: [{ id: 'terms-without-card', count: 2, examples: [{ title: 'ZQX' }, { title: 'CDS' }], action: { kind: 'command', to: 'okb suggest concepts --queue' } }] },
  { id: 'freshness', value: null, of: { have: 0, total: 0 }, gaps: [] },
  { id: 'quality', value: 71, of: { have: 40, total: 46 }, gaps: [{ id: 'weak-notes', count: 6, examples: [{ title: 'Brouillon', path: 'Brouillon.md' }], action: { kind: 'note', to: 'Brouillon.md' } }] },
  { id: 'understanding', value: 12, of: { have: 3, total: 25 }, gaps: [{ id: 'never-studied', count: 20, examples: [], action: { kind: 'route', to: 'learn' } }] },
] };

function mount() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { headers: { 'content-type': 'application/json' } })));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Indicators /></QueryClientProvider>);
}

describe('the four indicators on the health page (F2.0-24)', () => {
  it('shows each one apart, with what it is made of; nothing to measure is said, not shown as a figure', async () => {
    mount();
    const coverage = (await screen.findByRole('heading', { name: 'indicator.coverage' })).closest('li')!;
    expect(coverage.textContent).toContain('80');
    expect(coverage.textContent).toContain('indicator.coverage.of');
    const freshness = screen.getByRole('heading', { name: 'indicator.freshness' }).closest('li')!;
    expect(freshness.textContent).toContain('indicator.none');
    expect(freshness.textContent).not.toMatch(/\d/);
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('indicator'))).toHaveLength(4);
  });

  it('each gap leads somewhere: a note to open, a screen to go to, a command to run', async () => {
    mount();
    const quality = (await screen.findByRole('heading', { name: 'indicator.quality' })).closest('li')!;
    expect(within(quality).getByRole('link', { name: /indicator\.gap\.weak-notes/ }).getAttribute('href')).toBe('#/note/Brouillon.md');
    const understanding = screen.getByRole('heading', { name: 'indicator.understanding' }).closest('li')!;
    expect(within(understanding).getByRole('link', { name: /indicator\.gap\.never-studied/ }).getAttribute('href')).toBe('#/learn');
    const coverage = screen.getByRole('heading', { name: 'indicator.coverage' }).closest('li')!;
    expect(coverage.textContent).toContain('okb suggest concepts --queue');
    expect(coverage.textContent).toContain('ZQX');
  });
});
