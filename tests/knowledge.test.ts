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
