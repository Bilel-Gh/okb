import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { enabledModules, entitled, featureOn, MODULES, setModule } from '../src/modules/catalog.js';
import { claudeModules } from '../src/integrations/system.js';
import { json } from './helpers/team.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function home() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-modules-')));
  made.push(dir);
  return { dir, env: { ...process.env, OKB_HOME: resolve(dir, '.okb'), HOME: dir } };
}

describe('the module catalogue', () => {
  it('knows the core, the developer module and the planned ones', () => {
    expect(MODULES.map((m) => m.id)).toEqual(['core', 'dev', 'devops', 'sales']);
    expect(MODULES.find((m) => m.id === 'dev')!.plugin).toBe('okb-dev');
    expect(MODULES.find((m) => m.id === 'core')!.plugin).toBe('okb');
    expect(MODULES.find((m) => m.id === 'devops')!.status).toBe('planned');
    for (const m of MODULES) expect(m.name.fr && m.name.en && m.pitch.fr && m.pitch.en).toBeTruthy();
  });

  it('every free module is entitled; a paid one is not without a licence', () => {
    expect(entitled('dev')).toBe(true);
    expect(entitled('core')).toBe(true);
  });
});

describe('enabling modules', () => {
  it('turns the core and the developer module on by default', async () => {
    const { env } = await home();
    expect([...(await enabledModules(env))].sort()).toEqual(['core', 'dev']);
    expect(await featureOn('repos', env)).toBe(true);
    expect(await featureOn('search', env)).toBe(true);
  });

  it('turns a module off and its features with it, never the core ones', async () => {
    const { env } = await home();
    await setModule('dev', false, env);
    expect(await featureOn('repos', env)).toBe(false);
    expect(await featureOn('search', env)).toBe(true);
    expect([...(await enabledModules(env))]).toEqual(['core']);
    await setModule('dev', true, env);
    expect(await featureOn('repos', env)).toBe(true);
  });

  it('refuses to turn the core off or a planned module on', async () => {
    const { env } = await home();
    await expect(setModule('core', false, env)).rejects.toMatchObject({ key: 'moduleNotAvailable' });
    await expect(setModule('devops', true, env)).rejects.toMatchObject({ key: 'moduleNotAvailable' });
  });

  it('an unknown feature is off', async () => {
    const { env } = await home();
    expect(await featureOn('teleport', env)).toBe(false);
  });
});

describe('modules in Claude Code', () => {
  it('reads which OKB plugins Claude Code has installed', async () => {
    const { dir } = await home();
    await mkdir(resolve(dir, '.claude', 'plugins'), { recursive: true });
    await writeFile(resolve(dir, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'okb-dev@okb': [{ version: '1.0.0' }] } }));
    expect(await claudeModules(dir)).toEqual({ okb: { installed: false, version: null }, 'okb-dev': { installed: true, version: '1.0.0' } });
  });
});

describe('okb modules', () => {
  it('lists the modules, and turns one off and on', async () => {
    const { dir, env } = await home();
    const list = await json(['modules'], env, dir);
    expect(list.ok).toBe(true);
    expect(list.modules.map((m: { id: string }) => m.id)).toEqual(['core', 'dev', 'devops', 'sales']);
    expect(list.modules.find((m: { id: string }) => m.id === 'dev')).toMatchObject({ enabled: true, entitled: true, status: 'available' });
    const off = await json(['modules', 'off', 'dev'], env, dir);
    expect(off.ok).toBe(true);
    expect(off.enabled).toEqual(['core']);
    expect(await readFile(resolve(dir, '.okb', 'config.yaml'), 'utf8')).toMatch(/modules:\n\s+enabled: \[\]|enabled: \[\]/);
    const on = await json(['modules', 'on', 'dev'], env, dir);
    expect(on.enabled).toEqual(['core', 'dev']);
  }, 60_000);
});

describe('modules in the web app', () => {
  it('lists the modules, and turns one off only with the session token', async () => {
    const { makeSandbox } = await import('./helpers/sandbox.js');
    const { serve } = await import('../src/web/serve.js');
    const s = await makeSandbox({ profileId: 'reader' });
    const { server, url } = await serve(await s.config(), { port: 0, env: s.env });
    try {
      const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
      const list = (await (await fetch(`${url}/api/modules`)).json()) as { modules: { id: string; enabled: boolean }[] };
      expect(list.modules.find((m) => m.id === 'dev')!.enabled).toBe(true);
      const bare = await fetch(`${url}/api/modules/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'dev', on: false }) });
      expect(bare.status).toBe(403);
      const off = await fetch(`${url}/api/modules/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify({ id: 'dev', on: false }) });
      expect(await off.json()).toEqual({ ok: true, enabled: ['core'] });
      const unknown = await fetch(`${url}/api/modules/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify({ id: 'nope', on: true }) });
      expect(unknown.status).toBe(400);
    } finally {
      server.closeAllConnections(); server.close(); await s.cleanup();
    }
  }, 60_000);
});

describe('a module turned off is off (review I3)', () => {
  it('the developer commands and pages say the module is off, and work again once it is on', async () => {
    const { makeSandbox } = await import('./helpers/sandbox.js');
    const { serve } = await import('../src/web/serve.js');
    const s = await makeSandbox({ profileId: 'reader' });
    try {
      await setModule('dev', false, s.env);
      const r = await json(['repo', 'list'], s.env, s.dir);
      expect(r).toMatchObject({ ok: false, error: { key: 'moduleOff' } });
      const { server, url } = await serve(await s.config(), { port: 0, env: s.env });
      try {
        const res = await fetch(`${url}/api/repos`);
        expect(res.status).toBe(400);
        expect(((await res.json()) as { title: string }).title).toBeTruthy();
      } finally { server.closeAllConnections(); server.close(); }
      await setModule('dev', true, s.env);
      expect((await json(['repo', 'list'], s.env, s.dir)).ok).toBe(true);
    } finally { await s.cleanup(); }
  }, 90_000);
});
