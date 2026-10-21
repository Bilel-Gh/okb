import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { listProposals, loadProposal, updateProposalStatus } from '../src/proposal/store.js';
import { guardApply } from '../src/apply/guard.js';
import { materializeFile, groupChangesByPath } from '../src/proposal/materialize.js';
import { validatePlannedFiles } from '../src/proposal/validate.js';
import { applyProposal } from '../src/apply/apply.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { parseOkf } from '../src/okf/document.js';
import { addRepo } from '../src/repo/registry.js';
import { recordReuse, updateTicketBrief } from '../src/work/ticket-state.js';
import { loadTicket, startTicket, ticketText } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
async function fixture() {
  const { s, config } = await workKb();
  const { repo } = await addRepo({ path: await gitFixture(), kb: config.profile.id }, s.env);
  return { s, config, repo, ctx: { config, env: s.env, actor: 'agent' as const } };
}
async function note(root: string, path: string, title: string, repo: string, goal = 'Objectif relu') {
  const file = resolve(root, path);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, `---\ntitle: ${JSON.stringify(title)}\nx_okb:\n  brain:\n    type: ticket\n    ref: ${title.match(/ORD-\d+/)?.[0] ?? 'ORD-42'}\n    repo: ${repo}\n---\n# ${title}\n\n## Objectif\n${goal}\n\n## Prochaine étape\nVérifier la recette\n`);
  return file;
}
describe('one ticket gesture reconciles local state and authorized knowledge', () => {
  it('creates follow-up and a single proposal, preserves both on identical retry and respects a dismissed proposal', async () => {
    const { repo, config, ctx } = await fixture();
    const input = { ref: 'ord_42', repo: repo.id, title: 'Exporter', text: 'ORD-42 : Exporter\nDemande initiale', goal: 'Exporter sans doublons' };
    const first = await invoke('tickets.resume', input, ctx);
    expect(first.created).toBe(true);
    expect(first.ticket.ref).toBe('ORD-42');
    expect(first.proposal?.id).toBeTruthy();
    const proposed = await loadProposal(config, first.proposal!.id);
    // D70: the proposed note declares its ticket, so it is linked wherever it is filed.
    expect(proposed.changes[0]!.replaceDocument?.content ?? proposed.changes[0]!.createDocument?.content).toMatch(/tickets:\s*\n\s*- ORD-42/);
    expect((await guardApply(config, proposed, proposed.changes)).ok).toBe(true);
    const planned = new Map([...groupChangesByPath(proposed.changes)].map(([path, changes]) => [path, { before: null, after: materializeFile(path, null, changes) }]));
    await expect(validatePlannedFiles(config, planned)).resolves.toBeUndefined();
    await expect(applyProposal(config, proposed, { dryRun: true })).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    const retry = await invoke('tickets.resume', input, ctx);
    expect(retry.ticket).toEqual(first.ticket);
    expect(retry.proposal?.id).toBe(first.proposal?.id);
    expect(await listProposals(config)).toHaveLength(1);
    await updateProposalStatus(config, first.proposal!.id, 'superseded');
    const refused = await invoke('tickets.resume', input, ctx);
    expect(refused.proposal?.status).toBe('superseded');
    expect(await listProposals(config)).toHaveLength(1);
    expect(refused.detail.states.find((s) => s.dimension === 'delivery')?.status).toBe('unknown');
  });
  it('restores a note-only ticket without editing the human note, and reports conflicting incoming facts', async () => {
    const { repo, config, ctx } = await fixture();
    const file = await note(config.kb.root, 'repos/orders-service/tickets/ord-42.md', 'ORD-42 : Exporter', repo.id);
    const before = await readFile(file, 'utf8');
    const resumed = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id }, ctx);
    expect(resumed.notes.map((n) => n.path)).toEqual(['repos/orders-service/tickets/ord-42.md']);
    expect(resumed.detail.goal).toBe('Objectif relu');
    expect(resumed.detail.next).toBe('Vérifier la recette');
    expect(resumed.proposal).toBeNull();
    await updateTicketBrief(config, 'ORD-42', { goal: 'Correction humaine' });
    const conflict = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, goal: 'Ancienne formulation', text: 'Nouvelle information' }, ctx);
    expect(conflict.detail.goal).toBe('Correction humaine');
    expect(conflict.conflicts).toContainEqual(expect.objectContaining({ field: 'goal', kept: 'Correction humaine', incoming: 'Ancienne formulation' }));
    expect(await readFile(file, 'utf8')).toBe(before);
    const proposal = await loadProposal(config, conflict.proposal!.id);
    expect(parseOkf(proposal.changes[0]!.path, proposal.changes[0]!.replaceDocument!.content).body.startsWith(parseOkf(proposal.changes[0]!.path, before).body)).toBe(true);
    expect(proposal.changes[0]!.replaceDocument!.content).toContain('Ancienne formulation');
    expect((await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, goal: 'Ancienne formulation', text: 'Nouvelle information' }, ctx)).proposal?.id).toBe(conflict.proposal?.id);
    expect((await guardApply(config, proposal, proposal.changes)).ok).toBe(true);
    await expect(validatePlannedFiles(config, new Map([[proposal.changes[0]!.path, { before, after: materializeFile(proposal.changes[0]!.path, before, proposal.changes) }]]))).resolves.toBeUndefined();
    await writeFile(file, before + '\nCorrection humaine postérieure.\n');
    expect((await guardApply(config, proposal, proposal.changes)).violations).toContainEqual(expect.objectContaining({ code: 'E_STALE' }));
  });
  it('preserves original ticket text and does not duplicate journal entries on repeated start/resume', async () => {
    const { repo, config, ctx } = await fixture();
    const original = await startTicket(config, { ref: 'ORD-42', repo, text: 'Demande humaine initiale' });
    await startTicket(config, { ref: 'ORD-42', repo, text: 'Texte différent' });
    expect(await ticketText((await loadTicket(config, 'ORD-42'))!)).toBe('Demande humaine initiale\n');
    const first = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, text: 'Texte différent' }, ctx);
    const second = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, text: 'Texte différent' }, ctx);
    expect(second.ticket.journal).toEqual(first.ticket.journal);
    expect(original.record.repos).toEqual(second.ticket.repos);
  });
  it('selects the exact reference in the named repo, blocks ambiguous legacy notes and excludes secret notes', async () => {
    const { repo, config, ctx } = await fixture();
    await note(config.kb.root, 'repos/elsewhere/tickets/ord-42.md', 'ORD-42 : Autre repo', 'elsewhere');
    await note(config.kb.root, 'repos/orders-service/tickets/ord-420.md', 'ORD-420 : Faux positif', repo.id);
    const file = await note(config.kb.root, 'tickets/a.md', 'ORD-42 : Un', '');
    await note(config.kb.root, 'tickets/b.md', 'ORD-42 : Deux', '');
    await expect(invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id }, ctx)).rejects.toMatchObject({ code: 'E_CONFLICT' });
    expect(await loadTicket(config, 'ORD-42')).toBeNull();
    await writeFile(file, (await readFile(file, 'utf8')).replace('x_okb:', 'x_okb:\n  confidentiality: secret'));
    const resumed = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id }, ctx);
    expect(resumed.notes).toHaveLength(1);
    expect(resumed.notes[0]?.path).toBe('tickets/b.md');
  });
  it('keeps multi-repo work under one explicit reference and imports declared facts exactly once', async () => {
    const { repo, config, ctx, s } = await fixture();
    const { repo: second } = await addRepo({ path: await gitFixture(), kb: config.profile.id }, s.env);
    const facts = { ref: 'ORD-42', repo: repo.id, context: 'Export paginé', decisions: [{ text: 'Tri stable', why: 'Évite les doublons' }], attempts: [{ approach: 'OFFSET', conditions: 'Insertion simultanée', result: 'Doublons', next: 'Keyset' }], criteria: [{ kind: 'tests' as const, text: '100 lignes sans doublon', required: true }], sources: ['Demande fournie dans cette session'], waiting: { status: 'blocked' as const, detail: 'Accès à la recette' } };
    const first = await invoke('tickets.resume', facts, ctx);
    const repeated = await invoke('tickets.resume', facts, ctx);
    expect(repeated.ticket).toEqual(first.ticket);
    expect(repeated.detail.attempts).toEqual(first.detail.attempts);
    expect(repeated.detail.criteria).toEqual(first.detail.criteria);
    expect(repeated.detail.states).toEqual(first.detail.states);
    const attached = await invoke('tickets.resume', { ref: 'ord_42', repo: second.id }, ctx);
    expect(attached.ticket.repos).toHaveLength(2);
    expect(attached.created).toBe(false);
    expect(attached.attached).toBe(true);
    expect(attached.detail.states.find((s) => s.dimension === 'delivery')?.status).toBe('unknown');
  });

  it('preserves the existing accepted-suggestion circuit for brain proposals without blocking local resume', async () => {
    const { repo, config, ctx } = await fixture();
    const brain = { ...config, kb: { ...config.kb, brain: { preset: 'work' as const, names: 'fr' as const, views: 'app' as const, version: 1 as const } } };
    const result = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, goal: 'Exporter' }, { ...ctx, config: brain });
    expect(result.created).toBe(true);
    expect(result.proposal).toBeNull();
    expect(result.proposalDeferred).toMatchObject({ reason: 'suggestRequired' });
    expect(await listProposals(brain)).toEqual([]);
    const retry = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, goal: 'Exporter' }, { ...ctx, config: brain });
    expect(retry.ticket).toEqual(result.ticket);
    expect(retry.proposalDeferred).toEqual(result.proposalDeferred);
  });

  it('moves old verification into history for new facts while preserving human text and unknown fields', async () => {
    const { repo, config, ctx } = await fixture();
    const file = await note(config.kb.root, 'repos/orders-service/tickets/ord-42.md', 'ORD-42 : Exporter', repo.id);
    const base = await readFile(file, 'utf8');
    const before = base.replace('x_okb:', 'status: stable\nverified:\n  by: human:fixture\n  at: 2026-10-10T12:00:00Z\nx-vendor:\n  untouched: true\nx_okb:\n  prior_verified:\n    - by: human:earlier\n  custom: preserve');
    await writeFile(file, before);
    const result = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id, context: 'Nouvelle information déclarée' }, ctx);
    const p = await loadProposal(config, result.proposal!.id);
    const after = parseOkf(p.changes[0]!.path, p.changes[0]!.replaceDocument!.content);
    expect(after.data.status).toBe('draft');
    expect(after.data.verified).toEqual([]);
    expect(after.data['x-vendor']).toEqual({ untouched: true });
    expect(after.data.x_okb).toMatchObject({ custom: 'preserve', prior_verified: [{ by: 'human:earlier' }, { by: 'human:fixture', at: expect.any(String) }] });
    expect(after.body.startsWith(parseOkf(p.changes[0]!.path, before).body)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(before);
  });
  it('never returns a person-only secret reuse when an agent resumes a ticket', async () => {
    const { repo, config, ctx } = await fixture();
    await startTicket(config, { ref: 'ORD-42', repo });
    const file = await note(config.kb.root, 'private-ticket.md', 'ORD-77 : Secret title marker', repo.id);
    await writeFile(file, (await readFile(file, 'utf8')).replace('x_okb:', 'x_okb:\n  confidentiality: secret'));
    await recordReuse(config, 'ORD-42', await loadBundleFor(config), { path: 'private-ticket.md', why: 'Secret private explanation marker' }, 'person');
    const person = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id }, { ...ctx, actor: 'person' });
    expect(person.detail.reuses).toHaveLength(1);
    const agent = await invoke('tickets.resume', { ref: 'ORD-42', repo: repo.id }, ctx);
    expect(agent.detail.reuses).toEqual([]);
    expect(JSON.stringify(agent)).not.toContain('Secret title marker');
    expect(JSON.stringify(agent)).not.toContain('private-ticket.md');
  });

});
