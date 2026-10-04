import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { applyProposal } from '../../src/apply/apply.js';
import { grantApproval } from '../../src/apply/approval.js';
import type { OkbConfig } from '../../src/config/schema.js';
import type { Proposal } from '../../src/proposal/model.js';
import { saveProposal } from '../../src/proposal/store.js';
import { repoContext } from '../../src/repo/notes.js';
import { addRepo } from '../../src/repo/registry.js';
import { scanAndStore } from '../../src/repo/scan.js';
import { resolveStyle } from '../../src/style/resolve.js';
import { makeSandbox, TEST_ROOT, type Sandbox } from './sandbox.js';

/**
 * A fictional SAP CAP repository (tests/fixtures/repos/orders-service) turned
 * into a real Git repository, a work KB, and the helpers repository tests share.
 * Each test file calls `useRepoSandboxes()` once: OKB_HOME is set per test.
 */
export const FIXTURE = resolve(TEST_ROOT, 'fixtures', 'repos', 'orders-service');
export const sandboxes: Sandbox[] = [];
export const dirs: string[] = [];

export function useRepoSandboxes(): void {
  let savedHome: string | undefined;
  beforeEach(() => { savedHome = process.env.OKB_HOME; });
  afterEach(async () => {
    if (savedHome === undefined) delete process.env.OKB_HOME; else process.env.OKB_HOME = savedHome;
    await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Alice Martin', '-c', 'user.email=alice@acme.test', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
}

/** A copy of the fixture as a real Git repository with two authors. */
export async function gitFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-repo-')));
  dirs.push(dir);
  const root = resolve(dir, 'orders-service');
  await cp(FIXTURE, root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Orders service on CAP');
  await writeFile(resolve(root, 'srv', 'notify.js'), `${await readFile(resolve(root, 'srv', 'notify.js'), 'utf8')}// warehouse may be slow\n`);
  execFileSync('git', ['-c', 'user.name=Bob Leroy', '-c', 'user.email=bob@acme.test', 'commit', '-qam', 'notify: comment'], { cwd: root });
  return root;
}

export async function workKb(): Promise<{ s: Sandbox; config: OkbConfig }> {
  const s = await makeSandbox({ profileId: 'travail', answerLanguage: 'fr', writingPreset: 'pedagogique' }, { copyVault: false });
  sandboxes.push(s);
  await mkdir(s.vault, { recursive: true });
  process.env.OKB_HOME = s.home;
  return { s, config: await s.config() };
}

export async function registered() {
  const root = await gitFixture();
  const { s, config } = await workKb();
  const { repo } = await addRepo({ path: root, kb: 'travail' });
  const ctx = await repoContext(config, repo);
  await scanAndStore(config, repo);
  return { root, s, config, repo, ctx };
}

/** An overview dossier citing the README, package.json and the service code. */
export function dossier(config: OkbConfig, extra: Record<string, unknown> = {}) {
  return {
    version: 3,
    repo: 'orders-service',
    note: 'overview',
    template: 'repo-overview',
    style: resolveStyle(config, {}).style,
    read: [{ file: 'README.md' }],
    sections: [
      { role: 'purpose', claims: [{ id: 'purpose-orders', text: 'Le service gère les commandes de la boutique Acme.', kind: 'reported', evidence: [{ file: 'README.md', quote: 'Order management for the Acme web shop' }] }] },
      { role: 'context', claims: [{ id: 'ctx-bp', text: 'Le crédit est vérifié via la destination S4_BP.', kind: 'reported', evidence: [{ file: 'package.json', quote: '"destination": "S4_BP"' }] }] },
      { role: 'how', claims: [{ id: 'how-cancel', text: 'Une commande expédiée ne peut pas être annulée.', kind: 'reported', evidence: [{ file: 'srv/orders-service.js', quote: "if (!n) return req.error(409, 'Shipped orders cannot be cancelled');" }] }] },
    ],
    unknowns: [{ question: 'q-scope', text: 'Qui gère les paiements ?', askWho: '@acme/orders-team', looked: ['README.md'] }],
    answers: ['q-purpose'],
    ...extra,
  };
}

export async function approve(config: OkbConfig, proposal: Proposal) {
  await saveProposal(config, proposal);
  await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
  return applyProposal(config, proposal);
}
