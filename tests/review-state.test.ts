import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { classifyNotes, pendingList, reviewOf, setReview, validatedShare } from '../src/review/state.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const put = async (root: string, path: string, text: string) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), text); };
const human = (title: string, extra = '') => `---\ntitle: ${title}\ntype: note\ndescription: x\n${extra}---\n\nTexte.\n`;
const generated = (title: string, extra = '') => human(title, `generated:\n  by: agent:claude\n  at: 2026-10-01T00:00:00Z\n${extra}`);

async function receipt(config: Awaited<ReturnType<typeof workKb>>['config'], id: string, by: string, paths: string[]) {
  const dir = statePaths(config).receipts; await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${id}.json`), JSON.stringify({ id, proposalId: id.replace('rcpt-', ''), proposalContentHash: 'x', kbRoot: config.kb.root, profileId: config.profile.id, appliedAt: '2026-10-02T00:00:00Z', appliedBy: by, approval: { approvedBy: by, approvedAt: '2026-10-02T00:00:00Z', mac: '' }, selection: [], dropped: [], results: paths.map((p) => ({ path: p, action: 'created', sha256: 'x' })), backups: {}, beforeHashes: {}, journal: '', complete: true }));
}

describe('which notes are validated (F2.0-53, D71)', () => {
  it('classifies once: approved by the person or written by them is validated, generated without a trace is to review', async () => {
    const { config } = await workKb();
    const root = config.kb.root;
    await put(root, 'a/approuvee.md', generated('Approuvée'));
    await put(root, 'a/perso.md', human('Écrite à la main'));
    await put(root, 'a/sans-trace.md', generated('Sans trace'));
    await put(root, 'a/par-politique.md', generated('Par politique'));
    await receipt(config, 'rcpt-p1', 'human:test', ['a/approuvee.md']);
    await receipt(config, 'rcpt-p2', 'policy:allow-direct', ['a/par-politique.md']);
    const before = await readFile(resolve(root, 'a/sans-trace.md'), 'utf8');
    const bundle = await loadBundleFor(config);
    await classifyNotes(config, bundle);
    const state = (p: string) => reviewOf(config, p, bundle)?.state;
    expect([state('a/approuvee.md'), state('a/perso.md'), state('a/sans-trace.md'), state('a/par-politique.md')]).toEqual(['validated', 'validated', 'pending', 'pending']);
    expect(await readFile(resolve(root, 'a/sans-trace.md'), 'utf8')).toBe(before);
    await classifyNotes(config, bundle);
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) n FROM note_reviews')!.n).toBe(4);
  });

  it('follows a note moved outside OKB by its id, and treats an unknown generated note as to review', async () => {
    const { config } = await workKb();
    const root = config.kb.root;
    await put(root, 'a/n.md', generated('N', 'x_okb:\n  id: n-0001\n'));
    let bundle = await loadBundleFor(config);
    await classifyNotes(config, bundle);
    setReview(config, 'a/n.md', 'validated', 'human:test');
    await mkdir(resolve(root, 'b'), { recursive: true });
    await rename(resolve(root, 'a/n.md'), resolve(root, 'b/n.md'));
    bundle = await loadBundleFor(config);
    expect(reviewOf(config, 'b/n.md', bundle)).toMatchObject({ state: 'validated', path: 'b/n.md' });
    await put(root, 'b/nouvelle.md', generated('Nouvelle'));
    bundle = await loadBundleFor(config);
    await classifyNotes(config, bundle);
    expect(reviewOf(config, 'b/nouvelle.md', bundle)?.state).toBe('pending');
  });

  it('lists what is to review, oldest first', async () => {
    const { config } = await workKb();
    await put(config.kb.root, 'x/un.md', generated('Un'));
    await put(config.kb.root, 'x/deux.md', generated('Deux'));
    const bundle = await loadBundleFor(config);
    setReview(config, 'x/deux.md', 'pending', 'agent', { reason: 'un cas résolu', at: '2026-10-01T00:00:00Z' });
    setReview(config, 'x/un.md', 'pending', 'agent', { at: '2026-10-02T00:00:00Z' });
    expect(pendingList(config, bundle).map((r) => [r.path, r.title, r.reason])).toEqual([['x/deux.md', 'Deux', 'un cas résolu'], ['x/un.md', 'Un', null]]);
  });

  it('measures the validated share, with an empty KB giving none', async () => {
    const { config } = await workKb();
    expect((await validatedShare(config, await loadBundleFor(config))).share).toBeNull();
    await put(config.kb.root, 'y/a.md', human('A'));
    await put(config.kb.root, 'y/b.md', generated('B'));
    await put(config.kb.root, 'y/c.md', human('C', 'verified:\n  by: human:test\n  at: 2026-10-03T00:00:00Z\n'));
    const bundle = await loadBundleFor(config);
    await classifyNotes(config, bundle);
    expect(await validatedShare(config, bundle)).toEqual({ total: 3, validated: 2, verified: 1, pending: 1, share: 67 });
  });
});
