import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, type SystemModel } from '../src/arch/model.js';
import { landscapeEdges } from '../src/repo/generated.js';
import { scanRepository } from '../src/repo/scan.js';
import type { RepoMap } from '../src/repo/types.js';
import { landscape } from './helpers/landscape.js';
import { useRepoSandboxes } from './helpers/repo.js';

useRepoSandboxes();

let maps: RepoMap[] = [];
let model: SystemModel;
const pair = (m: SystemModel, kind: string) => m.links.filter((l) => l.kind === kind).map((l) => `${l.from.replace(/^\w+:/, '')}>${l.to.replace(/^\w+:/, '')}`).sort();
const link = (m: SystemModel, from: string, to: string, kind: string) => m.links.find((l) => l.from === `repo:${from}` && l.to.endsWith(`:${to}`) && l.kind === kind);

beforeAll(async () => {
  maps = [];
  for (const r of await landscape()) maps.push(await scanRepository(r));
  model = buildModel(maps, { lang: 'en' });
}, 120_000);

describe('F2.4-15 · the map of a company landscape keeps only systems', () => {
  it('draws only the two real outside resources', () => {
    expect(model.nodes.filter((n) => n.kind === 'external').map((n) => n.name).sort()).toEqual(['api.partner-pay.test', 'hooks.chat-example.test']);
    expect(pair(model, 'external')).toEqual(['orders-api>api.partner-pay.test', 'stock-service>hooks.chat-example.test']);
  });

  it('files every other address off the map, by what it is', () => {
    const off = new Map<string, Set<string>>();
    for (const o of model.offMap ?? []) off.set(o.host, new Set([...(off.get(o.host) ?? []), o.role]));
    expect([...off.get('nexus.acme-corp.test')!]).toEqual(['registry']);
    expect([...off.get('jcenter.bintray.com')!]).toEqual(['registry']);
    expect([...off.get('github.acme-corp.test')!].sort()).toEqual(['doc', 'source-host']);
    expect([...off.get('wiki.acme-corp.test')!]).toEqual(['doc']);
    expect([...off.get('jira.acme-corp.test')!]).toEqual(['doc']);
    expect([...off.get('eureka.acme-corp.test')!]).toEqual(['platform']);
    expect([...off.get('fonts.googleapis.com')!]).toEqual(['asset']);
    expect([...off.get('cdn.jsdelivr.net')!]).toEqual(['asset']);
    expect([...off.get('www.ecb.europa.eu')!]).toEqual(['doc']);
    // A test file's address is never read.
    expect(off.has('mock.acme-corp.test')).toBe(false);
  });

  it('finds the links the old map missed, each with its certainty and reason', () => {
    expect(pair(model, 'http')).toEqual(['orders-api>stock-service', 'shop-web>orders-api']);
    expect(pair(model, 'event')).toEqual(['orders-api>stock-service']);
    expect(pair(model, 'package')).toEqual(['shop-web>money-lib', 'stock-service>money-lib']);
    expect(link(model, 'shop-web', 'orders-api', 'http')).toMatchObject({ certainty: 'proved', origin: 'scan' });
    expect(link(model, 'shop-web', 'orders-api', 'http')!.basis).toContain('POST /orders');
    // Billing names a service and an address that look like orders-api, which declares neither: supposed.
    const billing = link(model, 'billing-cap', 'orders-api', 'service')!;
    expect(billing).toMatchObject({ certainty: 'supposed', confidence: 'probable' });
    expect(billing.basis).toMatch(/orders-api/);
    // The partner is called in the code: declared, not proved.
    expect(link(model, 'orders-api', 'api.partner-pay.test', 'external')).toMatchObject({ certainty: 'declared' });
    // A named client towards a repository already linked adds no second line.
    expect(model.links.filter((l) => l.from === 'repo:orders-api' && l.to === 'repo:stock-service').map((l) => l.kind).sort()).toEqual(['event', 'http']);
    expect(model.questions).toEqual([]);
  });

  it('classifies a map scanned before lot D from its evidence lines', () => {
    const old = maps.map((m) => ({ ...m, consumes: m.consumes.map(({ role: _role, ...c }) => c) })) as RepoMap[];
    const legacy = buildModel(old, { lang: 'en' });
    expect(legacy.nodes.filter((n) => n.kind === 'external').map((n) => n.name).sort()).toEqual(['api.partner-pay.test', 'hooks.chat-example.test']);
  });

  it('lets a rule say what an address is, for every repository', () => {
    const ruled = buildModel(maps, { lang: 'en', urlRules: new Map([['hooks.chat-example.test', 'platform'], ['www.ecb.europa.eu', 'endpoint']]) });
    expect(ruled.nodes.filter((n) => n.kind === 'external').map((n) => n.name).sort()).toEqual(['api.partner-pay.test', 'www.ecb.europa.eu']);
  });
});

describe('F2.4-15 · one engine for every view of the relations', () => {
  it('gives the landscape, the brief and the map the same relations between repositories', () => {
    const between = model.links.filter((l) => l.from.startsWith('repo:') && l.to.startsWith('repo:')).map((l) => `${l.from.slice(5)}>${l.to.slice(5)}`);
    const edges = landscapeEdges(maps).edges.map((e) => `${e.from}>${e.to}`);
    expect([...new Set(edges)].sort()).toEqual([...new Set(between)].sort());
  });
});
