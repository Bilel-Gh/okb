import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { finishMerge } from '../src/work/merge.js';
import { finishTicket, loadTicket, startTicket, ticketsDir } from '../src/work/tickets.js';
import { addAttempt, addCriterion, recordReuse, setCriterion, setTicketState, ticketDetail, updateTicketBrief } from '../src/work/ticket-state.js';
import { importJiraSnapshot } from '../src/work/ticket-external.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function profiles() {
  const { s, config: source } = await workKb();
  const target = { ...source, profile: { ...source.profile, id: 'workspace' }, kb: { ...source.kb, root: resolve(s.dir, 'workspace') }, stateHome: resolve(s.dir, 'workspace-state') };
  await mkdir(target.kb.root, { recursive: true });
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: source.profile.id, addedAt: '', remote: null };
  return { source, target, repo };
}

describe('repository KB merge preserves SQLite tickets', () => {
  it('transfers all state, remaps private text and reused notes, survives reopening, and is idempotent', async () => {
    const { source, target, repo } = await profiles();
    await startTicket(source, { ref: 'ORD-42', title: 'Exporter', text: 'Objectif initial.\n', repo });
    const note = '---\ntype: Guide\ntitle: Pagination\ndescription: Tri stable.\n---\n\nUtiliser keyset.\n';
    await writeFixture(resolve(source.kb.root, 'pagination.md'), note);
    // The person has already applied the merge proposal; its note is in the final folder.
    await writeFixture(resolve(target.kb.root, 'repos/orders/pagination.md'), note);
    await updateTicketBrief(source, 'ORD-42', { goal: 'Sans doublons', lastAction: 'Testé OFFSET', next: 'Essayer keyset' });
    await addAttempt(source, 'ORD-42', { approach: 'OFFSET', conditions: 'Insertion concurrente', result: 'Doublon', next: 'Tri stable' });
    await recordReuse(source, 'ORD-42', await loadBundleFor(source), { path: 'pagination.md', why: 'Tri stable' });
    await setTicketState(source, 'ORD-42', { dimension: 'delivery', environment: 'staging', status: 'deployed' }, 'person');
    const criterion = await addCriterion(source, 'ORD-42', { kind: 'tests', text: 'Export validé', required: true });
    await setCriterion(source, 'ORD-42', criterion.id, 'met');
    await importJiraSnapshot(source, 'ORD-42', { issue: 'ORD-42', status: 'Review', url: 'https://issues.acme.test/browse/ORD-42', observedAt: '2026-10-11T10:00:00Z' });
    await finishTicket(source, 'ORD-42');
    await startTicket(source, { ref: 'OTHER-1', repo: { ...repo, id: 'other' } });
    const before = await ticketDetail(source, 'ORD-42');
    expect(await finishMerge(source, target, repo)).toMatchObject({ tickets: 1 });
    closeDbs();
    const transferred = await ticketDetail(target, 'ORD-42');
    expect(transferred.ticket).toEqual({ ...before.ticket, textFile: resolve(ticketsDir(target), 'ORD-42.md') });
    expect(transferred.detail).toEqual({ ...before.detail, reuses: before.detail.reuses.map((r) => ({ ...r, path: `repos/orders/${r.path}` })) });
    expect(transferred.brief).toEqual(before.brief);
    expect(await readFile(transferred.ticket.textFile!, 'utf8')).toBe('Objectif initial.\n');
    expect(await loadTicket(target, 'OTHER-1')).toBeNull();
    expect(await finishMerge(source, target, repo)).toMatchObject({ tickets: 0 });
    expect(await ticketDetail(source, 'ORD-42')).toEqual(before);
    await startTicket(target, { ref: 'ORD-42', repo });
    const resumed = await ticketDetail(target, 'ORD-42');
    expect(resumed.ticket.status).toBe('active');
    expect(resumed.detail.attempts).toEqual(before.detail.attempts);
    expect(resumed.detail.criteria).toEqual(before.detail.criteria);
    expect(resumed.detail.external).toEqual(before.detail.external);
    expect(resumed.detail.states.find((s) => s.dimension === 'delivery' && s.environment === 'staging')?.status).toBe('deployed');
  });

  it('refuses a conflicting target reference before importing any ticket, without replacing the target', async () => {
    const { source, target, repo } = await profiles();
    await startTicket(source, { ref: 'ORD-42', title: 'Source', repo });
    await startTicket(source, { ref: 'ORD-43', repo });
    await startTicket(target, { ref: 'ORD-42', title: 'Target', repo });
    await expect(finishMerge(source, target, repo)).rejects.toMatchObject({ code: 'E_CONFLICT', key: 'ticketMergeConflict' });
    expect((await loadTicket(target, 'ORD-42'))?.title).toBe('Target');
    expect(await loadTicket(target, 'ORD-43')).toBeNull();
    expect(openDb(target).get<{ n: number }>('SELECT COUNT(*) n FROM tickets')?.n).toBe(1);
  });

  it('also transfers legacy JSON imported on demand, leaving the source archive untouched', async () => {
    const { source, target, repo } = await profiles();
    await mkdir(ticketsDir(source), { recursive: true });
    const textFile = resolve(ticketsDir(source), 'OLD-1.md');
    await writeFile(textFile, 'Ancien texte.\n');
    const legacy = { version: 1, ref: 'OLD-1', title: 'Ancien', repos: [{ id: repo.id, branch: null, base: null, baseRef: null }], status: 'active', startedAt: '2026-01-01', updatedAt: '2026-01-01', doneAt: null, auto: false, textFile, journal: [] };
    const bytes = JSON.stringify(legacy);
    await writeFile(resolve(ticketsDir(source), 'OLD-1.json'), bytes);
    expect(await finishMerge(source, target, repo)).toMatchObject({ tickets: 1 });
    expect(await loadTicket(target, 'OLD-1')).toEqual({ ...legacy, textFile: resolve(ticketsDir(target), 'OLD-1.md') });
    expect(await readFile(resolve(ticketsDir(source), 'OLD-1.json'), 'utf8')).toBe(bytes);
    expect(await readFile(textFile, 'utf8')).toBe('Ancien texte.\n');
  });
});
