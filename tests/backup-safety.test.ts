import { access, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupRoot, listBackups, restoreBackup, runBackup, verifyBackup } from '../src/brain/backup.js';
import { writeRootConfig } from '../src/kb/registry.js';
import { closeDbs } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const DAY = new Date('2027-03-01T09:00:00Z');
describe('backup publication and physical destinations', () => {
  it('cleans legacy and new interrupted directories under the lock while preserving unrelated entries', async () => {
    const { config, env, dir } = await demoBrain();
    const root = resolve(await backupRoot(env), config.profile.id);
    await mkdir(root, { recursive: true });
    const partials = ['2027-03-01.partial', '2027-03-01.partial-a1B2c3'];
    const unrelated = ['manual.partial', '2027-03-01.partial-report-long'];
    for (const name of [...partials, ...unrelated]) { await mkdir(resolve(root, name)); await writeFile(resolve(root, name, 'half'), 'keep until identified'); }
    const file = '2027-03-01.partial-X1y2Z3'; await writeFile(resolve(root, file), 'unrelated file');
    const outside = resolve(dir, 'outside'); await mkdir(outside); await writeFile(resolve(outside, 'keep'), 'untouched');
    const alias = '2027-03-02.partial'; await symlink(outside, resolve(root, alias), process.platform === 'win32' ? 'junction' : 'dir');
    await runBackup(config, { now: DAY, env });
    expect((await readdir(root)).sort()).toEqual(['2027-03-01', ...unrelated, file, alias].sort());
    expect(await readFile(resolve(outside, 'keep'), 'utf8')).toBe('untouched');
  });
  it('serializes forced refreshes without temporary collisions and leaves a verified snapshot', async () => {
    const { config, env } = await demoBrain();
    const results = await Promise.all(Array.from({ length: 3 }, () => runBackup(config, { force: true, now: DAY, env })));
    expect(results.every((r) => r.created)).toBe(true);
    expect(await verifyBackup(config, '2027-03-01', env)).toMatchObject({ bad: [], missing: [] });
    expect((await readdir(resolve(await backupRoot(env), config.profile.id))).filter((n) => /partial|previous|\.lock$/.test(n))).toEqual([]);
  });
  it('recovers the retained previous snapshot if publication was interrupted between the renames', async () => {
    const { config, env } = await demoBrain();
    const first = await runBackup(config, { now: DAY, env });
    const original = await readFile(resolve(first.info.path, 'manifest.json'));
    await rename(first.info.path, `${first.info.path}.previous`);
    expect((await listBackups(config, env))[0]).toMatchObject({ date: '2027-03-01', path: `${first.info.path}.previous` });
    expect(await verifyBackup(config, '2027-03-01', env)).toMatchObject({ bad: [], missing: [] });
    expect(await readFile(resolve(first.info.path, 'manifest.json'))).toEqual(original);
    await expect(access(`${first.info.path}.previous`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps the current day intact when a new linked snapshot fails verification', async () => {
    const { config, env, dir } = await demoBrain();
    const older = await runBackup(config, { now: new Date('2027-02-28T09:00:00Z'), env });
    const current = await runBackup(config, { now: DAY, env });
    const manifest = await readFile(resolve(current.info.path, 'manifest.json'));
    // Replace the older inode so this corruption does not also alter the newer hardlink.
    const damaged = resolve(dir, 'damaged-note'); await writeFile(damaged, 'damaged old snapshot');
    await rename(damaged, resolve(older.info.path, 'kb/Accueil.md'));
    await expect(runBackup(config, { now: DAY, force: true, env })).rejects.toMatchObject({ code: 'E_IO' });
    expect(await readFile(resolve(current.info.path, 'manifest.json'))).toEqual(manifest);
    expect(await verifyBackup(config, '2027-03-01', env)).toMatchObject({ bad: [], missing: [] });
  });
  it('refuses a restore inside the notes or private state through literal and symlink paths', async () => {
    const { config, env, dir, kb } = await demoBrain();
    await runBackup(config, { now: DAY, env });
    await symlink(kb, resolve(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const target of [resolve(kb, 'restored'), resolve(dir, 'alias', 'restored'), resolve(statePaths(config).root, 'restored')]) {
      await expect(restoreBackup(config, '2027-03-01', target, env)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
      await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const outside = resolve(dir, 'outside'); await mkdir(outside);
    await symlink(outside, resolve(dir, 'outside-alias'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await restoreBackup(config, '2027-03-01', resolve(dir, 'outside-alias', 'restored'), env)).toMatchObject({ to: resolve(outside, 'restored') });
  });
  it('refuses recursive backup locations, including aliases, before creating any snapshot', async () => {
    const { config, env, dir, kb } = await demoBrain();
    await symlink(kb, resolve(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const destination of [resolve(kb, 'backups'), resolve(dir, 'alias', 'backups'), resolve(statePaths(config).root, 'backups')]) {
      await writeRootConfig((root) => ({ ...root, backup: { dir: destination } }), env);
      await expect(runBackup(config, { now: DAY, env })).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
      await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
  it('rejects a traversal in an imported manifest before a restore creates files', async () => {
    const { config, env, dir } = await demoBrain();
    const first = await runBackup(config, { now: DAY, env });
    const file = resolve(first.info.path, 'manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.files['kb/../../escaped.md'] = { sha256: 'a'.repeat(64), size: 1 };
    await writeFile(file, JSON.stringify(manifest));
    const target = resolve(dir, 'restored');
    await expect(restoreBackup(config, '2027-03-01', target, env)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
