import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { indicators } from '../src/indicators/indicators.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());
const put = async (root: string, p: string, t: string) => { await mkdir(dirname(resolve(root, p)), { recursive: true }); await writeFile(resolve(root, p), t); };
const human = (t: string) => `---\ntitle: ${t}\ntype: note\ndescription: x\n---\n\nTexte.\n`;
const gen = (t: string) => `---\ntitle: ${t}\ntype: note\ndescription: x\ngenerated:\n  by: agent:claude\n  at: 2026-10-01T00:00:00Z\n---\n\nTexte.\n`;

describe('how much of the memory the person validated (F2.0-57, D71)', () => {
  it('is a fifth honest indicator, with the notes to review as its gap', async () => {
    const { config } = await workKb();
    await put(config.kb.root, 'a/1.md', human('Un'));
    await put(config.kb.root, 'a/2.md', gen('Deux'));
    const list = await indicators(config, await loadBundleFor(config));
    const v = list.find((i) => i.id === 'validated')!;
    expect(v).toMatchObject({ value: 50, of: { have: 1, total: 2 }, gaps: [{ id: 'to-review', count: 1, action: { kind: 'route', to: 'review' } }] });
  });

  it('has no figure for an empty memory', async () => {
    const { config } = await workKb();
    expect((await indicators(config, await loadBundleFor(config))).find((i) => i.id === 'validated')!.value).toBeNull();
  });

  it('gives Today and the status bar the two figures', async () => {
    const { s, config } = await workKb();
    await put(config.kb.root, 'a/1.md', human('Un'));
    await put(config.kb.root, 'a/2.md', gen('Deux'));
    const ctx = { config, env: s.env, actor: 'person' as const };
    expect((await invoke('today.view', {}, ctx)).memory).toEqual({ pending: 1, share: 50 });
    expect((await invoke('kb.status', { light: true }, ctx)).review).toEqual({ pending: 1, share: 50 });
  });
});
