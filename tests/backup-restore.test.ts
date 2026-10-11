import { createRequire } from 'node:module';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupStatus, drillRestore, listBackups, restoreBackup, runBackup } from '../src/brain/backup.js';
import { loadConfig } from '../src/config/load.js';
import type { OkbConfig } from '../src/config/schema.js';
import { invoke } from '../src/engine/registry.js';
import { writeRootConfig } from '../src/kb/registry.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);
const DAY1 = new Date('2027-03-01T09:00:00Z');

/** A brain someone works in: a project, an action, a line of journal, a document. */
async function lived() {
  const brain = await demoBrain();
  const ctx = { config: brain.config, env: brain.env, actor: 'person' as const };
  const project = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
  await invoke('actions.add', { text: 'Réserver le car', project: project.id, due: '2027-05-15' }, ctx);
  await invoke('journal.add', { text: 'Le devis du transporteur est arrivé.', project: project.id }, ctx);
  await invoke('documents.add', { name: 'devis.txt', data: Buffer.from('Le car coûte 480 euros.').toString('base64'), project: project.id }, ctx);
  return { ...brain, ctx, project };
}
const lifeOf = async (config: OkbConfig, env: NodeJS.ProcessEnv) => {
  const ctx = { config, env, actor: 'person' as const };
  return {
    projects: (await invoke('projects.list', { status: 'all' }, ctx)).projects.filter((p) => p.kind === 'subject').map((p) => p.title),
    actions: (await invoke('actions.list', {}, ctx)).actions.map((a) => [a.text, a.due]),
    journal: (await invoke('journal.list', { limit: 20 }, ctx)).entries.map((e) => e.text).sort(),
    documents: (await invoke('documents.list', { query: 'euros' }, ctx)).documents.map((d) => d.title),
    notes: (await invoke('notes.find', { query: 'Atlas', limit: 3 }, ctx)).hits.length,
  };
};

describe('a backup that brings everything back (F2.0-14)', () => {
  it('a snapshot holds the notes, the documents, the settings and a whole copy of the state, taken while it is in use', async () => {
    const { config, env } = await lived();
    const made = await runBackup(config, { env, now: DAY1 });
    const manifest = JSON.parse(await readFile(resolve(made.info.path, 'manifest.json'), 'utf8')) as { files: Record<string, unknown>; counts: Record<string, number> };
    const keys = Object.keys(manifest.files);
    expect(keys).toEqual(expect.arrayContaining(['state/okb.db', 'profile/profile.yaml']));
    expect(keys.some((k) => /^kb\/_Documents\/\d{4}\/devis\.txt$/.test(k))).toBe(true);
    // The database is copied whole, not as the three files of a database in use; the approval key never leaves.
    expect(keys.filter((k) => /okb\.db-(wal|shm)$|approval\.key$/.test(k))).toEqual([]);
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const copy = new DatabaseSync(resolve(made.info.path, 'state/okb.db'), { readOnly: true });
    expect((copy.prepare('SELECT title FROM projects WHERE kind = ?').all('subject') as { title: string }[]).map((r) => r.title)).toEqual(['Sortie de juin']);
    expect((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
    copy.close();
    expect(manifest.counts).toMatchObject({ documents: 1, actions: 1 });
    expect(manifest.counts.notes).toBeGreaterThan(20);
    expect(manifest.counts.projects).toBeGreaterThanOrEqual(1);
  });

  it('restored as a new brain, it gives back the notes, the documents, the projects, the actions and the journal', async () => {
    const { config, env, dir, kb } = await lived();
    const before = await lifeOf(config, env);
    await runBackup(config, { env, now: DAY1 });
    const restored = await restoreBackup(config, '2027-03-01', resolve(dir, 'retour'), env, { as: 'retour' });
    expect(restored).toMatchObject({ to: resolve(dir, 'retour'), profile: 'retour' });
    closeDbs();
    const { config: back } = await loadConfig({ env, profileId: 'retour' });
    expect(back.kb.root).toBe(resolve(dir, 'retour'));
    expect(back.kb.brain?.preset).toBe('work');
    expect(await lifeOf(back, env)).toEqual(before);
    expect(before).toMatchObject({ projects: ['Sortie de juin'], actions: [['Réserver le car', '2027-05-15']], documents: ['devis'] });
    // The brain that was backed up is as it was, and a restore never lands on a brain that exists.
    expect((await readdir(kb)).length).toBeGreaterThan(3);
    expect((await failure(restoreBackup(config, '2027-03-01', resolve(dir, 'autre'), env, { as: 'travail' }))).key).toBe('backupProfileExists');
  });

  it('the drill restores the last snapshot somewhere temporary, checks what came back, and leaves nothing behind', async () => {
    const { config, env } = await lived();
    await runBackup(config, { env, now: DAY1 });
    const before = (await readdir(tmpdir())).filter((n) => n.startsWith('okb-drill-'));
    const drill = await drillRestore(config, env, DAY1);
    expect(drill).toMatchObject({ ok: true, date: '2027-03-01', problems: [], documents: 1, actions: 1 });
    expect(drill.notes).toBeGreaterThan(20);
    expect((await readdir(tmpdir())).filter((n) => n.startsWith('okb-drill-'))).toEqual(before);
    expect((await backupStatus(config, env, DAY1)).drilledAt).toBe(DAY1.toISOString());
  });

  it('the drill says what is wrong when a snapshot was damaged', async () => {
    const { config, env } = await lived();
    const made = await runBackup(config, { env, now: DAY1 });
    await appendFile(resolve(made.info.path, 'kb/Accueil.md'), '\ncorrompu\n');
    const drill = await drillRestore(config, env, DAY1);
    expect(drill.ok).toBe(false);
    expect(drill.problems.join(' ')).toContain('kb/Accueil.md');
  });

  it('a backup is due once a day, for the app as for the terminal, unless the person turned it off', async () => {
    const { config, env } = await lived();
    const { backupDue } = await import('../src/brain/backup.js');
    expect(await backupDue(config, env, DAY1)).toBe(true);
    await runBackup(config, { env, now: DAY1 });
    expect(await backupDue(config, env, new Date('2027-03-01T20:00:00Z'))).toBe(false);
    expect(await backupDue(config, env, new Date('2027-03-02T06:00:00Z'))).toBe(true);
    await writeRootConfig((root) => ({ ...root, backup: { enabled: false } }), env);
    expect(await backupDue(config, env, new Date('2027-03-05T06:00:00Z'))).toBe(false);
  });

  it('says plainly where the backup stands: never, today, late, off', async () => {
    const { config, env } = await lived();
    expect(await backupStatus(config, env, DAY1)).toMatchObject({ state: 'never', last: null, drilledAt: null });
    await runBackup(config, { env, now: DAY1 });
    expect(await backupStatus(config, env, new Date('2027-03-01T15:00:00Z'))).toMatchObject({ state: 'ok', last: { date: '2027-03-01' } });
    expect((await backupStatus(config, env, new Date('2027-03-04T15:00:00Z'))).state).toBe('late');
    await writeRootConfig((root) => ({ ...root, backup: { enabled: false } }), env);
    expect((await backupStatus(config, env, DAY1)).state).toBe('off');
    expect((await listBackups(config, env)).length).toBe(1);
  });

  it('the same from the terminal, the app and for an assistant; the day’s screen says where the backup stands', async () => {
    const { config, env, dir, ctx } = await lived();
    const { json } = await import('./helpers/team.js');
    expect((await invoke('today.view', {}, ctx)).backup).toEqual({ state: 'never', date: null });
    closeDbs();
    expect((await json(['backup', 'run'], env, dir)).created).toBe(true);
    const drill = await json(['backup', 'drill'], env, dir);
    expect(drill).toMatchObject({ ok: true, problems: [], documents: 1 });
    const status = await invoke('backup.status', {}, { ...ctx, actor: 'agent' });
    expect(status).toMatchObject({ state: 'ok', drillOk: true });
    expect((await invoke('today.view', {}, ctx)).backup.state).toBe('ok');
    const date = status.last!.date;
    const back = await json(['backup', 'restore', date, '--to', resolve(dir, 'retour'), '--as', 'retour'], env, dir);
    expect(back).toMatchObject({ ok: true, profile: 'retour' });
    expect((await json(['project', 'list', '--kb', 'retour'], env, dir)).projects.map((p: { title: string }) => p.title)).toContain('Sortie de juin');
  });

  it('a restore never tried is said, and one that failed is an error to look at', async () => {
    const { config, env } = await lived();
    const { checkIntegrity } = await import('../src/brain/integrity.js');
    const { loadBundleFor } = await import('../src/kb/bundle.js');
    const codes = async (now: Date) => (await checkIntegrity(config, await loadBundleFor(config), { env, disk: false, now })).filter((f) => f.code === 'untested-restore').map((f) => f.level);
    const made = await runBackup(config, { env, now: DAY1 });
    expect(await codes(DAY1)).toEqual(['info']);
    await drillRestore(config, env, DAY1);
    expect(await codes(DAY1)).toEqual([]);
    expect(await codes(new Date('2027-04-20T09:00:00Z'))).toEqual(['info']);
    await appendFile(resolve(made.info.path, 'kb/Accueil.md'), '\ncorrompu\n');
    await drillRestore(config, env, DAY1);
    expect(await codes(DAY1)).toEqual(['error']);
  });
});

