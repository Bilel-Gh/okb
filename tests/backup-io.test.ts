import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const injected = vi.hoisted(() => ({ fault: null as { operation: 'readFile' | 'stat' | 'readdir'; path: string; code: 'EACCES' | 'EIO' | 'ENOENT' } | null }));
vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const check = (operation: string, path: unknown) => {
    if (injected.fault?.operation === operation && String(path) === injected.fault.path) throw Object.assign(new Error('injected I/O failure'), { code: injected.fault.code });
  };
  return {
    ...real,
    readFile: async (...args: Parameters<typeof real.readFile>) => { check('readFile', args[0]); return real.readFile(...args); },
    stat: async (...args: Parameters<typeof real.stat>) => { check('stat', args[0]); return real.stat(...args); },
    readdir: async (...args: Parameters<typeof real.readdir>) => { check('readdir', args[0]); return real.readdir(...args); },
  };
});

import { runBackup, verifyBackup } from '../src/brain/backup.js';
import { closeDbs } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => { injected.fault = null; closeDbs(); });
const DAY = new Date('2027-03-01T09:00:00Z');
describe('backup source read failures retain the last complete snapshot', () => {
  it.each(['EACCES', 'EIO', 'ENOENT'] as const)('fails for a listed note that cannot be read (%s), without replacing the old snapshot', async (code) => {
    const { config, env, kb } = await demoBrain();
    const made = await runBackup(config, { now: DAY, env });
    const manifest = await readFile(resolve(made.info.path, 'manifest.json'));
    injected.fault = { operation: 'readFile', path: resolve(kb, 'Accueil.md'), code };
    await expect(runBackup(config, { now: DAY, force: true, env })).rejects.toMatchObject({ code: 'E_IO' });
    injected.fault = null;
    expect(await readFile(resolve(made.info.path, 'manifest.json'))).toEqual(manifest);
    expect(await verifyBackup(config, '2027-03-01', env)).toMatchObject({ bad: [], missing: [] });
    expect((await readdir(resolve(made.info.path, '..'))).filter((n) => /partial|previous/.test(n))).toEqual([]);
  });
  it.each(['EACCES', 'EIO'] as const)('refuses an unreadable notes directory (%s), rather than capturing an empty KB', async (code) => {
    const { config, env, kb } = await demoBrain();
    const made = await runBackup(config, { now: DAY, env });
    const manifest = await readFile(resolve(made.info.path, 'manifest.json'));
    injected.fault = { operation: 'readdir', path: kb, code };
    await expect(runBackup(config, { now: DAY, force: true, env })).rejects.toMatchObject({ code: 'E_IO' });
    injected.fault = null;
    expect(await readFile(resolve(made.info.path, 'manifest.json'))).toEqual(manifest);
  });
  it('requires the notes root even when it is missing', async () => {
    const { config, env, kb } = await demoBrain();
    injected.fault = { operation: 'stat', path: kb, code: 'ENOENT' };
    await expect(runBackup(config, { now: DAY, env })).rejects.toMatchObject({ code: 'E_IO' });
  });
  it.each(['EACCES', 'EIO'] as const)('refuses an inaccessible state root (%s), while tolerating an initially absent state', async (code) => {
    const { config, env } = await demoBrain();
    injected.fault = { operation: 'stat', path: statePaths(config).root, code };
    await expect(runBackup(config, { now: DAY, env })).rejects.toMatchObject({ code: 'E_IO' });
    injected.fault = null;
    closeDbs(); await rm(statePaths(config).root, { recursive: true, force: true });
    const made = await runBackup(config, { now: DAY, env });
    const manifest = JSON.parse(await readFile(resolve(made.info.path, 'manifest.json'), 'utf8')) as { files: Record<string, unknown> };
    expect(Object.keys(manifest.files).some((key) => key.startsWith('state/'))).toBe(false);
    expect(Object.keys(manifest.files).some((key) => key.startsWith('kb/'))).toBe(true);
  });
  it.each(['EACCES', 'EIO', 'ENOENT'] as const)('fails if an existing state cannot be traversed (%s), rather than treating it as initially absent', async (code) => {
    const { config, env } = await demoBrain();
    await mkdir(statePaths(config).root, { recursive: true });
    const made = await runBackup(config, { now: DAY, env });
    const manifest = await readFile(resolve(made.info.path, 'manifest.json'));
    injected.fault = { operation: 'readdir', path: statePaths(config).root, code };
    await expect(runBackup(config, { now: DAY, force: true, env })).rejects.toMatchObject({ code: 'E_IO' });
    injected.fault = null;
    expect(await readFile(resolve(made.info.path, 'manifest.json'))).toEqual(manifest);
  });
  it.each(['EACCES', 'EIO'] as const)('refuses inaccessible profile settings (%s), and preserves the previous complete day', async (code) => {
    const { config, env } = await demoBrain();
    const made = await runBackup(config, { now: DAY, env });
    const manifest = await readFile(resolve(made.info.path, 'manifest.json'));
    injected.fault = { operation: 'readFile', path: resolve(env.OKB_HOME!, 'profiles', config.profile.id, 'profile.yaml'), code };
    await expect(runBackup(config, { now: DAY, force: true, env })).rejects.toMatchObject({ code: 'E_IO' });
    injected.fault = null;
    expect(await readFile(resolve(made.info.path, 'manifest.json'))).toEqual(manifest);
  });
  it('tolerates absent profile settings only for ENOENT', async () => {
    const { config, env } = await demoBrain();
    injected.fault = { operation: 'readFile', path: resolve(env.OKB_HOME!, 'profiles', config.profile.id, 'profile.yaml'), code: 'ENOENT' };
    const made = await runBackup(config, { now: DAY, env });
    injected.fault = null;
    const manifest = JSON.parse(await readFile(resolve(made.info.path, 'manifest.json'), 'utf8')) as { files: Record<string, unknown> };
    expect(manifest.files['profile/profile.yaml']).toBeUndefined();
    expect(Object.keys(manifest.files).some((key) => key.startsWith('kb/'))).toBe(true);
  });
});
