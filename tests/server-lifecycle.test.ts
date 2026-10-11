import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as backups from '../src/brain/backup.js';
import { loadConfig } from '../src/config/load.js';
import { closeDbs } from '../src/state/db.js';
import { serve } from '../src/web/server.js';
import { demoBrain } from './helpers/brain.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  closeDbs(); vi.restoreAllMocks();
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function app() {
  const brain = await demoBrain();
  const running = await serve(brain.config, { port: 0, env: brain.env });
  cleanups.push(running.shutdown);
  const token = ((await (await fetch(`${running.url}/api/session`)).json()) as { token: string }).token;
  return { ...brain, ...running, token, post: (path: string, body: unknown) => fetch(`${running.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify(body) }) };
}
function scheduledBackup(timers: ReturnType<typeof vi.spyOn<typeof globalThis, 'setTimeout'>>) {
  const call = timers.mock.calls.filter((args) => args[1] === 30_000).at(-1);
  expect(call).toBeTruthy();
  return call![0] as () => void;
}

describe('server jobs and first-run snapshots', () => {
  it('schedules the first space created after serve(null), without restarting the app', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'okb-server-first-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), HOME: dir, OKB_PROFILE: '', OKB_AI: 'none' };
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const running = await serve(null, { port: 0, env }); cleanups.push(running.shutdown);
    const token = ((await (await fetch(`${running.url}/api/session`)).json()) as { token: string }).token;
    const response = await fetch(`${running.url}/api/onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify({ profile: 'other', name: 'Mes activités', project: 'Organiser une sortie', language: 'fr', folder: resolve(dir, 'notes') }) });
    expect(response.status).toBe(200);
    const result = await response.json() as { id: string };
    const { config } = await loadConfig({ env, profileId: result.id });
    expect(await backups.listBackups(config, env)).toEqual([]);
    scheduledBackup(timers)();
    await running.shutdown();
    expect((await backups.listBackups(config, env)).length).toBe(1);
    expect(await backups.verifyBackup(config, undefined, env)).toMatchObject({ bad: [], missing: [] });
  });
  it('stops accepting requests and waits for an already-started state handler before resolving shutdown', async () => {
    const current = await app();
    const entered = deferred(), release = deferred();
    const realBackup = backups.runBackup;
    vi.spyOn(backups, 'runBackup').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return realBackup(...args); });
    cleanups.push(async () => { release.resolve(); });
    const request = current.post('/api/backup/run', {});
    await entered.promise;
    const stopping = current.shutdown(); let stopped = false; void stopping.then(() => { stopped = true; });
    await nextTurn(); expect(stopped).toBe(false);
    const next = await fetch(`${current.url}/api/status`).then((r) => r.status, () => 503);
    expect(next).toBe(503);
    release.resolve();
    expect((await request).status).toBe(200);
    await stopping;
    expect(await backups.verifyBackup(current.config, undefined, current.env)).toMatchObject({ bad: [], missing: [] });
    expect(current.shutdown()).toBe(stopping);
  });
  it('follows an active-space switch while keeping the explicitly served space covered', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const current = await app();
    const original = await backups.runBackup(current.config, { env: current.env });
    const setup = await current.post('/api/onboarding', { profile: 'other', name: 'Personnel', project: 'Organiser une sortie', language: 'fr', folder: resolve(current.dir, 'personal-notes') });
    expect(setup.status).toBe(200);
    const { id } = await setup.json() as { id: string };
    expect((await current.post('/api/kb/switch', { id: current.config.profile.id })).status).toBe(200);
    expect((await current.post('/api/kb/switch', { id })).status).toBe(200);
    const { config: selected } = await loadConfig({ env: current.env, profileId: id });
    expect(await backups.listBackups(selected, current.env)).toEqual([]);
    scheduledBackup(timers)(); await current.shutdown();
    expect((await backups.listBackups(selected, current.env)).length).toBe(1);
    expect((await backups.listBackups(current.config, current.env))[0]!.createdAt).toBe(original.info.createdAt);
  });
  it('waits for a background snapshot even after the HTTP server has closed', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const current = await app();
    const entered = deferred(), release = deferred();
    const realBackup = backups.runBackup;
    vi.spyOn(backups, 'runBackup').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return realBackup(...args); });
    cleanups.push(async () => { release.resolve(); });
    scheduledBackup(timers)(); await entered.promise;
    const stopping = current.shutdown(); let stopped = false; void stopping.then(() => { stopped = true; });
    await nextTurn(); expect(stopped).toBe(false);
    release.resolve(); await stopping;
    expect((await backups.listBackups(current.config, current.env)).length).toBe(1);
  });
  it('cancels an incomplete request body before any operation instead of waiting for the body timeout', async () => {
    const current = await app();
    const accepted = new Promise<void>((done) => current.server.once('request', () => done()));
    const req = request(`${current.url}/api/backup/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': current.token, 'Content-Length': '100000' } });
    const failed = new Promise<void>((done) => req.once('error', () => done()));
    req.write('{"force":');
    await accepted;
    await current.shutdown(); await failed;
    expect(await backups.listBackups(current.config, current.env)).toEqual([]);
  });
});
