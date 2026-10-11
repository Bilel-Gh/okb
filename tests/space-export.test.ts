import { createRequire } from 'node:module';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { demoBrain } from './helpers/brain.js';
import { closeDbs } from '../src/state/db.js';
import { sha256 } from '../src/util/hash.js';
import { runBackup, verifyBackup } from '../src/brain/backup.js';

afterEach(() => closeDbs());
describe('complete portable export (F3.0-05)', () => {
  it('pins both simultaneous exports while another caller refreshes the same daily snapshot', async () => {
    const { config, env, dir } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const targets = [resolve(dir, 'export-one'), resolve(dir, 'export-two')];
    const results = await Promise.all([
      ...targets.map((folder) => invoke('space.export', { folder }, ctx)),
      runBackup(config, { force: true, env }),
    ]);
    expect(results.slice(0, 2)).toEqual(expect.arrayContaining([expect.objectContaining({ verified: true })]));
    for (const target of targets) {
      const manifest = JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string }> };
      for (const [key, expected] of Object.entries(manifest.files)) expect(sha256(await readFile(resolve(target, key)))).toBe(expected.sha256);
    }
    expect(await verifyBackup(config, undefined, env)).toMatchObject({ bad: [], missing: [] });
  });
  it('exports the consistent state and settings as well as notes, verifies every byte, and leaves out the approval key', async () => {
    const { config, env, dir } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Projet à conserver' }, ctx);
    await invoke('actions.add', { text: 'Première étape', project: project.id }, ctx);
    const conversation = await invoke('assistant.start', {}, ctx);
    const target = resolve(dir, 'export');
    expect(await invoke('space.export', { folder: target }, ctx)).toMatchObject({ verified: true, format: 'okb-backup-v1' });
    const manifest = JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string }> };
    expect(Object.keys(manifest.files)).toContain('state/okb.db');
    expect(Object.keys(manifest.files)).toContain('profile/profile.yaml');
    expect(Object.keys(manifest.files).some((p) => p.includes('approval.key') || /okb\.db-(wal|shm)$/.test(p))).toBe(false);
    for (const [key, expected] of Object.entries(manifest.files)) expect(sha256(await readFile(resolve(target, key)))).toBe(expected.sha256);
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(resolve(target, 'state/okb.db'), { readOnly: true });
    try {
      expect(db.prepare('SELECT title FROM projects WHERE id=?').get(project.id)).toMatchObject({ title: 'Projet à conserver' });
      expect(db.prepare('SELECT id FROM assistant_conversations WHERE id=?').get(conversation.conversation.id)).toBeTruthy();
      expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    } finally { db.close(); }
  });
  it('refuses nonempty destinations, physical paths into the brain and an agent request', async () => {
    const { config, env, dir, kb } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const foreign = resolve(dir, 'foreign'); await writeFile(foreign, 'Keep me');
    await expect(invoke('space.export', { folder: foreign }, ctx)).rejects.toMatchObject({ code: 'E_CONFLICT' });
    await symlink(kb, resolve(dir, 'alias'));
    await expect(invoke('space.export', { folder: resolve(dir, 'alias', 'export') }, ctx)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
    await expect(invoke('space.export', { folder: resolve(dir, 'export') }, { ...ctx, actor: 'agent' })).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    expect(await readFile(foreign, 'utf8')).toBe('Keep me');
  });
});
