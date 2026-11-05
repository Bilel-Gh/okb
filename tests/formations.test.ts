import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { isFormation, listFormations, stepsOf } from '../src/learn/formations.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const note = (type: string, title: string, body: string, extra = '') => `---\ntype: ${type}\ntitle: "${title}"\ndescription: ${title}.\nstatus: draft\n${extra}---\n\n# ${title}\n\n${body}\n`;

describe('formations (chantier 5)', () => {
  it('reads a Formation note: its steps in order, goal, deadline, levels and progress', async () => {
    const { config } = await workKb();
    const put = async (p: string, t: string) => { await mkdir(dirname(resolve(config.kb.root, p)), { recursive: true }); await writeFile(resolve(config.kb.root, p), t); };
    await put('concepts/remise.md', note('Concept', 'Remise', '## En une phrase\n\nUne remise est une baisse du prix accordée à un client.\n'));
    await put('guides/devises.md', note('Guide', 'Les devises', 'Q : Quelle devise pour les remises ? — R : L’euro.'));
    await put('formations/prix.md', note('Formation', 'Comprendre les prix', '1. [[Les devises]]\n2. [La remise](../concepts/remise.md)\n3. [[Introuvable]]\n', 'goal: certification\nby: "2099-01-31"\n'));
    const bundle = await loadBundleFor(config);
    expect(isFormation({ type: 'Formation', path: 'x.md' })).toBe(true);
    expect(isFormation({ type: 'Guide', path: 'formations/a.md' })).toBe(true);
    expect(isFormation({ type: 'Guide', path: 'guides/a.md' })).toBe(false);
    expect(stepsOf('[[Les devises]] puis [x](../concepts/remise.md)', 'formations/prix.md', bundle)).toEqual(['guides/devises.md', 'concepts/remise.md']);
    const [f] = await listFormations(config, bundle, new Date('2099-01-01T00:00:00Z'));
    expect(f).toMatchObject({ title: 'Comprendre les prix', goal: 'certification', by: '2099-01-31', daysLeft: 31, percent: 0 });
    expect(f!.steps.map((s) => s.title)).toEqual(['Les devises', 'Remise']);
    expect(f!.next?.title).toBe('Les devises');
    const out = await invoke('learn.formations', {}, { config, env: process.env, actor: 'agent' }) as { formations: unknown[] };
    expect(out.formations).toHaveLength(1);
  });
});
