import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { keepProposal } from '../src/review/keep.js';
import { classifyNotes, reviewOf } from '../src/review/state.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const note = (title: string, body = 'Texte.') => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# ${title}\n\n${body}\n`;
async function kb(mode: 'proposal' | 'review-later' = 'review-later') {
  const { s, config } = await workKb();
  if (mode === 'review-later') await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
  const c = (await loadConfig({ env: s.env, profileId: config.profile.id })).config;
  await writeOwner(c.kb.root, c.profile.id);
  const put = async (p: string, t: string) => { await mkdir(dirname(resolve(c.kb.root, p)), { recursive: true }); await writeFile(resolve(c.kb.root, p), t); };
  const propose = async (files: Record<string, string | null>) => { const p = proposeFiles(c, await loadBundleFor(c), new Map(Object.entries(files)), 'agent'); await saveProposal(c, p); return p.id; };
  return { config: c, put, propose };
}

describe('the agent files new notes at once, to review (F2.0-54, D71)', () => {
  it('applies a new note, marks it to review with its reason, and records who', async () => {
    const { config, propose } = await kb();
    const id = await propose({ 'cas/remises.md': note('Remises') });
    const r = await keepProposal(config, id);
    expect(r).toMatchObject({ applied: ['cas/remises.md'], waiting: null });
    expect(await readFile(resolve(config.kb.root, 'cas/remises.md'), 'utf8')).toContain('Remises');
    expect(reviewOf(config, 'cas/remises.md')).toMatchObject({ state: 'pending', by: 'agent' });
    expect(r.receipt?.approval.approvedBy).toBe('policy:review-later');
  });

  it('changes a note to review directly, and keeps a change to a validated note waiting', async () => {
    const { config, put, propose } = await kb();
    await put('a/a-relire.md', note('À relire'));
    await put('a/validee.md', note('Validée'));
    await classifyNotes(config, await loadBundleFor(config));
    const { setReview } = await import('../src/review/state.js');
    setReview(config, 'a/a-relire.md', 'pending', 'agent');
    setReview(config, 'a/validee.md', 'validated', 'human:test');
    const id = await propose({ 'a/a-relire.md': note('À relire', 'Complété.'), 'a/validee.md': note('Validée', 'Changé par l’agent.'), 'a/nouvelle.md': note('Nouvelle') });
    const r = await keepProposal(config, id);
    expect(r.applied.sort()).toEqual(['a/a-relire.md', 'a/nouvelle.md']);
    expect(await readFile(resolve(config.kb.root, 'a/validee.md'), 'utf8')).toContain('Texte.');
    expect(r.waiting).toBeTruthy();
    const waiting = await loadProposal(config, r.waiting!);
    expect(waiting.status).toBe('prepared');
    expect(waiting.changes.map((c) => c.path)).toEqual(['a/validee.md']);
    expect(reviewOf(config, 'a/validee.md')?.state).toBe('validated');
  });

  it('applies nothing in « nothing enters without my yes »', async () => {
    const { config, propose } = await kb('proposal');
    const id = await propose({ 'b/n.md': note('N') });
    expect(await keepProposal(config, id)).toMatchObject({ applied: [], waiting: id });
    expect((await loadProposal(config, id)).status).toBe('prepared');
  });

  it('applies nothing when a guard refuses', async () => {
    const { config, propose } = await kb();
    const id = await propose({ '.okb/n.md': note('Interdit') });
    await expect(keepProposal(config, id)).rejects.toBeTruthy();
    expect(reviewOf(config, '.okb/n.md')).toBeNull();
  });

  it('whoever runs okb keep, the note is to review: only the app validates (I4)', async () => {
    const { config, propose } = await kb();
    const id = await propose({ 'c/n.md': note('N') });
    await keepProposal(config, id);
    expect(reviewOf(config, 'c/n.md')).toMatchObject({ state: 'pending', by: 'agent' });
  });

  it('never deletes a note without the person, even one to review', async () => {
    const { config, propose } = await kb();
    await keepProposal(config, await propose({ 'c/x.md': note('X') }));
    const id = await propose({ 'c/x.md': null });
    expect(await keepProposal(config, id)).toMatchObject({ applied: [], waiting: id });
    expect(reviewOf(config, 'c/x.md')?.state).toBe('pending');
  });

  it('a note to review the person edited outside OKB is theirs now: the agent’s change waits (I5)', async () => {
    const { config, propose, put } = await kb();
    await keepProposal(config, await propose({ 'c/y.md': note('Y', 'Agent.') }));
    await put('c/y.md', note('Y', 'Réécrit par la personne dans Obsidian.'));
    const id = await propose({ 'c/y.md': note('Y', 'Agent encore.') });
    expect(await keepProposal(config, id)).toMatchObject({ applied: [], waiting: id });
    expect(await readFile(resolve(config.kb.root, 'c/y.md'), 'utf8')).toContain('Obsidian');
  });

  it('forgets the review of a note gone from the KB, so a new file there starts afresh (I5)', async () => {
    const { config, propose, put } = await kb();
    await keepProposal(config, await propose({ 'c/z.md': note('Z') }));
    const { rm } = await import('node:fs/promises');
    await rm(resolve(config.kb.root, 'c/z.md'));
    await classifyNotes(config, await loadBundleFor(config));
    expect(reviewOf(config, 'c/z.md')).toBeNull();
    await put('c/z.md', '---\ntype: Guide\ntitle: "Z"\ndescription: Le mien.\nstatus: draft\n---\n\n# Z\n\nÉcrit par moi.\n');
    await classifyNotes(config, await loadBundleFor(config));
    expect(reviewOf(config, 'c/z.md')?.state).toBe('validated');
  });
});

describe('notes.keep through the engine', () => {
  it('lets an agent keep its proposal, and says what waits', async () => {
    const { invoke } = await import('../src/engine/registry.js');
    const { config, propose } = await kb();
    const id = await propose({ 'd/n.md': note('N') });
    const r = await invoke('notes.keep', { proposal: id }, { config, env: process.env, actor: 'agent' }) as { applied: string[]; waiting: string | null };
    expect(r).toMatchObject({ applied: ['d/n.md'], waiting: null });
  });
});
