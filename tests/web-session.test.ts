import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  await saveProposal(c, p); await keepProposal(c, p.id, 'agent', s.env);
  const env = { ...s.env, OKB_NO_DIALOG: '1' };
  const started = await serve(c, { port: 0, env });
  stops.push(started.shutdown);
  const token = (await (await fetch(`${started.url}/api/session`)).json() as { token: string }).token;
  const post = (path: string, body: unknown, cookie?: string) => fetch(`${started.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-okb-token': token, origin: started.url, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { config: c, started, post };
}

describe('saying yes in the app, without a dialog or a terminal (F2.0-56, D71)', () => {
  it('gives the browser it opens a key, once', async () => {
    const { started } = await app();
    const link = started.openUrl();
    const first = await fetch(link, { redirect: 'manual' });
    expect(first.status).toBe(302);
    expect(first.headers.get('set-cookie')).toMatch(/okb_presence=[a-f0-9]+;.*HttpOnly.*SameSite=Strict/i);
    const again = await fetch(link, { redirect: 'manual' });
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('validates with the key, and falls back to the person’s confirmation without it', async () => {
    const { config, started, post } = await app();
    const without = await (await post('/api/review/validate', { paths: ['n/a.md'] })).json() as { ok: boolean; presence: string };
    expect(without).toMatchObject({ ok: false, presence: 'unavailable' });
    expect(reviewOf(config, 'n/a.md')?.state).toBe('pending');
    const cookie = (await fetch(started.openUrl(), { redirect: 'manual' })).headers.get('set-cookie')!.split(';')[0]!;
    const withKey = await (await post('/api/review/validate', { paths: ['n/a.md'] }, cookie)).json() as { ok: boolean };
    expect(withKey.ok).toBe(true);
    expect(reviewOf(config, 'n/a.md')?.state).toBe('validated');
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
});
