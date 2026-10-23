import { describe, expect, it } from 'vitest';
import { buildModel, type SystemModel } from '../src/arch/model.js';
import { applyOverrides, linkKey, type Override } from '../src/arch/overrides.js';
import { systemOf } from '../src/arch/system.js';
import { invoke } from '../src/engine/registry.js';
import { addRepo } from '../src/repo/registry.js';
import { scanAndStore } from '../src/repo/scan.js';
import type { Iface, RepoMap } from '../src/repo/types.js';
import { classifyUrl } from '../src/repo/url-kinds.js';
import { teamPrompt } from '../src/work/team.js';
import { landscape } from './helpers/landscape.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

/** A minimal map: just enough for the model (F2.4-15..17 review). */
function map(name: string, consumes: Iface[] = [], provides: Iface[] = []): RepoMap {
  return { repo: { id: name, name }, docs: [], stack: [], consumes, provides, published: [] } as unknown as RepoMap;
}
const url = (host: string, file: string, text: string, role?: Iface['role']): Iface => ({ kind: 'url', name: host, evidence: { file, line: 3, text }, ...(role ? { role } : {}) });
const role = (file: string, text: string) => { const m = /https?:\/\/([a-z0-9.-]+)/i.exec(text)!; return classifyUrl({ file, text, index: m.index, host: m[1]! }); };
const externals = (m: SystemModel) => m.nodes.filter((n) => n.kind === 'external').map((n) => n.name).sort();

async function registeredLandscape() {
  const { config } = await workKb();
  for (const r of await landscape()) { const { repo } = await addRepo({ path: r.path, kb: 'travail' }); await scanAndStore(config, repo); }
  return { config, person: { config, env: process.env, actor: 'person' as const }, agent: { config, env: process.env, actor: 'agent' as const } };
}

describe('lot D review · a retargeted link keeps the key of its correction (F2.4-17)', () => {
  it('can be put back, and excluded, by the key it was corrected under', async () => {
    const { config, person } = await registeredLandscape();
    const key = linkKey('external', 'repo:orders-api', 'ext:api.partner-pay.test');
    await invoke('arch.link.retarget', { key, target: 'repo:stock-service' }, person);
    let sys = (await systemOf(config))!;
    const moved = sys.model.links.find((l) => l.from === 'repo:orders-api' && l.to === 'repo:stock-service' && l.kind === 'external')!;
    expect(moved.key).toBe(key);
    const listed = await invoke('arch.map', {}, person);
    expect(listed.links!.some((l) => l.key === key)).toBe(true);
    await invoke('arch.link.reset', { key: moved.key! }, person);
    sys = (await systemOf(config))!;
    expect(externals(sys.model)).toContain('api.partner-pay.test');
  });
});

describe('lot D review · the person’s address rule wins over a name that looks like a repository', () => {
  it('keeps an address filed as an outside resource as such', () => {
    const maps = [map('orders-api'), map('billing', [url('orders.partner.test', 'src/a.ts', "fetch('https://orders.partner.test/x')", 'call')])];
    expect(externals(buildModel(maps, { lang: 'en' }))).toEqual([]);
    expect(externals(buildModel(maps, { lang: 'en', urlRules: new Map([['orders.partner.test', 'call']]) }))).toEqual(['orders.partner.test']);
  });
});

describe('lot D review · maps scanned before lot D', () => {
  it('reads a key=http:// address and an address cut from its evidence', () => {
    const maps = [map('a', [
      url('payments.acme.test', 'application.properties', 'payments.base-url=http://payments.acme.test'),
      url('rates.acme.test', 'src/a.ts', 'const x = 1; // the line was cut before the addr'),
    ])];
    expect(externals(buildModel(maps, { lang: 'en' }))).toEqual(['payments.acme.test', 'rates.acme.test']);
  });
});

describe('lot D review · an outside resource is as sure as its strongest finding, in any order', () => {
  it('gives the same certainty and confidence whichever finding comes first', () => {
    const call = url('api.pay.test', 'src/a.ts', "fetch('https://api.pay.test/x')", 'call');
    const conf = url('api.pay.test', 'application.yml', 'base-url: https://api.pay.test', 'endpoint');
    const one = buildModel([map('a', [call, conf])], { lang: 'en' }).links[0]!;
    const two = buildModel([map('a', [conf, call])], { lang: 'en' }).links[0]!;
    expect([one.certainty, one.confidence]).toEqual(['declared', 'sure']);
    expect([two.certainty, two.confidence]).toEqual(['declared', 'sure']);
  });
});

describe('lot D review · common calls and configuration keys', () => {
  it('reads Angular, .NET, jQuery, WebClient and Spring XML as calls or endpoints', () => {
    expect(role('src/a.service.ts', "this.httpClient.get('https://api.partner.test/x')")).toBe('call');
    expect(role('src/Api.cs', 'await _httpClient.GetAsync("https://api.partner.test/x");')).toBe('call');
    expect(role('src/a.js', "$.get('https://api.partner.test/x')")).toBe('call');
    expect(role('src/A.java', 'WebClient.builder().baseUrl("https://api.partner.test").build();')).toBe('call');
    expect(role('src/A.java', 'private static final String BASE_URL = "https://api.partner.test";')).toBe('endpoint');
    expect(role('context.xml', '<property name="url" value="https://api.partner.test"/>')).toBe('endpoint');
    // A key that names an address wins over a host that looks like a registry or a Git host.
    expect(role('application.yml', 'schema.registry.url: https://schema-registry.acme.test')).toBe('endpoint');
    expect(role('application.yml', 'baseUrl: https://api.github.acme.test')).toBe('endpoint');
  });

  it('does not let an XML comment opener in code hide the calls after it', () => {
    const text = "const clean = (h) => h.replace('<!--', '');\nfetch('https://api.partner.test/x');\n";
    expect(classifyUrl({ file: 'src/a.ts', text, index: text.indexOf('https://'), host: 'api.partner.test' })).toBe('call');
  });
});

describe('lot D review · the agent never works around the person (D72)', () => {
  it('turns an agent’s link onto a pair the person excluded into a conflict', async () => {
    const { config, person, agent } = await registeredLandscape();
    await invoke('arch.link.exclude', { key: linkKey('external', 'repo:stock-service', 'ext:hooks.chat-example.test'), reason: 'test hook' }, person);
    const r = await invoke('arch.link.add', { from: 'repo:stock-service', to: 'ext:hooks.chat-example.test', kind: 'http' }, agent);
    expect(r).toMatchObject({ changed: false, conflict: true });
    const sys = (await systemOf(config))!;
    expect(sys.model.links.some((l) => l.to === 'ext:hooks.chat-example.test')).toBe(false);
  });

  it('files no conflict when the agent agrees with the person', async () => {
    const { config, person, agent } = await registeredLandscape();
    const key = linkKey('service', 'repo:billing-cap', 'repo:orders-api');
    await invoke('arch.link.retarget', { key, target: 'repo:orders-api' }, person);
    expect(await invoke('arch.link.confirm', { key }, agent)).toMatchObject({ changed: false, conflict: false });
    expect((await systemOf(config))!.model.conflicts).toEqual([]);
  });

  it('applies the person’s exclusion to whatever kind of link joins the same pair', () => {
    const at = '2026-10-22T10:00:00.000Z';
    const model = buildModel([map('a', [url('x.test', 'src/a.ts', "fetch('https://x.test')", 'call')])], { lang: 'en' });
    const ex: Override = { key: linkKey('external', 'repo:a', 'ext:x.test'), action: 'exclude', target: null, kind: null, what: null, reason: 'no', origin: 'person', at };
    expect(applyOverrides(model, [ex]).links).toEqual([]);
  });
});

describe('lot D review · a product name is quoted safely in the agent’s prompt', () => {
  it('never lets a name break out of its quotes', () => {
    const prompt = teamPrompt({ id: 'T-abc123', kind: 'product', subject: 'Com"merce $(rm -rf x)', fields: ['team'], state: 'pending', createdAt: '', closedAt: null, report: null }, 'en');
    expect(prompt).toContain(`okb team set product 'Com"merce $(rm -rf x)'`);
  });
});
