import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/arch/model.js';
import { applyOverrides, linkKey, type Override } from '../src/arch/overrides.js';
import { systemOf } from '../src/arch/system.js';
import { invoke } from '../src/engine/registry.js';
import { addRepo } from '../src/repo/registry.js';
import { scanAndStore, scanRepository } from '../src/repo/scan.js';
import { landscape } from './helpers/landscape.js';
import { git, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

const at = '2026-10-22T10:00:00.000Z';
const ov = (o: Partial<Override> & Pick<Override, 'key' | 'action'>): Override => ({ target: null, kind: null, what: null, reason: '', origin: 'person', at, ...o });

async function scanned() {
  const repos = await landscape();
  return { repos, maps: await Promise.all(repos.map((r) => scanRepository(r))) };
}

/** The landscape registered in a work KB and scanned, as the person has it. */
async function registeredLandscape() {
  const { config } = await workKb();
  const repos = await landscape();
  const entries = [];
  for (const r of repos) { const { repo } = await addRepo({ path: r.path, kb: 'travail' }); await scanAndStore(config, repo); entries.push(repo); }
  return { config, repos, entries };
}
const person = (config: Awaited<ReturnType<typeof workKb>>['config']) => ({ config, env: process.env, actor: 'person' as const });
const agent = (config: Awaited<ReturnType<typeof workKb>>['config']) => ({ config, env: process.env, actor: 'agent' as const });

describe('F2.4-17 · the person corrects the map (pure)', () => {
  it('confirms, excludes, retargets and adds, and says which corrections no longer match', async () => {
    const { maps } = await scanned();
    const model = buildModel(maps, { lang: 'en' });
    const supposed = linkKey('service', 'repo:billing-cap', 'repo:orders-api');
    const out = applyOverrides(model, [
      ov({ key: supposed, action: 'confirm' }),
      ov({ key: linkKey('external', 'repo:stock-service', 'ext:hooks.chat-example.test'), action: 'exclude', reason: 'test webhook only' }),
      ov({ key: linkKey('external', 'repo:orders-api', 'ext:api.partner-pay.test'), action: 'retarget', target: 'repo:stock-service' }),
      ov({ key: linkKey('http', 'repo:billing-cap', 'repo:money-lib'), action: 'add', kind: 'http', target: 'repo:money-lib', what: 'GET /rates', reason: 'told by the team' }),
      ov({ key: linkKey('http', 'repo:gone', 'repo:orders-api'), action: 'exclude' }),
    ], 'en');
    const by = (k: string) => out.links.find((l) => linkKey(l.kind, l.from, l.to) === k);
    expect(by(supposed)).toMatchObject({ certainty: 'confirmed', origin: 'person', confidence: 'sure' });
    expect(out.links.some((l) => l.to === 'ext:hooks.chat-example.test')).toBe(false);
    expect(out.nodes.some((n) => n.id === 'ext:hooks.chat-example.test')).toBe(false);
    expect(out.excluded?.map((l) => [l.to, l.reason])).toEqual([['ext:hooks.chat-example.test', 'test webhook only']]);
    expect(by(linkKey('external', 'repo:orders-api', 'repo:stock-service'))).toMatchObject({ certainty: 'confirmed', to: 'repo:stock-service' });
    expect(out.nodes.some((n) => n.id === 'ext:api.partner-pay.test')).toBe(false);
    expect(by(linkKey('http', 'repo:billing-cap', 'repo:money-lib'))).toMatchObject({ certainty: 'confirmed', origin: 'person', evidence: [], calls: [{ what: 'GET /rates', line: 0 }] });
    expect(out.stale?.map((s) => s.key)).toEqual([linkKey('http', 'repo:gone', 'repo:orders-api')]);
  });
});

describe('F2.4-17 · corrections are kept and respected by the next scan (D72)', () => {
  it('keeps an exclusion after a rescan where the line moved, until the person puts it back', async () => {
    const { config, repos, entries } = await registeredLandscape();
    const key = linkKey('service', 'repo:billing-cap', 'repo:orders-api');
    await invoke('arch.link.exclude', { key, reason: 'OrdersService is the old monolith' }, person(config));
    // The code moves: three lines added on top of the file that requires the service.
    const billing = repos.find((r) => r.name === 'billing-cap')!;
    await writeFile(resolve(billing.path, 'srv/billing.js'), "// one\n// two\n// three\nmodule.exports = async () => cds.connect.to('OrdersService');\n");
    git(billing.path, 'commit', '-qam', 'move');
    await scanAndStore(config, entries.find((e) => e.name === 'billing-cap')!);
    let sys = (await systemOf(config))!;
    expect(sys.model.links.some((l) => linkKey(l.kind, l.from, l.to) === key)).toBe(false);
    expect(sys.model.excluded?.map((l) => l.reason)).toEqual(['OrdersService is the old monolith']);
    await invoke('arch.link.reset', { key }, person(config));
    sys = (await systemOf(config))!;
    expect(sys.model.links.find((l) => linkKey(l.kind, l.from, l.to) === key)?.certainty).toBe('supposed');
  });

  it('classifies an address once for every repository', async () => {
    const { config } = await registeredLandscape();
    await invoke('arch.url.classify', { host: 'hooks.chat-example.test', role: 'platform' }, person(config));
    const sys = (await systemOf(config))!;
    expect(sys.model.nodes.filter((n) => n.kind === 'external').map((n) => n.name)).toEqual(['api.partner-pay.test']);
    expect(sys.model.offMap?.find((o) => o.host === 'hooks.chat-example.test')?.role).toBe('platform');
  });

  it('never lets the agent undo what the person decided: a different answer becomes a conflict', async () => {
    const { config } = await registeredLandscape();
    const key = linkKey('service', 'repo:billing-cap', 'repo:orders-api');
    await invoke('arch.link.confirm', { key }, person(config));
    const r = await invoke('arch.link.retarget', { key, target: 'repo:stock-service', reason: 'the wiki says stock' }, agent(config));
    expect(r).toMatchObject({ changed: false, conflict: true });
    let sys = (await systemOf(config))!;
    expect(sys.model.links.find((l) => linkKey(l.kind, l.from, l.to) === key)).toMatchObject({ certainty: 'confirmed', to: 'repo:orders-api' });
    expect(sys.model.conflicts?.map((c) => [c.key, c.target, c.origin])).toEqual([[key, 'repo:stock-service', 'agent']]);
    await invoke('arch.conflict.resolve', { key, keep: 'agent' }, person(config));
    sys = (await systemOf(config))!;
    expect(sys.model.links.find((l) => l.from === 'repo:billing-cap' && l.kind === 'service')?.to).toBe('repo:stock-service');
    expect(sys.model.conflicts).toEqual([]);
  });

  it('keeps excluding, classifying and settling for the person alone', async () => {
    const { config } = await registeredLandscape();
    const key = linkKey('service', 'repo:billing-cap', 'repo:orders-api');
    await expect(invoke('arch.link.exclude', { key, reason: 'x' }, agent(config))).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    await expect(invoke('arch.url.classify', { host: 'a.test', role: 'doc' }, agent(config))).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    // The agent may confirm a supposed link; it stays the agent's, not the person's.
    await invoke('arch.link.confirm', { key }, agent(config));
    const sys = (await systemOf(config))!;
    expect(sys.model.links.find((l) => linkKey(l.kind, l.from, l.to) === key)).toMatchObject({ certainty: 'confirmed', origin: 'agent' });
  });

  it('refuses a correction towards something that is not on the map', async () => {
    const { config } = await registeredLandscape();
    await expect(invoke('arch.link.retarget', { key: linkKey('service', 'repo:billing-cap', 'repo:orders-api'), target: 'nowhere' }, person(config))).rejects.toMatchObject({ code: 'E_INVALID' });
  });
});
