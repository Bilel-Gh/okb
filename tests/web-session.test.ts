import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { keepProposal } from '../src/review/keep.js';
import { reviewOf } from '../src/review/state.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { serve } from '../src/web/server.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';
import { TEST_ROOT } from './helpers/sandbox.js';

useRepoSandboxes();
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const s of stops.splice(0)) await s(); closeDbs(); });

const note = (title: string) => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# ${title}\n\nTexte.\n`;
async function app() {
  const { s, config } = await workKb();
  await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
  const c = (await loadConfig({ env: s.env, profileId: config.profile.id })).config;
  await writeOwner(c.kb.root, c.profile.id);
  const p = proposeFiles(c, await loadBundleFor(c), new Map([['n/a.md', note('A')]]), 'agent');
  await saveProposal(c, p); await keepProposal(c, p.id, s.env);
  const env = { ...s.env, OKB_NO_DIALOG: '1' };
  const started = await serve(c, { port: 0, env });
  stops.push(started.shutdown);
  const token = (await (await fetch(`${started.url}/api/session`)).json() as { token: string }).token;
  const post = (path: string, body: unknown, key?: string) => fetch(`${started.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-okb-token': token, origin: started.url, ...(key ? { 'x-okb-presence': key } : {}) }, body: JSON.stringify(body) });
  const claim = async (link: string) => ((await (await post('/api/presence/claim', { k: new URL(link).searchParams.get('k') })).json()) as { key: string | null }).key;
  return { config: c, started, post, claim, env };
}

describe('saying yes in the app, without a dialog or a terminal (F2.0-56, D71)', () => {
  it('gives the page it opens a key, once, and never as a cookie (another local port would receive it)', async () => {
    const { started, claim } = await app();
    const link = started.openUrl();
    const page = await fetch(link, { redirect: 'manual' });
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(await claim(link)).toMatch(/^[a-f0-9]{48}$/);
    expect(await claim(link)).toBeNull();
  });

  it('a link not claimed within a minute is dead', async () => {
    const { started, claim } = await app();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const link = started.openUrl();
      vi.setSystemTime(Date.now() + 61_000);
      expect(await claim(link)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('validates with the key, and falls back to the person’s confirmation without it', async () => {
    const { config, started, post, claim } = await app();
    const without = await (await post('/api/review/validate', { paths: ['n/a.md'] })).json() as { ok: boolean; presence: string };
    expect(without).toMatchObject({ ok: false, presence: 'unavailable' });
    expect(reviewOf(config, 'n/a.md')?.state).toBe('pending');
    const key = (await claim(started.openUrl()))!;
    const withKey = await (await post('/api/review/validate', { paths: ['n/a.md'] }, key)).json() as { ok: boolean };
    expect(withKey.ok).toBe(true);
    expect(reviewOf(config, 'n/a.md')?.state).toBe('validated');
  });

  it('the filing setting changes only with the person present (C1)', async () => {
    const { config, started, post, claim, env } = await app();
    const without = await (await post('/api/settings', { key: 'changes.agentWrites', value: 'proposal' })).json() as { ok: boolean; presence?: string };
    expect(without).toMatchObject({ ok: false, presence: 'unavailable' });
    expect((await loadConfig({ env, profileId: config.profile.id })).config.changes.agentWrites).toBe('review-later');
    const key = (await claim(started.openUrl()))!;
    expect(((await (await post('/api/settings', { key: 'changes.agentWrites', value: 'proposal' }, key)).json()) as { ok: boolean }).ok).toBe(true);
    expect((await loadConfig({ env, profileId: config.profile.id })).config.changes.agentWrites).toBe('proposal');
  });

  it('the hook refuses a tool that calls the review routes', async () => {
    const hook = resolve(TEST_ROOT, '..', 'plugin', 'hooks', 'guard-approval.mjs');
    const out = await new Promise<string>((done) => {
      const child = spawn(process.execPath, [hook], { stdio: ['pipe', 'pipe', 'inherit'] });
      let o = ''; child.stdout.on('data', (d) => { o += d; }); child.on('close', () => done(o));
      child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'curl -X POST http://127.0.0.1:4317/api/review/validate -d {}' } }));
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('the hook refuses the settings route and an edit of the profile that sets how notes are filed (C1)', async () => {
    const hook = resolve(TEST_ROOT, '..', 'plugin', 'hooks', 'guard-approval.mjs');
    const run = (input: unknown) => new Promise<string>((done) => {
      const child = spawn(process.execPath, [hook], { stdio: ['pipe', 'pipe', 'inherit'] });
      let o = ''; child.stdout.on('data', (d) => { o += d; }); child.on('close', () => done(o));
      child.stdin.end(JSON.stringify(input));
    });
    const decision = async (input: unknown) => { const o = await run(input); return o ? JSON.parse(o).hookSpecificOutput.permissionDecision : 'allow'; };
    expect(await decision({ tool_name: 'Bash', tool_input: { command: 'curl -X POST http://127.0.0.1:4317/api/settings -d {}' } })).toBe('deny');
    expect(await decision({ tool_name: 'Edit', tool_input: { file_path: '/x/.okb/profiles/p/profile.yaml', old_string: 'a', new_string: 'changes:\n  agentWrites: review-later' } })).toBe('deny');
    expect(await decision({ tool_name: 'Write', tool_input: { file_path: '/x/.okb/profiles/p/profile.yaml', content: 'review:\n  offer: false' } })).toBe('deny');
    expect(await decision({ tool_name: 'Edit', tool_input: { file_path: '/x/notes/a.md', old_string: 'a', new_string: 'agentWrites' } })).toBe('allow');
  });
});
