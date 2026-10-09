import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brainRepos, linkBrainRepo } from '../src/knowledge/brain-repos.js';
import { listRepos } from '../src/repo/registry.js';
import { demoBrain } from './helpers/brain.js';
import { git } from './helpers/repo.js';

async function codeFolder(dir: string, name: string): Promise<string> {
  const path = resolve(dir, 'code', name);
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'README.md'), `# ${name}\n`);
  git(path, 'init', '-q');
  git(path, 'add', '-A');
  git(path, '-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return path;
}

describe("a brain's repositories", () => {
  it('lists the repository folders of the brain even when none is linked on this computer', async () => {
    const { config, env } = await demoBrain();
    const repos = await brainRepos(config, env);
    expect(repos).toHaveLength(2);
    for (const r of repos) {
      expect(r.linked).toBe(false);
      expect(r.folder).toMatch(/^2 Produits\/[^/]+\/Code\/[^/]+$/);
      expect(r.product).toBeTruthy();
    }
  }, 60_000);

  it('links a folder of code to a repository of the brain, without listing it twice', async () => {
    const { config, env, dir } = await demoBrain();
    const [first] = await brainRepos(config, env);
    const code = await codeFolder(dir, first!.name);
    const linked = await linkBrainRepo(config, first!.folder!, code, env);
    expect(linked.name).toBe(first!.name);
    expect(linked.product).toBe(first!.product);
    const after = await brainRepos(config, env);
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.name === first!.name)).toMatchObject({ linked: true, folder: first!.folder });
    expect((await listRepos(env)).map((r) => r.name)).toEqual([first!.name]);
  }, 60_000);

  it('refuses a folder that is not one of the brain’s repositories', async () => {
    const { config, env, dir } = await demoBrain();
    const code = await codeFolder(dir, 'other');
    await expect(linkBrainRepo(config, '2 Produits/Nope/Code/nope', code, env)).rejects.toMatchObject({ key: 'repoUnknown' });
  }, 60_000);
});

describe('repositories in the web app', () => {
  it('shows the unlinked repositories of a brain and links one with the token', async () => {
    const { serve } = await import('../src/web/serve.js');
    const { config, env, dir } = await demoBrain();
    const { server, url } = await serve(config, { port: 0, env });
    try {
      const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
      const list = (await (await fetch(`${url}/api/repos`)).json()) as { repos: unknown[]; unlinked: { name: string; folder: string; product: string }[] };
      expect(list.repos).toEqual([]);
      expect(list.unlinked).toHaveLength(2);
      const code = await codeFolder(dir, list.unlinked[0]!.name);
      const body = JSON.stringify({ folder: list.unlinked[0]!.folder, path: code });
      expect((await fetch(`${url}/api/repos/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(403);
      const linked = await fetch(`${url}/api/repos/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body });
      expect(await linked.json()).toMatchObject({ ok: true, repo: { name: list.unlinked[0]!.name } });
      const after = (await (await fetch(`${url}/api/repos`)).json()) as { repos: unknown[]; unlinked: unknown[] };
      expect(after.repos).toHaveLength(1);
      expect(after.unlinked).toHaveLength(1);
    } finally {
      server.closeAllConnections(); server.close();
    }
  }, 90_000);
});

describe('the Repos page reads Git once per repository (review I4)', () => {
  it('does not compute the status and freshness of a repository again for its level', async () => {
    const { vi } = await import('vitest');
    const gitModule = await import('../src/repo/git.js');
    const notesModule = await import('../src/repo/notes.js');
    const { serve } = await import('../src/web/serve.js');
    const { config, env, dir } = await demoBrain();
    const [first] = await brainRepos(config, env);
    await linkBrainRepo(config, first!.folder!, await codeFolder(dir, first!.name), env);
    const { server, url } = await serve(config, { port: 0, env });
    const identity = vi.spyOn(gitModule, 'gitIdentity');
    const notes = vi.spyOn(notesModule, 'repoNotes');
    try {
      const list = (await (await fetch(`${url}/api/repos`)).json()) as { repos: { level: { percent: number } }[] };
      expect(list.repos).toHaveLength(1);
      expect(list.repos[0]!.level.percent).toBeGreaterThanOrEqual(0);
      // Before: status, then status again and freshness again for the level (3 each).
      expect(identity.mock.calls.length).toBeLessThanOrEqual(2);
      expect(notes.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      identity.mockRestore(); notes.mockRestore();
      server.closeAllConnections(); server.close();
    }
  }, 90_000);
});

describe('the next steps of a level measured on the notes only (review M6)', () => {
  it('count in points of that level, as its percentage does', async () => {
    const { levelFromFacts } = await import('../src/knowledge/level.js');
    const pages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((kind, i) => ({ kind, state: (i < 4 ? 'fresh' : 'missing') as 'fresh' | 'missing' }));
    const partial = levelFromFacts({ questions: null, coverage: null, pages, work: 6, quality: 80 });
    const page = partial.next.find((g) => g.key === 'knowledge.gap.page')!;
    // Writing one missing page of eight moves the notes part by 25/8 of the 50 points measured: 6.25 % of this level.
    expect(page.points).toBe(6.3);
    const withPage = levelFromFacts({ questions: null, coverage: null, pages: pages.map((p, i) => (i === 4 ? { ...p, state: 'fresh' as const } : p)), work: 6, quality: 80 });
    expect(withPage.percent - partial.percent).toBeCloseTo(page.points, 0);
  });
});

describe('two repositories of the same name in two products (review M7)', () => {
  it('stay two: linking one does not link the other', async () => {
    const { cp } = await import('node:fs/promises');
    const { config, env, dir, kb } = await demoBrain();
    const repos = await brainRepos(config, env);
    const first = repos[0]!;
    const other = repos.find((r) => r.product !== first.product)!;
    const twin = `${other.folder!.split('/').slice(0, -1).join('/')}/${first.name}`;
    await cp(resolve(kb, first.folder!), resolve(kb, twin), { recursive: true });
    const code = await codeFolder(dir, first.name);
    await linkBrainRepo(config, first.folder!, code, env);
    const same = (await brainRepos(config, env)).filter((r) => r.name === first.name);
    expect(same.map((r) => [r.product, r.linked]).sort()).toEqual([[first.product, true], [other.product, false]].sort());
  }, 60_000);
});
