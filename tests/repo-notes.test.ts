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

describe('repository notes', () => {
  it('prepares the overview, records answers, unknowns and anchors, then knows its notes once applied', async () => {
    const { config, repo, ctx } = await registered();
    const { report, target } = await writeRepoNote(ctx, dossier(config));
    expect(target).toMatchObject({ mode: 'create', path: 'repos/orders-service/comprendre.md', title: 'Comprendre orders-service en 10 minutes' });
    const content = report.proposal.changes[0]!.createDocument!.content;
    expect(content).toMatch(/kind: overview/);
    expect(content).toMatch(/commit: [0-9a-f]{40}/);
    expect(content).toContain('Écrit depuis le code et la doc de **orders-service** au commit');
    expect(content).toContain('[^readme-');
    expect(content).toMatch(/orders-service\/srv\/orders-service\.js — l\.23/);
    expect(content).toContain('Qui gère les paiements ? — à demander à @acme/orders-team (cherché dans README.md)');
    const progress = await loadProgress(ctx.paths);
    expect(progress.questions['q-purpose']).toMatchObject({ status: 'answered', note: 'repos/orders-service/comprendre.md' });
    expect(progress.questions['q-scope']).toMatchObject({ status: 'unknown', askWho: '@acme/orders-team' });
    expect(Object.keys(progress.anchors['repos/orders-service/comprendre.md']!.files)).toEqual(['README.md', 'package.json', 'srv/orders-service.js']);

    let status = await repoStatus(ctx);
    expect(status.notes.find((n) => n.kind === 'overview')!.state).toBe('pending');
    expect(status.questions.find((q) => q.id === 'q-purpose')!.state).toBe('pending');

    await approve(config, report.proposal);
    const bundle = await loadBundleFor(config);
    expect(repoNotes(bundle, repo.id).map((n) => n.kind)).toEqual(['overview']);
    status = await repoStatus(ctx, { bundle });
    expect(status.questions.find((q) => q.id === 'q-purpose')!.state).toBe('answered');
    expect(status.questions.find((q) => q.id === 'q-scope')!.state).toBe('unknown');

    await expect(writeRepoNote(ctx, dossier(config))).rejects.toMatchObject({ key: 'repoNoteExists' });
    const again = await writeRepoNote(ctx, dossier(config, { sections: [{ role: 'how', claims: [{ id: 'how-max', text: 'Une commande a au plus 50 lignes par défaut.', kind: 'reported', evidence: [{ file: 'srv/orders-service.js', quote: 'Number(process.env.ORDER_MAX_ITEMS || 50)' }] }] }] }), { heading: 'Mise à jour' });
    expect(again.target).toMatchObject({ mode: 'append', path: 'repos/orders-service/comprendre.md' });
  });

  it('tells which notes the code moved under', async () => {
    const { root, config, ctx } = await registered();
    const { report } = await writeRepoNote(ctx, dossier(config));
    await approve(config, report.proposal);
    expect((await freshness(ctx)).notes[0]!.verdict).toBe('fresh');
    const service = resolve(root, 'srv', 'orders-service.js');
    await writeFile(service, (await readFile(service, 'utf8')).replace('const cds', '// orders\nconst cds'));
    git(root, 'commit', '-qam', 'comment');
    let fresh = await freshness(ctx);
    expect(fresh.notes[0]).toMatchObject({ verdict: 'changed', files: [{ file: 'srv/orders-service.js', state: 'changed', missingQuotes: 0 }] });
    await writeFile(service, (await readFile(service, 'utf8')).replace("'Shipped orders cannot be cancelled'", "'Only new orders can be cancelled'"));
    await writeFile(resolve(root, 'srv', 'returns.cds'), 'service ReturnsService {}\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'cancel rule');
    fresh = await freshness(ctx);
    expect(fresh.notes[0]).toMatchObject({ verdict: 'stale', files: [{ file: 'srv/orders-service.js', state: 'changed', missingQuotes: 1 }] });
    expect(fresh.news).toEqual([{ file: 'srv/returns.cds', why: 'data or service model' }]);
  });

  it('checks reading-agent findings against the files and records coverage', async () => {
    const { ctx } = await registered();
    const saved = await addFindings(ctx, {
      version: 1, repo: 'orders-service', area: 'srv',
      read: [{ file: 'srv/orders-service.js', lines: 'all' }],
      facts: [{ question: 'q-flows', text: 'La création vérifie le crédit.', kind: 'reported', evidence: [{ file: 'srv/orders-service.js', quote: "if (!ok) return req.error(409, 'Credit limit exceeded');" }] }],
      unknowns: [{ question: 'q-monitor', text: 'Aucune configuration de supervision.', looked: ['srv/'] }],
      terms: [{ term: 'Credit limit', meaning: 'Plafond de crédit du client.', evidence: [{ file: 'db/schema.cds', quote: 'creditLimit : Decimal(15, 2);' }] }],
    });
    expect(saved).toMatchObject({ facts: 1, unknowns: 1, terms: 1, questions: ['q-flows'], covered: 1 });
    const stored = JSON.parse(await readFile(saved.file, 'utf8'));
    expect(stored.facts[0].evidence[0].lines).toBe('17');
    const progress = await loadProgress(ctx.paths);
    expect(progress.coverage['srv/orders-service.js']!.lines).toBe('all');
    expect(progress.questions['q-monitor']!.status).toBe('unknown');
    await expect(addFindings(ctx, { version: 1, repo: 'orders-service', area: 'db', facts: [{ text: 'Faux.', kind: 'reported', evidence: [{ file: 'db/schema.cds', quote: 'entity Invoices' }] }] })).rejects.toMatchObject({ key: 'repoQuoteMissing' });
    const status = await repoStatus(ctx);
    expect(status.questions.find((q) => q.id === 'q-flows')!.state).toBe('found');
    expect(status.coverage.readTotal).toBeGreaterThan(10);
  });

  it('keeps a person’s answer as a dated, citable source', async () => {
    const { config, ctx } = await registered();
    const { file, question } = await recordAnswer(ctx, { question: 'q-deploy', text: 'La prod est déployée par l’équipe plateforme le jeudi.', by: 'Marie' });
    expect(question).toBe('q-deploy');
    expect(await readFile(file, 'utf8')).toContain('Réponse de Marie');
    expect((await repoStatus(ctx)).questions.find((q) => q.id === 'q-deploy')!.state).toBe('received');
    const { report } = await writeRepoNote(ctx, {
      ...dossier(config), note: 'delivery', template: 'repo-delivery', answers: ['q-deploy'], unknowns: [],
      sections: [
        { role: 'config', claims: [{ id: 'cfg-max', text: 'ORDER_MAX_ITEMS limite le nombre de lignes.', kind: 'reported', evidence: [{ file: 'srv/orders-service.js', quote: 'process.env.ORDER_MAX_ITEMS' }] }] },
        { role: 'deploy', claims: [{ id: 'deploy-who', text: 'La production est déployée par l’équipe plateforme.', kind: 'reported', evidence: [{ file, quote: 'déployée par l’équipe plateforme' }] }] },
      ],
    });
    expect(report.proposal.changes[0]!.path).toBe('repos/orders-service/livrer-et-exploiter.md');
    expect(report.proposal.changes[0]!.createDocument!.content).toMatch(/title: .*Réponse de Marie|q-deploy/s);
    await expect(recordAnswer(ctx, { question: 'q-nope', text: 'x y', by: 'me' })).rejects.toMatchObject({ key: 'repoQuestionUnknown' });
  });
});

