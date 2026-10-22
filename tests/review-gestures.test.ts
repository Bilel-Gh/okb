import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { keepProposal } from '../src/review/keep.js';
import { approveChange, moveNote, rejectChange, rejectNote, validateNotes, yesToAll } from '../src/review/gestures.js';
import { OPERATIONS } from '../src/engine/registry.js';
import { reviewOf, setReview } from '../src/review/state.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const note = (title: string, body = 'Texte.') => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# ${title}\n\n${body}\n`;
async function kb() {
  const { s, config } = await workKb();
  await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
  const c = (await loadConfig({ env: s.env, profileId: config.profile.id })).config;
  await writeOwner(c.kb.root, c.profile.id);
  const keep = async (files: Record<string, string | null>) => { const p = proposeFiles(c, await loadBundleFor(c), new Map(Object.entries(files)), 'agent'); await saveProposal(c, p); return keepProposal(c, p.id, s.env); };
  const person = { config: c, env: s.env, actor: 'person' as const };
  const agent = { ...person, actor: 'agent' as const };
  return { config: c, keep, person, agent, file: (p: string) => resolve(c.kb.root, p) };
}

describe('the person sorts what the agent filed (F2.0-55, D71)', () => {
  it('lists what is to review and what waits, and validates', async () => {
    const { config, keep, person } = await kb();
    await keep({ 'a/un.md': note('Un') });
    const list = await invoke('notes.review.list', {}, person) as { notes: { path: string; title: string }[]; changes: unknown[] };
    expect(list.notes.map((n) => [n.path, n.title])).toEqual([['a/un.md', 'Un']]);
    validateNotes(config, ['a/un.md']);
    expect(reviewOf(config, 'a/un.md')).toMatchObject({ state: 'validated', by: config.profile.humanActor });
  });

  it('« Non » on one created note removes only that note', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'b/garde.md': note('Garde'), 'b/retire.md': note('Retire') });
    await rejectNote(config, 'b/retire.md', person.env);
    expect(existsSync(file('b/retire.md'))).toBe(false);
    expect(existsSync(file('b/garde.md'))).toBe(true);
    expect(reviewOf(config, 'b/retire.md')).toBeNull();
  });

  it('« Non » on a note to review that the agent changed brings its text back', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'c/n.md': note('N', 'Premier jet.') });
    await keep({ 'c/n.md': note('N', 'Changé ensuite.') });
    await rejectNote(config, 'c/n.md', person.env);
    expect(await readFile(file('c/n.md'), 'utf8')).toContain('Premier jet.');
    expect(reviewOf(config, 'c/n.md')?.state).toBe('pending');
  });

  it('applies or refuses a change waiting on a validated note', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'd/v.md': note('V', 'Version validée.') });
    setReview(config, 'd/v.md', 'validated', config.profile.humanActor);
    const one = await keep({ 'd/v.md': note('V', 'Proposé par l’agent.') });
    await rejectChange(config, one.waiting!);
    expect((await loadProposal(config, one.waiting!)).status).toBe('superseded');
    const two = await keep({ 'd/v.md': note('V', 'Mieux proposé.') });
    await approveChange(config, two.waiting!, person.env);
    expect(await readFile(file('d/v.md'), 'utf8')).toContain('Mieux proposé.');
    expect(reviewOf(config, 'd/v.md')?.state).toBe('validated');
  });

  it('moves a note with its links, the review following it', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'e/cible.md': note('Cible'), 'e/source.md': note('Source', 'Voir [la cible](cible.md).') });
    await moveNote(config, 'e/cible.md', 'f', person.env);
    expect(existsSync(file('f/cible.md'))).toBe(true);
    expect(await readFile(file('e/source.md'), 'utf8')).toContain('../f/cible.md');
    expect(reviewOf(config, 'f/cible.md')?.state).toBe('pending');
  });

  it('« Non » twice: first the agent’s change goes, then the note it created (I3)', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'h/n.md': note('N', 'Premier jet.') });
    await keep({ 'h/n.md': note('N', 'Changé ensuite.') });
    expect(await rejectNote(config, 'h/n.md', person.env)).toBe('restored');
    expect(await rejectNote(config, 'h/n.md', person.env)).toBe('removed');
    expect(existsSync(file('h/n.md'))).toBe(false);
  });

  it('« Non » after a move still restores the earlier text, never deletes a note the agent only changed (I3)', async () => {
    const { config, keep, person, file } = await kb();
    await keep({ 'i/n.md': note('N', 'Premier jet.') });
    await keep({ 'i/n.md': note('N', 'Changé ensuite.') });
    const to = await moveNote(config, 'i/n.md', 'j', person.env);
    expect(await rejectNote(config, to, person.env)).toBe('restored');
    expect(await readFile(file('j/n.md'), 'utf8')).toContain('Premier jet.');
  });

  it('says yes to what the person saw, and only that (I2)', async () => {
    const { config, keep, person } = await kb();
    await keep({ 'g/a.md': note('A'), 'g/b.md': note('B'), 'g/c.md': note('C') });
    const shown = { notes: ['g/a.md', 'g/c.md', 'g/gone.md'], changes: ['p-unknown'] };
    await keep({ 'g/d.md': note('D') }); // filed while the screen was open
    expect(await yesToAll(config, shown, person.env)).toEqual({ notes: 2, changes: 0 });
    expect(['g/a.md', 'g/b.md', 'g/c.md', 'g/d.md'].map((p) => reviewOf(config, p)?.state)).toEqual(['validated', 'pending', 'validated', 'pending']);
  });

  it('asks the agent for a check and lists it', async () => {
    const { keep, person, agent } = await kb();
    await keep({ 'h/n.md': note('N') });
    await invoke('notes.review.requestCheck', { path: 'h/n.md' }, person);
    expect(((await invoke('notes.review.list', {}, agent)) as { checks: { path: string }[] }).checks.map((c) => c.path)).toEqual(['h/n.md']);
  });

  it('keeps saying yes, no, moving and applying out of the engine, so no agent can call them', async () => {
    const ids = OPERATIONS.map((o) => o.id);
    expect(ids).toContain('notes.review.list');
    for (const id of ['notes.review.validate', 'notes.review.reject', 'notes.review.move', 'notes.review.approveChange', 'notes.review.yesToAll']) expect(ids).not.toContain(id);
    const { agent } = await kb();
    await expect(invoke('notes.review.requestCheck', { path: 'x.md' }, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
  });
});
