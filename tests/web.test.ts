import { readFile, writeFile, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as guardModule from '../src/apply/guard.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { proposeFiles } from '../src/proposal/files.js';
import { materializeFile } from '../src/proposal/materialize.js';
import { saveProposal } from '../src/proposal/store.js';
import { walkFiles } from '../src/util/fsx.js';
import { serve } from '../src/web/serve.js';
import { SCRIPT } from '../src/web/ui.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) await f(); });
async function reader() {
  const s: Sandbox = await makeSandbox({ profileId: 'reader' });
  cleanup.push(() => s.cleanup());
  const config = await s.config();
  const { server, url } = await serve(config, { port: 0 });
  cleanup.push(() => new Promise<void>((done, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : done()); }));
  return { s, config, url };
}
function http(url: string, headers: Record<string, string>) {
  return new Promise<number>((done, reject) => {
    const r = request(url, { headers }, res => { res.resume(); res.on('end', () => done(res.statusCode!)); });
    r.on('error', reject); r.end();
  });
}
async function snapshot(dir: string) {
  return Promise.all((await walkFiles(dir)).map(async p => [p, (await readFile(resolve(dir, p))).toString('base64')]));
}

describe('local read-only reader', () => {
  it('searches with located evidence without modifying notes or private state', async () => {
    const { s, url } = await reader();
    const before = await snapshot(s.dir);
    const result = await (await fetch(`${url}/api/search?q=dispatcher`)).json();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.evidence[0].line).toBeGreaterThan(0);
    const overview = await (await fetch(`${url}/api/overview`)).text();
    expect(overview).not.toContain(s.dir);
    await fetch(`${url}/api/audit`);
    await fetch(`${url}/api/note?path=architecture/fleet-overview.md`);
    expect(await snapshot(s.dir)).toEqual(before);
  });

  it('previews exactly the CLI materialization and blocks stale previews', async () => {
    const { s, config, url } = await reader();
    const bundle = await loadBundleFor(config);
    const path = 'architecture/fleet-overview.md';
    const before = bundle.snapshot.files.get(path)!;
    const proposal = proposeFiles(config, bundle, new Map([[path, before + '\nNew editorial note.\n']]), 'Review');
    await saveProposal(config, proposal);
    const preview = await (await fetch(`${url}/api/proposal?id=${proposal.id}`)).json();
    expect(preview.contentHash).toBe(proposal.contentHash);
    expect(preview.files[0].after).toBe(materializeFile(proposal.changes[0]!.path, before, proposal.changes));
    await writeFile(resolve(s.vault, path), before + '\nA human edit.\n');
    const stale = await (await fetch(`${url}/api/proposal?id=${proposal.id}`)).json();
    expect(stale.guard.ok).toBe(false);
    expect(stale.files).toEqual([]);
  });

  it('refuses writes, cross-origin reads and rebinding hosts', async () => {
    const { url } = await reader();
    expect((await fetch(`${url}/api/overview`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${url}/api/overview`, { headers: { Origin: 'https://hostile.example' } })).status).toBe(403);
    expect((await fetch(`${url}/api/overview`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect(await http(`${url}/api/overview`, { Host: 'hostile.example' })).toBe(403);
    expect((await fetch(`${url}/api/approve`)).status).toBe(404);
  });

  it('refuses a preview whose earlier snapshot differs from the baseline even if guard sees it restored', async () => {
    const { s, config, url } = await reader();
    const bundle = await loadBundleFor(config);
    const path = 'architecture/fleet-overview.md';
    const before = bundle.snapshot.files.get(path)!;
    const proposal = proposeFiles(config, bundle, new Map([[path, before + '\nExpected change.\n']]), 'Review');
    await saveProposal(config, proposal);
    await writeFile(resolve(s.vault, path), before + '\nTemporary human edit.\n');
    const originalGuard = guardModule.guardApply;
    vi.spyOn(guardModule, 'guardApply').mockImplementationOnce(async (...args) => {
      await writeFile(resolve(s.vault, path), before);
      return originalGuard(...args);
    });
    const response = await fetch(`${url}/api/proposal?id=${proposal.id}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'E_STALE' });
  });

  it('exposes only registered KB notes, never arbitrary paths or symlinks', async () => {
    const { s, url } = await reader();
    await writeFile(resolve(s.dir, 'outside.md'), 'private fixture');
    await symlink(resolve(s.dir, 'outside.md'), resolve(s.vault, 'escape.md'));
    expect((await fetch(`${url}/api/note?path=../outside.md`)).status).toBe(400);
    expect((await fetch(`${url}/api/note?path=escape.md`)).status).toBe(404);
    expect((await fetch(`${url}/api/note?path=.okb/approval.key`)).status).toBe(404);
    const malicious = await fetch(`${url}/api/proposal?id=../../outside`);
    expect(malicious.status).toBe(400);
    expect(await malicious.text()).not.toContain(s.dir);
  });

  it('ships parseable local assets with a restrictive content policy', async () => {
    const { url } = await reader();
    expect(() => new Script(SCRIPT)).not.toThrow();
    const page = await fetch(url);
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    expect(await page.text()).toContain('lecture seule');
    expect((await fetch(`${url}/app.js`)).status).toBe(200);
    expect((await fetch(`${url}/style.css`)).status).toBe(200);
  });
});
