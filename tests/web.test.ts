import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as guardModule from '../src/apply/guard.js';
import { approvalPath } from '../src/apply/approval.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { proposeFiles } from '../src/proposal/files.js';
import { materializeFile } from '../src/proposal/materialize.js';
import { saveProposal } from '../src/proposal/store.js';
import { walkFiles } from '../src/util/fsx.js';
import * as presence from '../src/web/presence.js';
import { renderMarkdown } from '../src/web/render.js';
import { serve } from '../src/web/serve.js';
import { makeSandbox, TEST_ROOT, type Sandbox } from './helpers/sandbox.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) await f(); });
async function app() {
  const s: Sandbox = await makeSandbox({ profileId: 'reader' });
  cleanup.push(() => s.cleanup());
  const config = await s.config();
  const { server, url } = await serve(config, { port: 0, env: s.env });
  cleanup.push(() => new Promise<void>((done, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : done())); }));
  const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token, ...headers }, body: JSON.stringify(body) });
  return { s, config, url, token, post };
}
function http(url: string, headers: Record<string, string>) {
  return new Promise<number>((done, reject) => {
    const r = request(url, { headers }, (res) => { res.resume(); res.on('end', () => done(res.statusCode!)); });
    r.on('error', reject); r.end();
  });
}
async function snapshot(dir: string) {
  return Promise.all((await walkFiles(dir)).map(async (p) => [p, (await readFile(resolve(dir, p))).toString('base64')]));
}

describe('OKB web app', () => {
  it('reads without writing: status, notes, search, health, settings, doctor', async () => {
    const { s, url } = await app();
    const before = await snapshot(s.vault);
    for (const path of ['/api/status', '/api/notes', '/api/search?q=dispatcher', '/api/health', '/api/settings', '/api/templates', '/api/cards', '/api/weekly', '/api/journal', '/api/inbox', '/api/focus', '/api/i18n']) {
      const r = await fetch(`${url}${path}`);
      expect(r.status, path).toBe(200);
    }
    const note = await (await fetch(`${url}/api/note?path=architecture/fleet-overview.md`)).json();
    expect(note.html).toContain('<h1');
    expect(await snapshot(s.vault)).toEqual(before);
  });

  it('previews exactly the CLI materialization and blocks stale previews', async () => {
    const { s, config, url } = await app();
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

  it('refuses a preview whose earlier snapshot differs from the baseline even if guard sees it restored', async () => {
    const { s, config, url } = await app();
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

  it('refuses cross-site requests, rebinding hosts and writes without the session token', async () => {
    const { url, post } = await app();
    expect((await fetch(`${url}/api/status`, { headers: { Origin: 'https://hostile.example' } })).status).toBe(403);
    expect((await fetch(`${url}/api/status`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect(await http(`${url}/api/status`, { Host: 'hostile.example' })).toBe(403);
    expect((await fetch(`${url}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"x"}' })).status).toBe(403);
    expect((await post('/api/capture', { text: 'x' }, { 'X-OKB-Token': 'wrong' })).status).toBe(403);
    expect((await post('/api/capture', { text: 'x' }, { Origin: 'https://hostile.example' })).status).toBe(403);
    expect((await fetch(`${url}/api/status`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${url}/api/nope`)).status).toBe(404);
  });

  it('acts with the token: capture, focus, end of session, settings', async () => {
    const { s, post, url } = await app();
    const captured = await (await post('/api/capture', { text: 'Une idée fictive à garder' })).json();
    expect(captured.ok).toBe(true);
    expect((await (await fetch(`${url}/api/inbox`)).json()).items).toHaveLength(1);
    expect((await post('/api/focus/init', {})).status).toBe(200);
    expect((await post('/api/focus', { text: '- Projet fictif : préparer la démo' })).status).toBe(200);
    const done = await (await post('/api/done', { summary: 'Session fictive', keep: ['Une leçon'], next: 'Relire' })).json();
    expect(done.captured).toHaveLength(1);
    expect((await post('/api/settings', { key: 'writing.preset', value: 'expert' })).status).toBe(200);
    expect(await readFile(resolve(s.home, 'profiles', 'reader', 'profile.yaml'), 'utf8')).toContain('preset: expert');
    // The next request sees the new value: no restart of okb serve.
    expect((await (await fetch(`${url}/api/templates`)).json()).style.preset).toBe('expert');
    const bad = await post('/api/settings', { key: 'writing.preset', value: 'baroque' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'E_INVALID', title: expect.any(String) });
    expect((await post('/api/capture', { text: 'token: sk-live-9fK2xQ7mPz4LwB8vR1tN6cY3abcd' })).status).toBe(400);
  });

  it('never approves without the person: no presence, no signature; confirmed presence approves and applies', async () => {
    const { config, post, s } = await app();
    const bundle = await loadBundleFor(config);
    const path = 'architecture/fleet-overview.md';
    const proposal = proposeFiles(config, bundle, new Map([[path, bundle.snapshot.files.get(path)! + '\nApproved from the web app.\n']]), 'web');
    await saveProposal(config, proposal);
    vi.spyOn(presence, 'confirmPresence').mockResolvedValueOnce('unavailable');
    const refused = await (await post('/api/proposal/approve', { id: proposal.id })).json();
    expect(refused).toMatchObject({ ok: false, presence: 'unavailable' });
    await expect(access(approvalPath(config, proposal.id))).rejects.toThrow();
    vi.spyOn(presence, 'confirmPresence').mockResolvedValueOnce('confirmed');
    const applied = await (await post('/api/proposal/approve', { id: proposal.id })).json();
    expect(applied).toMatchObject({ ok: true, applied: true });
    expect(await readFile(resolve(s.vault, path), 'utf8')).toContain('Approved from the web app.');
    const undone = await (await post('/api/undo', { receipt: applied.receipt.id })).json();
    expect(undone.restored).toHaveLength(1);
  });

  it('exposes only registered KB notes, never arbitrary paths or symlinks', async () => {
    const { s, url } = await app();
    await writeFile(resolve(s.dir, 'outside.md'), 'private fixture');
    await symlink(resolve(s.dir, 'outside.md'), resolve(s.vault, 'escape.md'));
    expect((await fetch(`${url}/api/note?path=../outside.md`)).status).toBe(400);
    expect((await fetch(`${url}/api/note?path=escape.md`)).status).toBe(404);
    expect((await fetch(`${url}/api/note?path=.okb/owner.yaml`)).status).toBe(404);
    const malicious = await fetch(`${url}/api/proposal?id=../../outside`);
    expect(malicious.status).toBe(400);
    expect(await malicious.text()).not.toContain(s.dir);
    expect((await fetch(`${url}/..%2f..%2fpackage.json`)).status).toBe(404);
  });

  it('reports a busy port as a clear conflict, not a crash', async () => {
    const { config, url } = await app();
    const port = Number(new URL(url).port);
    await expect(serve(config, { port })).rejects.toMatchObject({ code: 'E_CONFLICT', key: 'portInUse', params: { port, next: port + 1 } });
  });

  it('serves its own assets only, with a restrictive content policy, and scripts that parse', async () => {
    const { url } = await app();
    const page = await fetch(url);
    expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain('/js/main.js');
    expect((await fetch(`${url}/app.css`)).status).toBe(200);
    const webJs = resolve(TEST_ROOT, '..', 'web', 'js');
    for (const file of [...(await readdir(webJs)).map((f) => resolve(webJs, f)), ...(await readdir(resolve(webJs, 'views'))).map((f) => resolve(webJs, 'views', f))]) {
      if (file.endsWith('.js')) expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();
    }
  });

  it('renders notes safely: no raw HTML, callouts, in-app links, footnotes', async () => {
    const html = await renderMarkdown('---\ntitle: x\n---\n# T\n\n<script>alert(1)</script>\n\n> [!tip]- Aide\n> texte\n\nVoir [Idempotence](../concepts/idempotence.md) et [site](https://example.com) [x](javascript:alert(1))\n\nTexte[^1]\n\n[^1]: note\n', 'guides/x.md');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<details class="callout callout-tip">');
    expect(html).toContain('href="#/note/concepts%2Fidempotence.md"');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).not.toContain('title: x');
  });
});
