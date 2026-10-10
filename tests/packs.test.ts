import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { comparePack, exportPack, mergePack, type Pack } from '../src/packs/pack.js';
import { demoBrain } from './helpers/brain.js';

const FOLDER = '2 Produits/Atlas/Code/atlas-api';

describe('sharing a pack of knowledge without a server (roadmap §6, step 1)', () => {
  it('exports a subject: its notes, who wrote them, never a 🔒 note', async () => {
    const { config, kb } = await demoBrain();
    await writeFile(resolve(kb, FOLDER, 'Secret.md'), '---\ntype: Guide\ntitle: Secret\ndescription: x\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  confidentiality: secret\n---\n\n# Secret\n\nNe sort pas.\n');
    const pack = await exportPack(config, await loadBundleFor(config), FOLDER);
    expect(pack).toMatchObject({ kind: 'okb-pack', v: 1, subject: FOLDER });
    expect(pack.notes.length).toBeGreaterThan(3);
    expect(pack.notes.some((n) => n.path === 'Secret.md')).toBe(false);
    expect(pack.skipped).toEqual([{ path: 'Secret.md', reason: 'secret' }]);
    expect(pack.notes.every((n) => !n.path.startsWith(FOLDER))).toBe(true);
    expect(pack.from.person).toMatch(/^p-[a-z0-9]{10}$/);
  }, 60_000);

  it('compares a pack with the brain: what is new, the same, or different', async () => {
    const { config, kb } = await demoBrain();
    const pack: Pack = await exportPack(config, await loadBundleFor(config), FOLDER);
    // A colleague's pack: one note more, one note changed.
    const theirs: Pack = { ...pack, notes: [...pack.notes.map((n, i) => (i === 0 ? { ...n, content: `${n.content}\nUn ajout du collègue.\n` } : n)), { path: 'Piège du cache.md', title: 'Piège du cache', content: '---\ntype: Guide\ntitle: Piège du cache\ndescription: Le cache garde l’ancienne config.\nstatus: stable\ngenerated:\n  by: human:collegue\n  at: 2026-09-01T10:00:00Z\n---\n\n# Piège du cache\n\nVider le cache après un changement de config.\n' }] };
    const diff = comparePack(await loadBundleFor(config), theirs, FOLDER);
    expect(diff.added.map((n) => n.path)).toEqual(['Piège du cache.md']);
    expect(diff.changed.map((n) => n.path)).toEqual([pack.notes[0]!.path]);
    expect(diff.same).toBe(pack.notes.length - 1);
    void kb;
  }, 60_000);

  it('merges what is missing through a proposal, keeping the original author, writing nothing yet', async () => {
    const { config, kb } = await demoBrain();
    const pack: Pack = await exportPack(config, await loadBundleFor(config), FOLDER);
    const theirs: Pack = { ...pack, notes: [...pack.notes, { path: 'Piège du cache.md', title: 'Piège du cache', content: '---\ntype: Guide\ntitle: Piège du cache\ndescription: Le cache garde l’ancienne config.\nstatus: stable\ngenerated:\n  by: human:collegue\n  at: 2026-09-01T10:00:00Z\n---\n\n# Piège du cache\n\nVider le cache après un changement de config.\n' }] };
    const proposal = await mergePack(config, theirs, FOLDER);
    expect(proposal.changes.map((c) => c.path)).toEqual([`${FOLDER}/Piège du cache.md`]);
    const { materializeFile } = await import('../src/proposal/materialize.js');
    const content = materializeFile(proposal.changes[0]!.path, null, proposal.changes);
    expect(content).toContain('by: human:collegue');
    expect(content).toMatch(/pack:/);
    expect(await readdir(resolve(kb, FOLDER))).not.toContain('Piège du cache.md');
  }, 60_000);

  it('refuses a file that is not a pack', async () => {
    const { config } = await demoBrain();
    await expect(mergePack(config, { kind: 'other' } as unknown as Pack, FOLDER)).rejects.toMatchObject({ key: 'packInvalid' });
  }, 60_000);
});

describe('okb pack', () => {
  it('exports to a file, then compares it', async () => {
    const { json } = await import('./helpers/team.js');
    const { env, dir } = await demoBrain();
    const out = resolve(dir, 'atlas-api.okbpack.json');
    const e = await json(['pack', 'export', FOLDER, '--out', out], env, dir);
    expect(e).toMatchObject({ ok: true, file: out });
    expect(JSON.parse(await readFile(out, 'utf8')).kind).toBe('okb-pack');
    const c = await json(['pack', 'compare', out, '--into', FOLDER], env, dir);
    expect(c).toMatchObject({ ok: true, added: [], changed: [] });
    void mkdir;
  }, 60_000);
});

describe('packs in the web app', () => {
  it('exports a subject, compares a received pack with the differences line by line, and merges through a proposal', async () => {
    const { serve } = await import('../src/web/serve.js');
    const { config, env } = await demoBrain();
    const { server, url } = await serve(config, { port: 0, env });
    try {
      const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
      const post = (path: string, body: unknown, withToken = true) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(withToken ? { 'X-OKB-Token': token } : {}) }, body: JSON.stringify(body) });
      const pack = (await (await fetch(`${url}/api/packs/export?folder=${encodeURIComponent(FOLDER)}`)).json()) as Pack;
      expect(pack).toMatchObject({ kind: 'okb-pack', subject: FOLDER });
      const theirs: Pack = { ...pack, notes: [...pack.notes.map((n, i) => (i === 0 ? { ...n, content: `${n.content}\nUn ajout du collègue.\n` } : n)), { path: 'Piège du cache.md', title: 'Piège du cache', content: '---\ntitle: Piège du cache\ndescription: x\nstatus: stable\ngenerated:\n  by: human:collegue\n  at: 2026-09-01T10:00:00Z\n---\n\n# Piège du cache\n\nVider le cache.\n' }] };
      expect((await post('/api/packs/compare', { pack: theirs }, false)).status).toBe(403);
      const diff = (await (await post('/api/packs/compare', { pack: theirs })).json()) as { into: string; added: { path: string }[]; changed: { path: string; diff: string }[]; same: number; from: { brain: string } };
      expect(diff.into).toBe(FOLDER);
      expect(diff.added.map((n) => n.path)).toEqual(['Piège du cache.md']);
      expect(diff.changed[0]!.diff).toContain('+Un ajout du collègue.');
      expect(diff.same).toBe(pack.notes.length - 1);
      const merged = (await (await post('/api/packs/merge', { pack: theirs, into: FOLDER })).json()) as { ok: boolean; proposalId: string };
      expect(merged.ok).toBe(true);
      expect(merged.proposalId).toMatch(/^p-/);
      expect((await (await post('/api/packs/compare', { pack: { kind: 'other' } })).json())).toMatchObject({ error: expect.anything() });
    } finally {
      server.closeAllConnections(); server.close();
    }
  }, 90_000);
});

describe('the person behind a pack (review M12)', () => {
  it('is the person of the OKB home in use, not of the process', async () => {
    const { person } = await import('../src/identity/person.js');
    const { config, env } = await demoBrain();
    const pack = await exportPack(config, await loadBundleFor(config), FOLDER, new Date(), env);
    expect(pack.from.person).toBe((await person(env)).id);
  }, 60_000);
});

describe('the defects of the 9 October review (F2.0-38)', () => {
  it('a pack already merged and unchanged is the same, even exported again later', async () => {
    const { config, kb } = await demoBrain();
    const pack: Pack = await exportPack(config, await loadBundleFor(config), FOLDER);
    const note = { path: 'Piège du cache.md', title: 'Piège du cache', content: '---\ntype: Guide\ntitle: Piège du cache\ndescription: Le cache garde l’ancienne config.\nstatus: stable\ngenerated:\n  by: human:collegue\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  id: n-collegue-1\n---\n\n# Piège du cache\n\nVider le cache après un changement de config.\n' };
    const theirs: Pack = { ...pack, notes: [...pack.notes, note] };
    const proposal = await mergePack(config, theirs, FOLDER);
    const { materializeFile } = await import('../src/proposal/materialize.js');
    // The merge applied: the note is in the brain with where it came from.
    await writeFile(resolve(kb, FOLDER, 'Piège du cache.md'), materializeFile(proposal.changes[0]!.path, null, proposal.changes)!);
    const again = comparePack(await loadBundleFor(config), theirs, FOLDER);
    expect(again.changed.map((n) => n.path)).toEqual([]);
    expect(again.added.map((n) => n.path)).toEqual([]);
    const later = comparePack(await loadBundleFor(config), { ...theirs, exportedAt: '2026-12-01T10:00:00Z' }, FOLDER);
    expect(later.changed.map((n) => n.path)).toEqual([]);
  }, 60_000);
});
