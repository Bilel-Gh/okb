import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fillStep } from '../src/setup/discover.js';
import { suggestIntent } from '../src/routing/intent.js';
import { dirs, useRepoSandboxes } from './helpers/repo.js';
import { json, repo, run } from './helpers/team.js';

useRepoSandboxes();

/** A machine where nothing is set up yet: an empty OKB home. */
async function fresh() {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-start-')));
  dirs.push(base);
  const home = resolve(base, 'home');
  await mkdir(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, OKB_HOME: home, HOME: base };
  delete env.OKB_PROFILE;
  return { base, env };
}

/** A work folder: three repositories and a KB written before OKB, under Git. */
async function work(base: string) {
  const folder = resolve(base, 'work');
  for (const r of ['repo1', 'repo2', 'repo3']) await repo(resolve(folder, r), { 'package.json': JSON.stringify({ name: r }), 'README.md': `# ${r}\n` }, `${r}: init`);
  await repo(resolve(folder, 'old-kb'), {
    'Accueil.md': '# Accueil\n\nNotes sur repo1 et repo2.\n', 'Architecture.md': '# Architecture\n\nrepo2 appelle repo1.\n',
    'Deploiement.md': '# Déploiement\n', 'Glossaire.md': '# Glossaire\n', 'repos/repo2.md': '# repo2\n\nComment lancer repo2.\n',
  }, 'notes');
  return folder;
}

describe('okb start: set OKB up for the situation at hand', () => {
  it('recommends a workspace that reuses the old KB, and the plan sets it up', async () => {
    const { base, env } = await fresh();
    const folder = await work(base);
    const d = await json(['start'], env, resolve(folder, 'repo2'));
    expect(d).toMatchObject({ ok: true, situation: 'team-repos', reposFolder: { path: folder }, kbs: [] });
    expect(d.reposFolder.repos.map((r: { name: string }) => r.name)).toEqual(['repo1', 'repo2', 'repo3']);
    expect(d.notesFolders).toEqual([{ path: resolve(folder, 'old-kb'), notes: 5, kb: null }]);
    expect(d.advice.map((a: { code: string }) => a.code)).toEqual(expect.arrayContaining(['teamRepos', 'oldKb']));
    const steps = d.plan.filter((s: { id: string }) => s.id !== 'tools');
    expect(steps.map((s: { id: string }) => s.id)).toEqual(['connectOld', 'workspace', 'convert', 'brain']);
    expect(steps[2]).toMatchObject({ argv: null, inClaude: '/okb:convert', optional: true });
    expect(d.next[0]).toContain('/okb-dev:ticket ABC-123');

    // What the skill does after the person said yes and named the KB.
    for (const s of steps.filter((x: { argv: string[] | null }) => x.argv)) {
      expect(await json(fillStep(s.argv, 'Travail'), env, folder)).toMatchObject({ ok: true });
    }
    const after = await json(['start'], env, resolve(folder, 'repo2'));
    expect(after).toMatchObject({ situation: 'ready-repo', here: { repo: 'repo2' } });
    expect(after.kbs).toMatchObject([{ id: 'travail', kind: 'workspace', confidential: true }]);
    expect(after.plan.filter((s: { id: string }) => s.id !== 'tools')).toEqual([]);
  });

  it('recommends a KB of its own for a repository alone, and a subject KB away from code', async () => {
    const { base, env } = await fresh();
    await repo(resolve(base, 'solo', 'tool'), { 'package.json': '{"name":"tool"}' }, 'tool');
    const solo = await json(['start'], env, resolve(base, 'solo', 'tool'));
    expect(solo).toMatchObject({ situation: 'single-repo' });
    expect(solo.plan[0]).toMatchObject({ id: 'repoKb', asksName: true, nameHint: 'tool' });
    expect(solo.plan[0].argv).toContain('--new-repo-kb');
    await mkdir(resolve(base, 'notes-vides'), { recursive: true });
    expect(await json(['start'], env, resolve(base, 'notes-vides'))).toMatchObject({ situation: 'subject' });
    const text = (await run(['start'], env, resolve(base, 'solo', 'tool'))).stdout;
    expect(text).toContain('Ce que je recommande');
    expect(text).toContain('--new-repo-kb "<nom>"');
  });

  it('is offered from plain words', () => {
    const none = { kbs: [], otherTools: [] };
    for (const m of ['configure OKB pour moi', 'aide-moi à installer okb', 'je commence avec okb', 'set okb up for me']) {
      expect(suggestIntent(m, none)?.command, m).toBe('/okb:setup');
    }
  });
});

describe('okb start keeps a workspace whole', () => {
  it('maps the folder, adds the repositories left out, and flags team groups', async () => {
    const { base, env } = await fresh();
    const folder = await work(base);
    await json(['workspace', 'add', folder, '--new-kb', 'Travail', '--no-landscape'], env, folder);
    // A repository cloned later, and a team subfolder with two more.
    await repo(resolve(folder, 'repo4'), { 'package.json': '{"name":"repo4"}' }, 'repo4');
    await repo(resolve(folder, 'equipe-b', 'svc-a'), { 'package.json': '{"name":"svc-a"}' }, 'svc-a');
    await repo(resolve(folder, 'equipe-b', 'svc-b'), { 'package.json': '{"name":"svc-b"}' }, 'svc-b');
    await repo(resolve(folder, 'equipe-c', 'svc-c'), { 'package.json': '{"name":"svc-c"}' }, 'svc-c');
    const d = await json(['start'], env, folder);
    expect(d.situation).toBe('ready-workspace');
    const kinds = Object.fromEntries(d.tree.map((e: { name: string; kind: string }) => [e.name, e.kind]));
    expect(kinds).toMatchObject({ repo1: 'repo-in', repo4: 'repo', 'old-kb': 'old-kb', 'equipe-b': 'group', 'equipe-c': 'group' });
    expect(d.advice.map((a: { code: string }) => a.code)).toEqual(expect.arrayContaining(['readyWorkspace', 'missingRepos', 'groups']));
    const sync = d.plan.find((s: { id: string }) => s.id === 'syncWorkspace');
    expect(sync.argv).toEqual(['workspace', 'add', folder, '--to', 'work']);
    expect(await json(sync.argv, env, folder)).toMatchObject({ ok: true });
    const after = await json(['start'], env, folder);
    expect(after.plan.find((s: { id: string }) => s.id === 'syncWorkspace')).toBeUndefined();
    expect(after.tree.find((e: { name: string }) => e.name === 'repo4').kind).toBe('repo-in');
  });
});
