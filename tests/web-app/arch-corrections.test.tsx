// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import Arch from '../../web-app/src/pages/Arch.js';
import { FR } from '../../src/i18n/fr.js';
import { architectureFixture } from '../helpers/arch-visual.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The small fixture, with lot D's certainty, reasons and what is kept off the map (F2.4-16..18). */
function landscapeFixture() {
  const base = architectureFixture('small');
  const links = base.model.links.map((l, i) => (i === 0 ? { ...l, confidence: 'probable' as const, certainty: 'supposed' as const, basis: 'le nom OrdersService ressemble à orders' } : { ...l, certainty: 'proved' as const, basis: 'même chemin des deux côtés' }));
  const at = '2026-10-22T10:00:00.000Z';
  const model = {
    ...base.model, links,
    offMap: [
      { repo: 'front', host: 'nexus.acme-corp.test', role: 'registry', evidence: { repo: 'front', file: '.npmrc', line: 1 } },
      { repo: 'orders', host: 'nexus.acme-corp.test', role: 'registry', evidence: { repo: 'orders', file: 'pom.xml', line: 5 } },
      { repo: 'orders', host: 'wiki.acme-corp.test', role: 'doc', evidence: { repo: 'orders', file: 'src/A.java', line: 4 } },
      { repo: 'shipping', host: 'rates.acme-corp.test', role: 'unknown', evidence: { repo: 'shipping', file: 'src/x.ts', line: 9 } },
    ],
    excluded: [{ ...links[1]!, id: 'event:repo:orders>repo:shipping', reason: 'ancien flux', at }],
    stale: [{ key: 'http|repo:gone|repo:orders', action: 'exclude', at }],
    conflicts: [],
  };
  return { ...base, model, views: { ...base.views, containers: { ...base.views.containers, arrows: links } } };
}

function mount() {
  const fixture = landscapeFixture();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(String(url).includes('/api/repos/arch') ? fixture : init?.method === 'POST' ? { ok: true, changed: true } : { repos: [], unlinked: [] }));
  }));
  render(<I18n.Provider value={makeT(FR, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Arch route={{ name: 'repos', tab: 'architecture' }} /></QueryClientProvider></I18n.Provider>);
  return { fixture, calls };
}

describe('F2.4-18 · the map says how sure each link is and lets the person correct it', () => {
  it('shows a supposed link with its reason, and confirms it in one gesture', async () => {
    const { calls } = mount();
    const relations = await screen.findByRole('region', { name: 'Relations' });
    fireEvent.click(within(relations).getByRole('button', { name: /Boutique en ligne.*Service de gestion.*supposée/i }));
    expect(screen.getByText('le nom OrdersService ressemble à orders')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/arch/link/confirm'));
    expect(calls.find((c) => c.url === '/api/arch/link/confirm')!.body.key).toBe('http|repo:front|repo:orders');
  });

  it('excludes a link with a reason, and retargets it', async () => {
    const { calls } = mount();
    const relations = await screen.findByRole('region', { name: 'Relations' });
    fireEvent.click(within(relations).getByRole('button', { name: /Boutique en ligne.*Service de gestion/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Exclure' }));
    fireEvent.change(screen.getByLabelText('Pourquoi'), { target: { value: 'ce n’est plus appelé' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exclure la relation' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/arch/link/exclude')?.body).toMatchObject({ key: 'http|repo:front|repo:orders', reason: 'ce n’est plus appelé' }));
    fireEvent.click(screen.getByRole('button', { name: 'Corriger la cible' }));
    fireEvent.change(screen.getByLabelText('C’est en fait'), { target: { value: 'repo:shipping' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/arch/link/retarget')?.body).toMatchObject({ key: 'http|repo:front|repo:orders', target: 'repo:shipping' }));
  });

  it('hides supposed links when asked', async () => {
    mount();
    const relations = await screen.findByRole('region', { name: 'Relations' });
    fireEvent.click(within(relations).getByLabelText(/Toutes les relations/));
    expect(within(relations).queryAllByRole('button', { name: /supposée/i }).length).toBe(1);
    fireEvent.click(screen.getByLabelText('Supposées'));
    expect(within(relations).queryAllByRole('button', { name: /supposée/i }).length).toBe(0);
  });
});

describe('F2.4-18 · what is not on the map stays reachable', () => {
  it('counts each kind of address, classifies an unknown one, and puts back an excluded link', async () => {
    const { calls } = mount();
    const off = await screen.findByRole('region', { name: 'Pas sur la carte' });
    expect(within(off).getByText('Registres de paquets')).toBeTruthy();
    expect(within(off).getByText('Liens de documentation')).toBeTruthy();
    expect(within(off).getByText('nexus.acme-corp.test')).toBeTruthy();
    fireEvent.click(within(off).getByRole('button', { name: 'rates.acme-corp.test : ressource externe' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/arch/url/classify')?.body).toMatchObject({ host: 'rates.acme-corp.test', role: 'call' }));
    fireEvent.click(within(off).getByRole('button', { name: /Remettre/ }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/arch/link/reset')?.body).toMatchObject({ key: 'event|repo:orders|repo:shipping' }));
    expect(within(off).getByText('http|repo:gone|repo:orders')).toBeTruthy();
  });
});
