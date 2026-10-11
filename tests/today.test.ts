import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { noteEvent } from '../src/scores/scores.js';
import { closeDbs } from '../src/state/db.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const note = (title: string, body: string, type = 'Guide') => `---\ntype: ${type}\ntitle: ${title}\ndescription: ${title}.\n---\n\n# ${title}\n\n${body}\n`;
async function put(kb: string, path: string, text: string) {
  await mkdir(dirname(resolve(kb, path)), { recursive: true });
  await writeFile(resolve(kb, path), text);
}

describe('today answers six questions (F2.0-04)', () => {
  it('what to pick up, what to do, what is expected, what was done', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const a = await invoke('projects.create', { title: 'Export CSV', next: 'Finir les tests' }, ctx);
    const b = await invoke('projects.create', { title: 'Cache des sessions' }, ctx);
    await invoke('actions.add', { text: 'Répondre à Inès', due: '2020-01-01' }, ctx);
    await invoke('actions.add', { text: 'Finir les tests', project: a.id }, ctx);
    await invoke('actions.add', { text: 'L’avis de Paul', kind: 'waiting', who: 'Paul', project: a.id }, ctx);
    await invoke('journal.add', { text: 'On garde PostgreSQL', kind: 'decision', project: b.id }, ctx);
    await invoke('projects.leave', { id: a.id }, ctx);

    const today = await invoke('today.view', {}, ctx);
    expect(today.resume.map((r) => r.title)).toEqual(['Export CSV', 'Cache des sessions']);
    expect(today.resume[0]!.leftOff).toMatchObject({ resume: 'Finir les tests', waiting: 'L’avis de Paul (Paul)' });
    expect(today.todo.map((x) => [x.text, x.late])).toEqual([['Répondre à Inès', true], ['Finir les tests', false]]);
    expect(today.todo[1]!.project).toEqual({ id: a.id, title: 'Export CSV' });
    expect(today.waiting.map((x) => [x.text, x.who])).toEqual([['L’avis de Paul', 'Paul']]);
    expect(today.done.map((e) => e.text)).toContain('On garde PostgreSQL');
    expect(today.done.map((e) => e.kind)).not.toContain('resume');
  });

  it('what was learned this week, what is to review, and one thing to understand', async () => {
    const { config, env, kb } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    await put(kb, '3 Boîte à outils/Concepts/Keyset.md', note('Keyset', 'Une page suit la précédente.', 'Concept'));
    await put(kb, '2 Produits/Export.md', note('Export', 'Voir [Keyset](../3%20Bo%C3%AEte%20%C3%A0%20outils/Concepts/Keyset.md).'));
    const state = statePaths(config);
    await ensureState(state);
    const at = new Date().toISOString();
    await writeFile(resolve(state.receipts, 'r-1.json'), JSON.stringify({ id: 'r-1', proposalId: 'p-1', kbRoot: config.kb.root, appliedAt: at, complete: true, approval: { approvedAt: at }, results: [{ path: '2 Produits/Export.md', action: 'created', sha256: 'x' }] }));
    await writeFile(resolve(state.receipts, 'r-0.json'), JSON.stringify({ id: 'r-0', proposalId: 'p-0', kbRoot: config.kb.root, appliedAt: '2020-01-01T00:00:00.000Z', complete: true, results: [{ path: '3 Boîte à outils/Concepts/Keyset.md', action: 'created', sha256: 'x' }] }));

    const today = await invoke('today.view', {}, ctx);
    expect(today.learned.map((n) => [n.path, n.title])).toEqual([['2 Produits/Export.md', 'Export']]);
    expect(today.review.due).toBeGreaterThanOrEqual(0);
    // A concept the notes link to and the person never opened: the most used first.
    const first = today.understand!;
    expect(first.usedBy).toBeGreaterThan(0);
    await noteEvent(config, first.path, 'open');
    const after = await invoke('today.view', {}, ctx);
    expect(after.understand?.path).not.toBe(first.path);
    for (let i = 0, next = after.understand; next && i < 60; i++) {
      await noteEvent(config, next.path, 'open');
      next = (await invoke('today.view', {}, ctx)).understand;
      if (!next) expect(i).toBeGreaterThan(0);
    }
    expect((await invoke('today.view', {}, ctx)).understand).toBeNull();
  });
});
