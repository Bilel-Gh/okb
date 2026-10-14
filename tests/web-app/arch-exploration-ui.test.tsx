// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import Arch from '../../web-app/src/pages/Arch.js';
import { FR_V1 } from '../../src/i18n/v1.fr.js';
import { architectureFixture } from '../helpers/arch-visual.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(kind: Parameters<typeof architectureFixture>[0] = 'dense') {
  const fixture = architectureFixture(kind);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/api/repos/arch') ? fixture : { repos: [], unlinked: [] }))));
  render(<I18n.Provider value={makeT(FR_V1, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Arch route={{ name: 'repos', tab: 'architecture' }} /></QueryClientProvider></I18n.Provider>);
  return fixture;
}

describe('architecture can be explored without losing dependencies or proofs', () => {
  it('starts bounded, exposes the hidden groups, and expands all repositories', async () => {
    const fixture = mount();
    await screen.findByLabelText('Repo à explorer');
    const svg = screen.getByRole('group', { name: 'Plan du système Boutique fictive' });
    expect(svg.querySelectorAll('.arch-station').length).toBeLessThanOrEqual(8);
    fireEvent.click(screen.getByRole('button', { name: /Afficher les repos masqués/ }));
    expect(svg.querySelectorAll('.arch-station').length).toBe(fixture.model.nodes.filter((n) => n.kind === 'repo').length);
  });
  it('keeps complete names, uncertainty and both endpoint sources reachable from the relation list', async () => {
    const fixture = mount('uncertain');
    const relations = await screen.findByRole('region', { name: 'Relations' });
    const row = within(relations).getByRole('button', { name: /Boutique en ligne.*Service de gestion.*probable/ });
    fireEvent.click(row);
    expect(screen.getByText('src/client.ts:3')).toBeTruthy();
    expect(screen.getByText('src/route.ts:4')).toBeTruthy();
    const name = fixture.model.nodes[1]!.name;
    expect(screen.getByRole('button', { name: `${name} (orders)` })).toBeTruthy();
    expect(document.querySelector('.arch-map')?.textContent).not.toContain('…');
  });
});
