import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { repoContext, repoNotes, writeRepoNote } from '../src/repo/notes.js';
import { ticketPath } from '../src/repo/pack.js';
import { listRepos } from '../src/repo/registry.js';
import { workspaceGraph } from '../src/work/graph-view.js';
import { kindOf } from '../src/work/kinds.js';
import { loadTicket } from '../src/work/tickets.js';
import { approve, dirs, dossier, git, gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';
import { json, repo, run, team } from './helpers/team.js';

useRepoSandboxes();

/** The sandbox environment without a pinned KB: the folder decides, as for a person. */
async function person() {
  const { s, config } = await workKb();
  const env = { ...s.env };
  delete env.OKB_PROFILE;
  return { s, config, env };
}

const note = (title: string, body: string, extra = '') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}, une note de test pour les types de KB.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-15T09:00:00Z }\n${extra}---\n\n${body}\n`;

describe('a KB is a plain local folder', () => {
  it('is never put under Git, and an apply commits nothing even in a KB the person versions', async () => {
    const { s, config, env } = await person();
    const folder = resolve(await realpath(await mkdtemp(resolve(tmpdir(), 'okb-plain-'))), 'kb-notes');
    dirs.push(resolve(folder, '..'));
    expect(await json(['init', '--yes', '--name', 'Notes', '--dir', folder], env, s.dir)).toMatchObject({ ok: true });
    expect(await stat(resolve(folder, '.git')).then(() => true, () => false)).toBe(false);
    expect(await kindOf('notes')).toBe('topic');

    // The person keeps their own Git history: OKB leaves it alone.
    await writeOwner(s.vault, 'travail');
    git(s.vault, 'init', '-q');
    await writeFixture(resolve(s.vault, 'lisez-moi.md'), '# KB\n');
    git(s.vault, 'add', '-A');
    git(s.vault, 'commit', '-qm', 'mine');
    const bundle = await loadBundleFor(config);
    const proposal = proposeFiles(config, bundle, new Map([['guides/nouveau.md', note('Nouveau', 'Une note.')]]), 'test');
    await saveProposal(config, proposal);
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const applied = await json(['apply', proposal.id, '--kb', 'travail'], env, s.vault);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true });
    expect(git(s.vault, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(git(s.vault, 'status', '--porcelain')).toContain('guides/');
  });
});

describe('three kinds of KB', () => {
  it('a repository KB keeps the repository’s notes at its root', async () => {
    const root = await gitFixture();
    const { s, env } = await person();
    const made = await json(['init', '--yes', '--name', 'Orders', '--kind', 'repo', '--repo', root], env, s.dir);
    expect(made).toMatchObject({ ok: true, created: true, repo: { id: 'orders-service', kb: 'orders' }, kb: { id: 'orders', kind: 'repo', confidential: true } });
    const { config } = await loadConfig({ profileId: 'orders' });
    const ctx = await repoContext(config, (await listRepos()).find((r) => r.id === 'orders-service')!);
    const { report, target } = await writeRepoNote(ctx, dossier(config));
    expect(target.path).toBe('comprendre.md');
    await approve(config, report.proposal);
    expect(repoNotes(await loadBundleFor(config), 'orders-service', true).map((n) => n.path)).toEqual(['comprendre.md']);
    expect(ticketPath('orders-service', 'ORD-1 fix', new Date('2026-10-05'), true)).toBe('tickets/2026-10-05-ord-1-fix.md');
    const status = await json(['repo', 'status'], env, root);
    expect(status.notes.find((n: { kind: string }) => n.kind === 'overview')).toMatchObject({ path: 'comprendre.md', state: 'written' });
    // A repository KB has no map of several repositories.
    expect(await json(['repo', 'landscape', '--propose', '--kb', 'orders'], env, root)).toMatchObject({ ok: true, proposalId: null });
  });

  it('a repository KB can live inside its repository, ignored by Git on this computer only', async () => {
    const root = await gitFixture();
    const { s, env } = await person();
    const made = await json(['init', '--yes', '--name', 'Orders local', '--kind', 'repo', '--repo', root, '--in-repo'], env, s.dir);
    expect(made.kb.root).toBe(resolve(root, '.okb-kb'));
    const exclude = await readFile(resolve(root, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.okb-kb/');
    expect(git(root, 'status', '--porcelain')).not.toContain('.okb-kb');
    expect(git(root, 'ls-files', '--others', '--exclude-standard')).not.toContain('.okb-kb');
  });

  it('explains the choice when a repository is registered, and joins a workspace by itself', async () => {
    const { ws, orders } = await team();
    const { env } = await person();
    const refused = await json(['repo', 'add'], env, orders);
    expect(refused.error).toMatchObject({ key: 'repoNeedsKbSiblings' });
    await json(['workspace', 'add', ws, '--kb', 'travail', '--name', 'Acme'], env, ws);
    expect(await kindOf('travail')).toBe('workspace');
    // A repository cloned later into the workspace joins its KB without a question.
    const fresh = resolve(ws, 'stock-service');
    await repo(fresh, { 'README.md': '# Stock\n' }, 'Stock service');
    expect(await json(['repo', 'add'], env, fresh)).toMatchObject({ ok: true, repo: { id: 'stock-service', kb: 'travail' } });
    // A folder with one repository: a repository KB is advised.
    const lone = resolve(ws, '..', 'solo');
    await repo(resolve(lone, 'tool'), { 'README.md': '# Tool\n' }, 'Tool');
    expect(await json(['workspace', 'add', lone, '--kb', 'travail', '--no-scan', '--no-landscape'], env, lone)).toMatchObject({ ok: true, advice: 'single-repo' });
  });
});

describe('a repository with its own KB in a workspace', () => {
  async function attached() {
    const t = await team();
    const p = await person();
    await json(['init', '--yes', '--name', 'Billing', '--kind', 'repo', '--repo', t.billing], p.env, p.s.dir);
    const added = await json(['workspace', 'add', t.ws, '--kb', 'travail', '--name', 'Acme'], p.env, t.ws);
    const { config: billingKb } = await loadConfig({ profileId: 'billing' });
    return { ...t, ...p, added, billingKb };
  }

  it('keeps its KB, and gets the workspace’s shared part in its brief and its searches', async () => {
    const { s, env, billing, added, billingKb } = await attached();
    expect(added.repos.find((r: { id: string }) => r.id === 'billing-service')).toMatchObject({ attached: 'billing' });
    expect((await listRepos()).find((r) => r.id === 'billing-service')!.kb).toBe('billing');
    await writeFixture(resolve(s.vault, 'guides', 'facturation.md'), note('Facturation', 'Les factures partent de billing-service chaque nuit.'));
    await writeFixture(resolve(billingKb.kb.root, 'architecture.md'), note('Architecture de billing', 'La facture est calculée par le batch de nuit.', 'x_okb:\n  repo: { id: billing-service, kind: architecture }\n'));
    const text = (await run(['scope', '--context', '--cwd', billing], env, billing)).stdout;
    expect(text).toContain('OKB scope — repository "billing-service"');
    expect(text).toMatch(/Shared notes tied to it \(business, features, other repositories\), in the workspace's KB "[^"]+":/);
    expect(text).toContain(`${s.vault}/guides/facturation.md`);
    expect(text).toContain(`${billingKb.kb.root}/architecture.md`);
    const found = await json(['ask', 'facture'], env, billing);
    expect(found.scope).toMatchObject({ repo: 'billing-service', sharedKb: 'travail' });
    expect(found.hits.map((h: { kb: string; path: string }) => `${h.kb}:${h.path}`)).toEqual(['billing:architecture.md', 'travail:guides/facturation.md']);
  });

  it('merges into the workspace’s KB through one proposal, then moves its state over', async () => {
    const { env, billing, billingKb } = await attached();
    await writeFixture(resolve(billingKb.kb.root, 'comprendre.md'), note('Comprendre billing', 'Voir [le ticket](tickets/2026-10-01-bil-7.md).'));
    await writeFixture(resolve(billingKb.kb.root, 'tickets', '2026-10-01-bil-7.md'), note('BIL-7', 'Arrondi des factures.'));
    await writeFile(resolve(billingKb.kb.root, 'schema.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await json(['ticket', 'start', 'BIL-7', '--repo', 'billing-service'], env, billing)).toMatchObject({ ok: true, created: true });
    const prepared = await json(['kb', 'merge', 'billing', '--into', 'travail'], env, billing);
    expect(prepared).toMatchObject({ ok: true, finished: false, files: 2, binaries: ['schema.png'], repo: 'billing-service' });
    // Asked again before it is applied: the same proposal, not a second one.
    expect(await json(['kb', 'merge', 'billing', '--into', 'travail'], env, billing)).toMatchObject({ reused: true, proposalId: prepared.proposalId });
    const { config: travail } = await loadConfig({ profileId: 'travail' });
    const proposal = await loadProposal(travail, prepared.proposalId);
    expect(proposal.changes.map((c) => c.path).sort()).toEqual(['repos/billing-service/comprendre.md', 'repos/billing-service/tickets/2026-10-01-bil-7.md']);
    await grantApproval(travail, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    await applyProposal(travail, proposal);
    const finished = await json(['kb', 'merge', 'billing', '--into', 'travail', '--retire'], env, billing);
    expect(finished).toMatchObject({ ok: true, finished: true, tickets: 1, retired: true });
    expect((await listRepos()).find((r) => r.id === 'billing-service')!.kb).toBe('travail');
    expect(await loadTicket(travail, 'BIL-7')).toMatchObject({ ref: 'BIL-7' });
    expect((await json(['kb'], env, billing)).kbs.map((k: { id: string }) => k.id)).not.toContain('billing');
    // The old folder is left as it was.
    expect(await readFile(resolve(billingKb.kb.root, 'comprendre.md'), 'utf8')).toContain('Comprendre billing');
    // The relative link still works under repos/billing-service/.
    expect(await readFile(resolve(travail.kb.root, 'repos', 'billing-service', 'comprendre.md'), 'utf8')).toContain('(tickets/2026-10-01-bil-7.md)');
  });
});

describe('the web graph of a workspace', () => {
  it('draws the repositories, their connections and the scope; nothing for a subject KB', async () => {
    const { ws } = await team();
    const { env } = await person();
    await json(['workspace', 'add', ws, '--kb', 'travail', '--name', 'Acme'], env, ws);
    await json(['scope', 'orders-service'], env, ws);
    const { config: travail } = await loadConfig({ profileId: 'travail' });
    const graph = await workspaceGraph(travail, await loadBundleFor(travail));
    expect(graph?.repos.map((r) => r.id).sort()).toEqual(['billing-service', 'orders-service', 'pricing-rules']);
    expect(graph?.edges).toContainEqual({ from: 'orders-service', to: 'pricing-rules', label: 'npm @acme/pricing-rules' });
    expect(graph?.scope).toMatchObject({ repo: 'orders-service', neighbours: ['pricing-rules'] });
    const other = await mkdtemp(resolve(tmpdir(), 'okb-topic-'));
    dirs.push(other);
    await json(['init', '--yes', '--name', 'Cours', '--dir', resolve(other, 'kb-cours')], env, other);
    const { config: cours } = await loadConfig({ profileId: 'cours' });
    expect(await workspaceGraph(cours, await loadBundleFor(cours))).toBeNull();
  });
});
