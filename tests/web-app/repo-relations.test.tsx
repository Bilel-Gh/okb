// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import { RepoRelations } from '../../web-app/src/pages/RepoRelations.js';
import { FR } from '../../src/i18n/fr.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ev = (repo: string, file: string, line: number) => ({ repo, file, line });
const fixture = {
  system: 'Commerce',
  model: {
    nodes: [
      { id: 'repo:shop-web', kind: 'repo', name: 'Boutique web', tech: 'shop-web' },
      { id: 'repo:orders-api', kind: 'repo', name: 'Service des commandes', tech: 'orders-api' },
      { id: 'repo:billing-cap', kind: 'repo', name: 'Facturation', tech: 'billing-cap' },
      { id: 'ext:api.partner-pay.test', kind: 'external', name: 'api.partner-pay.test', tech: 'api.partner-pay.test' },
    ],
    links: [
      { id: 'http:repo:shop-web>repo:orders-api', from: 'repo:shop-web', to: 'repo:orders-api', kind: 'http', confidence: 'sure', certainty: 'proved', calls: [{ what: 'POST /orders', line: 2 }], evidence: [ev('shop-web', 'src/api.ts', 2)], verb: 'crée orders' },
      { id: 'service:repo:billing-cap>repo:orders-api', from: 'repo:billing-cap', to: 'repo:orders-api', kind: 'service', confidence: 'probable', certainty: 'supposed', calls: [{ what: 'OrdersService', line: 1 }], evidence: [ev('billing-cap', 'package.json', 1)], verb: 'appelle OrdersService' },
      { id: 'external:repo:orders-api>ext:api.partner-pay.test', from: 'repo:orders-api', to: 'ext:api.partner-pay.test', kind: 'external', confidence: 'sure', certainty: 'declared', calls: [{ what: 'api.partner-pay.test', line: 12 }], evidence: [ev('orders-api', 'src/A.java', 12)], verb: 'appelle' },
    ],
    questions: [],
    offMap: [
      { repo: 'orders-api', host: 'nexus.acme-corp.test', role: 'registry', evidence: ev('orders-api', 'pom.xml', 5) },
      { repo: 'orders-api', host: 'wiki.acme-corp.test', role: 'doc', evidence: ev('orders-api', 'src/A.java', 4) },
      { repo: 'shop-web', host: 'cdn.jsdelivr.net', role: 'asset', evidence: ev('shop-web', 'src/api.ts', 4) },
    ],
  },
};

describe('F2.4-18 · a repository says who it talks to, without the noise', () => {
  it('lists its relations with their certainty, and its tools and links apart', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture))));
    render(<I18n.Provider value={makeT(FR, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RepoRelations repo="orders-api" /></QueryClientProvider></I18n.Provider>);
    const panel = await screen.findByRole('region', { name: 'Comment les repos se relient' });
    const rows = within(panel).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows.some((r) => r.includes('Boutique web') && r.includes('POST /orders') && r.includes('prouvée'))).toBe(true);
    expect(rows.some((r) => r.includes('Facturation') && r.includes('supposée'))).toBe(true);
    expect(rows.some((r) => r.includes('api.partner-pay.test') && r.includes('déclarée'))).toBe(true);
    const tools = screen.getByRole('region', { name: 'Outils et liens' });
    expect(within(tools).getByText('nexus.acme-corp.test')).toBeTruthy();
    expect(within(tools).getByText('wiki.acme-corp.test')).toBeTruthy();
    // Another repository's CDN is not this one's.
    expect(within(tools).queryByText('cdn.jsdelivr.net')).toBeNull();
  });
});
