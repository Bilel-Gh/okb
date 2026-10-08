import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { cloudSyncedFolder } from '../src/repo/confidential.js';
import { mermaidNodes, locateQuote, resolveDossier } from '../src/repo/dossier.js';
import { landscapeEdges, proposeQuestionsNote, askWho } from '../src/repo/generated.js';
import { addFindings, recordAnswer, repoNotes, writeRepoNote } from '../src/repo/notes.js';
import { QUESTIONS } from '../src/repo/questions.js';
import { addRepo, listRepos, repoForDir, sameRemote } from '../src/repo/registry.js';
import { scanRepository } from '../src/repo/scan.js';
import { freshness, repoStatus } from '../src/repo/status.js';
import { loadProgress } from '../src/repo/state.js';
import { ticketContext } from '../src/repo/ticket.js';
import { suggestIntent } from '../src/routing/intent.js';
import { acquireUrl } from '../src/sources/registry.js';
import { makeSandbox, TEST_ROOT } from './helpers/sandbox.js';
import { approve, dirs, dossier, git, gitFixture, registered, sandboxes, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

describe('after a ticket, and across repositories', () => {
  it('gathers what a branch changed and which notes cite it', async () => {
    const { root, config, ctx } = await registered();
    const { report } = await writeRepoNote(ctx, dossier(config));
    await approve(config, report.proposal);
    git(root, 'checkout', '-qb', 'feature/max-items');
    const service = resolve(root, 'srv', 'orders-service.js');
    await writeFile(service, (await readFile(service, 'utf8')).replace('|| 50', '|| 100'));
    git(root, 'commit', '-qam', 'Raise the item limit to 100\n\nThe warehouse can now ship bigger orders.');
    const t = await ticketContext(ctx, { ticket: 'ORD-42: allow orders of 100 lines', by: 'dev senior' });
    expect(t.base.ref).toBe('main');
    expect(t.title).toBe('Raise the item limit to 100');
    expect(t.changes).toEqual([{ status: 'M', path: 'srv/orders-service.js', kind: 'source' }]);
    expect(t.affectedNotes).toEqual([{ path: 'repos/orders-service/comprendre.md', files: ['srv/orders-service.js'] }]);
    const text = await readFile(t.file, 'utf8');
    expect(text).toContain('ORD-42: allow orders of 100 lines');
    expect(text).toContain('The warehouse can now ship bigger orders.');
    expect(t.suggested.ticketNote).toMatch(/^repos\/orders-service\/tickets\/\d{4}-\d{2}-\d{2}-raise-the-item-limit-to-100\.md$/);
  });

  it('writes the open-questions note and links repositories by what they declare', async () => {
    const { ctx } = await registered();
    const proposal = await proposeQuestionsNote(ctx);
    const content = proposal.changes[0]!.createDocument!.content;
    expect(proposal.changes[0]!.path).toBe('repos/orders-service/questions-ouvertes.md');
    expect(content).toContain('## 🎯 Le pourquoi');
    expect(content).toContain('À quoi sert ce repo, en une phrase métier ?');
    expect(content).toContain('`README.md` (l.24) dit `npm run seed`');
    expect(content).toContain('@acme/orders-team (CODEOWNERS)');
    const orders = await scanRepository({ id: 'orders-service', name: 'orders-service', path: ctx.repo.path });
    const libDir = resolve(dirs[0]!, 'pricing-rules');
    await mkdir(libDir, { recursive: true });
    await writeFile(resolve(libDir, 'package.json'), JSON.stringify({ name: '@acme/pricing-rules', version: '2.1.0' }));
    git(libDir, 'init', '-q');
    const lib = await scanRepository({ id: 'pricing-rules', name: 'pricing-rules', path: libDir });
    const { edges } = landscapeEdges([orders, lib]);
    expect(edges).toEqual([{ from: 'orders-service', to: 'pricing-rules', label: 'npm @acme/pricing-rules', evidence: ['orders-service:package.json:11'] }]);
    expect(askWho(orders, ['mta.yaml'], 'fr')).toContain('@acme/platform-team (CODEOWNERS)');
  });
});

describe('okb repo in the terminal', () => {
  const BIN = resolve(TEST_ROOT, '..', 'dist', 'cli', 'index.js');
  const run = (args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...env, OKB_LANG: 'fr', OKB_NO_INTERACTIVE: '1' }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 0, stdout, stderr }));
  });

  it('asks which KB holds company code, then works from inside the repository', async () => {
    const root = await gitFixture();
    const s = await makeSandbox({ profileId: 'perso' }, { copyVault: false });
    sandboxes.push(s);
    await mkdir(s.vault, { recursive: true });
    const env = { ...s.env, OKB_PROFILE: '' };
    delete env.OKB_PROFILE;
    const refused = await run(['repo', 'add', '--json'], env, root);
    expect(JSON.parse(refused.stdout).error).toMatchObject({ key: 'repoNeedsKb' });
    const before = await run(['repo', 'context', '--json'], env, root);
    expect(JSON.parse(before.stdout).context).toContain('Git repository OKB does not document yet ("orders-service")');

    const added = await run(['repo', 'add', '--new-kb', 'Travail', '--dir', resolve(dirs[0]!, 'kb-travail'), '--json'], env, root);
    const body = JSON.parse(added.stdout);
    expect(body).toMatchObject({ ok: true, created: true, repo: { id: 'orders-service', kb: 'travail' }, kb: { confidential: true } });
    expect(body.summary.plan.read).toBeGreaterThan(10);

    // Inside the repository, its KB is the one meant.
    const status = await run(['status', '--brief', '--json'], env, resolve(root, 'srv'));
    expect(JSON.parse(status.stdout).profile).toBe('travail');
    const elsewhere = await run(['status', '--brief', '--json'], env, dirs[0]!);
    expect(JSON.parse(elsewhere.stdout).profile, elsewhere.stdout + elsewhere.stderr).toBe('perso');

    const context = await run(['repo', 'context'], env, root);
    expect(context.stdout).toContain('OKB knows this repository: "orders-service" (KB "Travail"');
    expect(context.stdout).toContain('/okb-dev:onboard');
    const text = await run(['repo', 'status'], env, root);
    expect(text.stdout).toContain('📦 orders-service');
    expect(text.stdout).toContain('Comprendre en 10 minutes');
    const questions = await run(['repo', 'questions', '--json'], env, root);
    const q = JSON.parse(questions.stdout).questions.find((x: { id: string }) => x.id === 'q-deploy');
    expect(q).toMatchObject({ state: 'open', note: '2 Products/To sort/Code/orders-service/orders-service — Delivery.md' }); // a work brain, named in the language of the existing KBs
    expect(q.askWho).toContain('@acme/platform-team (CODEOWNERS)');
    const answered = await run(['repo', 'answer', 'q-deploy', 'Par', "l'équipe", 'plateforme', '--by', 'Marie', '--json'], env, root);
    expect(JSON.parse(answered.stdout)).toMatchObject({ ok: true, question: 'q-deploy' });
  });
});
