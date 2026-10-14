import { describe, expect, it } from 'vitest';
import { buildModel, type ArchLink, type ArchNode, type SystemModel } from '../src/arch/model.js';
import { containersView, contextView, flowView } from '../src/arch/views.js';
import type { RepoMap } from '../src/repo/types.js';

const node = (id: string, kind: ArchNode['kind'] = 'repo'): ArchNode => ({ id, kind, name: id, tech: id });
const link = (from: string, to: string, confidence: ArchLink['confidence'] = 'sure'): ArchLink => ({ id: `${from}>${to}`, from, to, kind: 'http', confidence, calls: [{ what: 'GET /items', line: 2 }], evidence: [{ repo: from, file: 'src/api.ts', line: 2 }], verb: 'reads items' });
const scan = (name: string, routes: string[], calls: { name: string; base?: string }[] = []): RepoMap => ({ repo: { name }, docs: [], stack: [], published: [], provides: routes.map((name) => ({ kind: 'http-route', name, evidence: { file: 'routes.ts', line: 4, text: '' } })), consumes: calls.map((c) => ({ kind: 'http-call', name: c.name, ...(c.base ? { detail: `base ${c.base}` } : {}), evidence: { file: 'client.ts', line: 8, text: '' } })) } as unknown as RepoMap);

describe('architecture preserves incomplete evidence and grouped relations', () => {
  it('does not upgrade an unknown HTTP method to certainty because one specific route matches', () => {
    const model = buildModel([scan('front', [], [{ name: 'ANY /items' }]), scan('items-api', ['GET /items'])]);
    expect(model.links[0]?.confidence).toBe('probable');
  });
  it('keeps an aggregated link uncertain when any of its calls is uncertain', () => {
    const model = buildModel([scan('front', [], [{ name: 'GET /items' }, { name: 'ANY /items' }]), scan('items-api', ['GET /items'])]);
    expect(model.links[0]?.confidence).toBe('probable');
    expect(model.links[0]?.calls).toHaveLength(2);
  });
  it('does not route a call to a different named repository on path alone', () => {
    const model = buildModel([scan('front', [], [{ name: 'POST /items', base: 'BILLING_URL' }]), scan('items-api', ['POST /items']), scan('billing-api', ['GET /items'])]);
    expect(model.links).toHaveLength(0);
    expect(model.questions[0]).toMatchObject({ what: 'POST /items', named: 'billing-api' });
  });
  it('treats a database library as possible technology use and preserves its source', () => {
    const repository = { ...scan('orders-api', []), stack: [{ id: 'postgres', label: 'PostgreSQL', evidence: [{ file: 'package.json', line: 12, text: 'pg' }] }] };
    const model = buildModel([repository]);
    expect(model.links[0]).toMatchObject({ kind: 'data', confidence: 'probable', evidence: [{ repo: 'orders-api', file: 'package.json', line: 12 }] });
  });
  it('keeps incoming, outgoing and internal relations when nodes are grouped', () => {
    const nodes = Array.from({ length: 18 }, (_, i) => node(`repo:${String(i).padStart(2, '0')}`));
    const links = [link(nodes[0]!.id, nodes[17]!.id), link(nodes[17]!.id, nodes[0]!.id), link(nodes[16]!.id, nodes[17]!.id)];
    const model: SystemModel = { nodes, links, questions: [] };
    const view = containersView(model);
    expect(view.boxes).toHaveLength(12);
    expect(view.groups?.[0]?.members).toHaveLength(7);
    expect(new Set(view.arrows.map((a) => a.id))).toEqual(new Set(links.map((a) => a.id)));
    expect(view.groups?.[0]?.members.map((n) => n.id)).toContain(nodes[17]!.id);
  });
  it('reports the members hidden in context rather than silently dropping outside systems', () => {
    const externals = Array.from({ length: 14 }, (_, i) => node(`ext:${i}`, 'external'));
    const model: SystemModel = { nodes: [node('repo:web'), ...externals], links: externals.map((n) => ({ ...link('repo:web', n.id), kind: 'external' })), questions: [] };
    const view = contextView(model, 'Shop');
    expect(view.boxes.length).toBeLessThanOrEqual(12);
    expect(view.groups?.[0]?.members).toHaveLength(4);
    expect(view.arrows.flatMap((a) => a.evidence)).toHaveLength(14);
  });
});


describe('bounded flows report their omitted dependencies', () => {
  it('keeps every ambiguous first target and reports the unshown relation IDs', () => {
    const nodes = Array.from({ length: 15 }, (_, i) => node(`repo:${i}`));
    const links = nodes.slice(1).map((n) => link(nodes[0]!.id, n.id, 'probable'));
    const model: SystemModel = { nodes, links, questions: [] };
    const view = flowView(model, nodes[0]!.id, 'GET /items', { max: 4 });
    expect(view.arrows).toHaveLength(4);
    expect(view.omittedRelations).toHaveLength(10);
    expect([...view.arrows.map((a) => a.id), ...view.omittedRelations!].sort()).toEqual(links.map((a) => a.id).sort());
  });
});
