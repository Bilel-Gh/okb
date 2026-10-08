import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDiagram } from '../src/arch/check.js';
import { buildModel, normalizePath } from '../src/arch/model.js';
import { containersView, contextView, entryPoints, flowView } from '../src/arch/views.js';
import { addRepo } from '../src/repo/registry.js';
import { scanAndStore, scanRepository } from '../src/repo/scan.js';
import { serve } from '../src/web/serve.js';
import type { RepoMap } from '../src/repo/types.js';
import { shop } from './helpers/arch.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';
import { TEST_ROOT } from './helpers/sandbox.js';
import { json, run } from './helpers/team.js';

useRepoSandboxes();

let cached: RepoMap[] | null = null;
async function maps(): Promise<RepoMap[]> {
  if (cached) return cached;
  const repos = await shop();
  cached = await Promise.all(repos.map((r) => scanRepository(r)));
  return cached;
}
const byName = (all: RepoMap[], name: string) => all.find((m) => m.repo.name === name)!;

describe('paths compare however they are written', () => {
  it('normalises parameters, slashes and base URLs', () => {
    expect(normalizePath('/orders/:id')).toBe('/orders/{}');
    expect(normalizePath('/orders/{orderId}/')).toBe('/orders/{}');
    expect(normalizePath('${ORDERS}/orders/${id}')).toBe('/orders/{}');
    expect(normalizePath('/orders?status=open')).toBe('/orders');
  });
});

describe('what each repository calls and publishes (new detections)', () => {
  it('finds outgoing HTTP calls with their method, path and base variable', async () => {
    const all = await maps();
    const web = byName(all, 'shop-web').consumes.filter((c) => c.kind === 'http-call').map((c) => c.name).sort();
    expect(web).toEqual(['GET /orders/{}', 'POST /orders', 'POST /refunds']);
    const orders = byName(all, 'orders-api').consumes.find((c) => c.kind === 'http-call')!;
    expect(orders).toMatchObject({ name: 'POST /payments', detail: 'base PAYMENTS_URL' });
    expect(orders.evidence.file).toBe('src/server.js');
  }, 120_000);

  it('finds events published and listened to', async () => {
    const all = await maps();
    expect(byName(all, 'orders-api').provides.some((p) => p.kind === 'event' && p.name === 'order.created')).toBe(true);
    expect(byName(all, 'shipping-worker').consumes.some((c) => c.kind === 'event' && c.name === 'order.created')).toBe(true);
  }, 120_000);
});

describe('the system model: links found by matching, never invented (roadmap §4)', () => {
  it('finds the known links of the fictitious shop, and invents none', async () => {
    const expected = JSON.parse(await readFile(resolve(TEST_ROOT, 'fixtures', 'arch', 'expected.json'), 'utf8')) as { links: { from: string; to: string; kind: string }[] };
    const model = buildModel(await maps());
    const found = model.links.filter((l) => l.to.startsWith('repo:') && l.from.startsWith('repo:')).map((l) => `${l.from.slice(5)}>${l.to.slice(5)}:${l.kind}`);
    const want = expected.links.map((l) => `${l.from}>${l.to}:${l.kind}`);
    const invented = found.filter((f) => !want.includes(f));
    const missed = want.filter((w) => !found.includes(w));
    expect(invented).toEqual([]);
    expect(missed.length / want.length).toBeLessThanOrEqual(0.1);
  }, 120_000);

  it('gives each HTTP link its evidence on both sides and a confidence', async () => {
    const model = buildModel(await maps());
    const link = model.links.find((l) => l.from === 'repo:orders-api' && l.to === 'repo:payments-api')!;
    expect(link.confidence).toBe('sure');
    expect(link.calls).toEqual([expect.objectContaining({ what: 'POST /payments' })]);
    expect(link.evidence.map((e) => e.repo).sort()).toEqual(['orders-api', 'payments-api']);
  }, 120_000);

  it('turns a call nobody serves into a question, and an outside host into an external system', async () => {
    const model = buildModel(await maps());
    expect(model.questions.map((q) => q.what)).toContain('POST /refunds');
    expect(model.nodes.some((n) => n.kind === 'external' && n.name === 'maps.example-geo.test')).toBe(true);
    expect(model.links.some((l) => l.from === 'repo:orders-api' && model.nodes.find((n) => n.id === l.to)?.kind === 'datastore')).toBe(true);
  }, 120_000);
});

describe('views people can read', () => {
  it('names boxes in plain words, keeps the id small, labels arrows with a verb, stays under 12 boxes', async () => {
    const model = buildModel(await maps());
    const view = containersView(model);
    expect(view.boxes.length).toBeLessThanOrEqual(12);
    expect(view.mermaid).toContain('Service des commandes');
    expect(view.mermaid).toContain('<small>orders-api</small>');
    expect(view.mermaid).toMatch(/-->\|"?crée orders/);
    expect(view.legend.length).toBeGreaterThan(0);
  }, 120_000);

  it('follows the flow of an order, from the shop to shipping', async () => {
    const model = buildModel(await maps());
    const flow = flowView(model, 'repo:shop-web', 'POST /orders');
    expect(flow.steps.map((s) => `${s.from}>${s.to}`)).toEqual(['shop-web>orders-api', 'orders-api>payments-api', 'orders-api>shipping-worker', 'shipping-worker>orders-api']);
    expect(flow.mermaid.startsWith('sequenceDiagram')).toBe(true);
  }, 120_000);
});

describe('the diagram checks itself before it is shown', () => {
  it('scores the computed view high, and flags a box with no name and an arrow with no evidence', async () => {
    const model = buildModel(await maps());
    const good = checkDiagram(model, containersView(model));
    expect(good.score).toBeGreaterThanOrEqual(80);
    const broken = { ...model, links: [...model.links, { id: 'x', from: 'repo:shop-web', to: 'repo:money-lib', kind: 'http' as const, confidence: 'sure' as const, calls: [], evidence: [], verb: '' }] };
    const bad = checkDiagram(broken, containersView(broken));
    expect(bad.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['no-evidence', 'no-verb']));
    expect(bad.score).toBeLessThan(good.score);
  }, 120_000);
});

describe('the system as a whole, and where its flows start', () => {
  it('draws the context: the system as one box, the outside systems it calls around it', async () => {
    const model = buildModel(await maps());
    const view = contextView(model, 'La boutique');
    expect(view.boxes[0]).toMatchObject({ kind: 'system', name: 'La boutique' });
    expect(view.boxes.slice(1).map((b) => b.name)).toEqual(['maps.example-geo.test']);
    expect(view.arrows).toEqual([expect.objectContaining({ from: 'system', to: 'ext:maps.example-geo.test', evidence: [expect.objectContaining({ repo: 'shop-web' })] })]);
    expect(checkDiagram(model, view).score).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it('finds the ways in: repositories that call others and that nobody calls', async () => {
    const model = buildModel(await maps());
    expect(entryPoints(model)).toEqual([{ repo: 'repo:shop-web', call: 'POST /orders' }]);
  }, 120_000);
});

describe('okb arch, for people and for Claude', () => {
  it('computes the map of a workspace, follows the main flow, and lists what it could not link', async () => {
    const repos = await shop();
    const root = resolve(repos[0]!.path, '..');
    const { s } = await workKb();
    const env = { ...s.env };
    delete env.OKB_PROFILE;
    await json(['workspace', 'add', root, '--kb', 'travail', '--name', 'Boutique', '--no-landscape'], env, root);
    const map = await json(['arch', '--kb', 'travail'], env, root);
    expect(map).toMatchObject({ ok: true, view: { kind: 'containers' } });
    expect(map.check.score).toBeGreaterThanOrEqual(80);
    expect(map.questions.map((q: { what: string }) => q.what)).toContain('POST /refunds');
    const flow = await json(['arch', 'flow', '--kb', 'travail'], env, root);
    expect(flow.view.steps[0]).toMatchObject({ from: 'shop-web', to: 'orders-api' });
    const text = await run(['arch', '--kb', 'travail', '--mermaid'], env, root);
    expect(text.stdout.startsWith('flowchart LR')).toBe(true);
    const human = await run(['arch', '--kb', 'travail'], env, root);
    expect(human.stdout).toContain('Service des commandes');
    expect(human.stdout).toContain('POST /refunds');
  }, 180_000);
});

describe('the system map in the web app', () => {
  it('serves the model, its views and their self-check, and where each repository\'s page is', async () => {
    const { s, config } = await workKb();
    for (const r of await shop()) await scanAndStore(config, (await addRepo({ path: r.path, kb: 'travail' })).repo);
    const { server, url } = await serve(config, { port: 0, env: s.env });
    try {
      const map = await (await fetch(`${url}/api/repos/arch?kb=travail`)).json();
      expect(map.system).toBeTruthy();
      expect(map.views.containers.check.score).toBeGreaterThanOrEqual(80);
      expect(map.views.context.boxes[0]).toMatchObject({ kind: 'system' });
      expect(map.views.flow.steps.length).toBe(4);
      expect(map.model.questions.map((q: { what: string }) => q.what)).toEqual(['POST /refunds']);
      expect(map.pages['repo:orders-api']).toBe('orders-api');
      const other = await (await fetch(`${url}/api/repos/arch?kb=travail&from=shipping-worker&call=GET%20/orders/%7B%7D`)).json();
      expect(other.views.flow.steps[0]).toMatchObject({ from: 'shipping-worker', to: 'orders-api' });
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  }, 180_000);
});
