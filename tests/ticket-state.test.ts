import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { finishTicket, loadTicket, startTicket, ticketsDir } from '../src/work/tickets.js';
import { addAttempt, addCriterion, recordReuse, setCriterion, setTicketState, ticketDetail, updateTicketBrief } from '../src/work/ticket-state.js';
import { readGithubPr, importJiraSnapshot, type GithubRunner } from '../src/work/ticket-external.js';
import { invoke } from '../src/engine/registry.js';
import { engineRoutes } from '../src/web/api-engine.js';
import { addRepo } from '../src/repo/registry.js';
import { gitIdentity } from '../src/repo/git.js';
import { syncProjects } from '../src/projects/sources.js';
import { listEntries } from '../src/projects/journal.js';
import { developerNotesToRecheck } from '../src/work/freshness.js';
import { git, gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

async function ticket() {
  const { s, config } = await workKb();
  const path = await gitFixture();
  const repo = { id: 'orders', name: 'Orders', path, kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'ORD-42', title: 'Exporter les commandes', repo });
  return { s, config, repo };
}

describe('the developer ticket stays factual (F2.4-01..07)', () => {
  it('migrates the 1.5 record once, preserves its archive and text, and never imports it over current state', async () => {
    const { config } = await workKb();
    const dir = ticketsDir(config);
    await mkdir(dir, { recursive: true });
    const textFile = resolve(dir, 'ORD-42.md');
    await writeFile(textFile, 'Objectif donné par Alice.\n');
    const legacy = { version: 1, ref: 'ORD-42', title: 'Export', repos: [], status: 'active', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', doneAt: null, auto: false, textFile, journal: [{ at: '2026-01-01T00:00:00Z', kind: 'trap', text: 'Ne pas paginer avec OFFSET.' }] };
    const bytes = JSON.stringify(legacy);
    await writeFile(resolve(dir, 'ORD-42.json'), bytes);
    expect(await loadTicket(config, 'ORD-42')).toEqual(legacy);
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) n FROM tickets')?.n).toBe(1);
    await finishTicket(config, 'ORD-42');
    closeDbs();
    expect((await loadTicket(config, 'ORD-42'))?.status).toBe('done');
    expect(await readFile(resolve(dir, 'ORD-42.json'), 'utf8')).toBe(bytes);
    expect(await readFile(textFile, 'utf8')).toBe('Objectif donné par Alice.\n');
    expect(openDb(config).get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(8);
  });

  it('does not infer checks, review or delivery from work being finished', async () => {
    const { config } = await ticket();
    await setTicketState(config, 'ORD-42', { dimension: 'delivery', environment: 'staging', status: 'deployed' }, 'person');
    await finishTicket(config, 'ORD-42');
    const result = await ticketDetail(config, 'ORD-42');
    expect(result.detail.states.find((s) => s.dimension === 'work')?.status).toBe('done');
    for (const dimension of ['pr', 'checks', 'waiting']) expect(result.detail.states.find((s) => s.dimension === dimension)?.status).toBe('unknown');
    expect(result.detail.states.find((s) => s.dimension === 'delivery' && s.environment === 'production')?.status).toBe('unknown');
    expect(result.detail.states.find((s) => s.dimension === 'delivery' && s.environment === 'staging')?.status).toBe('deployed');
    await expect(setTicketState(config, 'ORD-42', { dimension: 'delivery', status: 'deployed' }, 'person')).rejects.toMatchObject({ code: 'E_INVALID' });
  });

  it('shows declared exit criteria and refuses closure while a required criterion is unknown or pending', async () => {
    const { config } = await ticket();
    const criterion = await addCriterion(config, 'ORD-42', { kind: 'tests', text: 'Export de 100 lignes validé', required: true });
    await expect(finishTicket(config, 'ORD-42')).rejects.toMatchObject({ code: 'E_CONFLICT', key: 'ticketCriteriaMissing' });
    expect((await loadTicket(config, 'ORD-42'))?.status).toBe('active');
    await setCriterion(config, 'ORD-42', criterion.id, 'met');
    await finishTicket(config, 'ORD-42');
    expect((await ticketDetail(config, 'ORD-42')).detail.close.allowed).toBe(true);
  });

  it('keeps failed conditions and independent concurrent changes, and gives a short resume brief', async () => {
    const { config } = await ticket();
    await updateTicketBrief(config, 'ORD-42', { goal: 'Exporter sans doublons', lastAction: 'Testé le tri', next: 'Essayer keyset' });
    await Promise.all([
      addAttempt(config, 'ORD-42', { approach: 'OFFSET', conditions: 'Insertion entre deux pages', result: 'Une commande est passée deux fois', next: 'Tri stable' }),
      setTicketState(config, 'ORD-42', { dimension: 'checks', status: 'failed', detail: 'Test pagination' }, 'person'),
      setTicketState(config, 'ORD-42', { dimension: 'pr', status: 'review' }, 'person'),
    ]);
    const r = await ticketDetail(config, 'ORD-42');
    expect(r.brief).toMatchObject({ goal: 'Exporter sans doublons', lastAction: 'Testé le tri', next: 'Essayer keyset' });
    expect(r.brief.failed[0]).toMatchObject({ approach: 'OFFSET', conditions: 'Insertion entre deux pages', result: 'Une commande est passée deux fois' });
    expect(r.detail.states.filter((s) => ['pr', 'checks'].includes(s.dimension)).map((s) => s.status).sort()).toEqual(['failed', 'review']);
    await expect(addAttempt(config, 'ORD-42', { approach: '', conditions: 'x', result: 'y' })).rejects.toMatchObject({ code: 'E_INVALID' });
  });

  it('records a note reused on another ticket, with its actual revision, and rejects missing paths and secrets', async () => {
    const { s, config } = await ticket();
    const path = 'guides/pagination.md';
    await writeFixture(resolve(s.vault, path), '---\ntype: Guide\ntitle: Pagination\ndescription: Un tri stable.\n---\n\nUtiliser keyset.\n');
    const bundle = await loadBundleFor(config);
    const saved = await recordReuse(config, 'ORD-42', bundle, { path, why: 'Évite les doublons' });
    expect(saved).toMatchObject({ path, title: 'Pagination', sha256: bundle.byPath.get(path as never)?.sha256, why: 'Évite les doublons' });
    await expect(recordReuse(config, 'ORD-42', bundle, { path: '../outside.md' })).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
    await expect(recordReuse(config, 'ORD-42', bundle, { path: 'missing.md' })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    await expect(updateTicketBrief(config, 'ORD-42', { next: 'AKIA' + 'Q3J7Z2M5K8W1R4T6' })).rejects.toMatchObject({ code: 'E_SECRET' });
  });

  it('calls only a configured GitHub read after explicit permission; a merge still leaves delivery unknown', async () => {
    const { config } = await ticket();
    const run = vi.fn<GithubRunner>(async () => JSON.stringify({ number: 17, title: 'Export', state: 'MERGED', isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], url: 'https://github.com/acme/orders/pull/17' }));
    await expect(readGithubPr(config, 'ORD-42', { repository: 'acme/orders', number: 17 }, run)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    expect(run).not.toHaveBeenCalled();
    const allowed = { ...config, connectors: { ...config.connectors, github: { enabled: true, repositories: ['acme/orders'], host: 'github.com' } } };
    await readGithubPr(allowed, 'ORD-42', { repository: 'acme/orders', number: 17 }, run);
    expect(run.mock.calls[0]?.[0]).toBe('gh');
    const r = await ticketDetail(config, 'ORD-42');
    expect(r.detail.states.find((s) => s.dimension === 'pr')).toMatchObject({ status: 'merged', source: 'github' });
    expect(r.detail.states.find((s) => s.dimension === 'checks')).toMatchObject({ status: 'passed', source: 'github' });
    expect(r.detail.states.find((s) => s.dimension === 'delivery')?.status).toBe('unknown');
  });

  it('validates a complete external snapshot before changing any state and distinguishes declared Jira information', async () => {
    const { config } = await ticket();
    const allowed = { ...config, connectors: { ...config.connectors, github: { enabled: true, repositories: ['acme/orders'], host: 'github.com' } } };
    await expect(readGithubPr(allowed, 'ORD-42', { repository: 'acme/orders', number: 17 }, async () => '{"state":"MERGED"}')).rejects.toMatchObject({ code: 'E_INVALID' });
    expect((await ticketDetail(config, 'ORD-42')).detail.states.find((s) => s.dimension === 'pr')?.status).toBe('unknown');
    await importJiraSnapshot(config, 'ORD-42', { issue: 'ORD-42', status: 'In review', url: 'https://issues.acme.test/browse/ORD-42', observedAt: '2026-10-11T10:00:00Z' });
    const r = await ticketDetail(config, 'ORD-42');
    expect(r.detail.external).toMatchObject({ provider: 'jira', declared: true, issue: 'ORD-42', status: 'In review' });
    expect(r.detail.states.find((s) => s.dimension === 'work')?.status).toBe('unknown');
  });

  it('does not partially import a malformed archive, even with a valid ticket beside it', async () => {
    const { config } = await workKb();
    const dir = ticketsDir(config);
    await mkdir(dir, { recursive: true });
    const r = { version: 1, ref: 'A-1', title: 'A', repos: [], status: 'active', startedAt: 'now', updatedAt: 'now', doneAt: null, auto: false, textFile: null, journal: [] };
    await writeFile(resolve(dir, 'A-1.json'), JSON.stringify(r));
    await writeFile(resolve(dir, 'Z-1.json'), '{"ref":"Z-1"}');
    await expect(loadTicket(config, 'A-1')).rejects.toMatchObject({ code: 'E_INVALID', key: 'ticketArchiveInvalid' });
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) n FROM tickets')?.n).toBe(0);
    expect(await readFile(resolve(dir, 'Z-1.json'), 'utf8')).toBe('{"ref":"Z-1"}');
  });

  it('keeps simultaneous finish/reopen observations consistent and cannot bypass required criteria through work state', async () => {
    const { config } = await ticket();
    await Promise.all([
      setTicketState(config, 'ORD-42', { dimension: 'work', status: 'done' }, 'person'),
      setTicketState(config, 'ORD-42', { dimension: 'work', status: 'in-progress' }, 'person'),
    ]);
    const r = await ticketDetail(config, 'ORD-42');
    expect(r.ticket.status).toBe(r.detail.states.find((s) => s.dimension === 'work')?.status === 'done' ? 'done' : 'active');
    await addCriterion(config, 'ORD-42', { kind: 'confirmation', text: 'Confirmé par Alice', required: true });
    await expect(setTicketState(config, 'ORD-42', { dimension: 'work', status: 'done' }, 'person')).rejects.toMatchObject({ key: 'ticketCriteriaMissing' });
    expect((await ticketDetail(config, 'ORD-42')).ticket.status).toBe('active');
  });

  it('binds app operations to the same guards, scopes criteria to their ticket and bounds failure history', async () => {
    const { s, config, repo } = await ticket();
    const agent = { config, env: s.env, actor: 'agent' as const };
    for (const id of ['tickets.close', 'tickets.github', 'tickets.github.configure', 'tickets.jira'] as const) await expect(invoke(id, {}, agent)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
    await startTicket(config, { ref: 'ORD-43', repo });
    const c = await addCriterion(config, 'ORD-43', { kind: 'tests', text: 'Seulement pour 43' });
    await expect(setCriterion(config, 'ORD-42', c.id, 'met')).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    const db = openDb(config);
    db.tx(() => { for (let i = 0; i < 200; i++) db.run('INSERT INTO ticket_attempts (id, ref, approach, conditions, result, at) VALUES (?, ?, ?, ?, ?, ?)', `T-${i}`, 'ORD-42', 'x', 'y', 'z', 'now'); });
    await expect(addAttempt(config, 'ORD-42', { approach: 'Encore', conditions: 'x', result: 'y' })).rejects.toMatchObject({ key: 'ticketDetailLimit' });
    const routes = engineRoutes(async () => config);
    const changed = await routes['POST /api/ticket/state']!({ env: s.env }, new URLSearchParams(), { ref: 'ORD-42', dimension: 'delivery', status: 'deployed', environment: 'staging' }) as Awaited<ReturnType<typeof ticketDetail>>;
    expect(changed.detail.states.find((s) => s.dimension === 'delivery' && s.environment === 'staging')?.status).toBe('deployed');
    expect(changed.detail.states.find((s) => s.dimension === 'delivery' && s.environment === 'production')?.status).toBe('unknown');
  });

  it('puts reuse and failed conditions in the journal, and rechecks a cited note after a commit (F2.4-05/06)', async () => {
    const { s, config, repo } = await ticket();
    const { repo: registered } = await addRepo({ path: repo.path, kb: config.profile.id }, s.env);
    const base = (await gitIdentity(repo.path)).head!;
    const path = `repos/${registered.id}/guide.md`;
    await writeFixture(resolve(s.vault, path), `---\ntype: Guide\ntitle: Pagination\ndescription: Le tri.\nx_okb:\n  repo: { id: ${registered.id}, commit: ${base} }\nsources:\n  - title: ${registered.name}/srv/orders-service.js\n---\n\nLa limite est 50.\n`);
    const bundle = await loadBundleFor(config);
    expect(await developerNotesToRecheck(config, s.env, bundle)).toEqual([]);
    await recordReuse(config, 'ORD-42', bundle, { path, why: 'Pour l’export' });
    await addAttempt(config, 'ORD-42', { approach: 'OFFSET', conditions: 'Ajout concurrent', result: 'Doublons' });
    await syncProjects(config, s.env);
    const lines = (await listEntries(config, s.env)).map((e) => e.text);
    expect(lines).toContain('Pagination — Pour l’export');
    expect(lines).toContain('OFFSET — Ajout concurrent → Doublons');
    const code = resolve(repo.path, 'srv/orders-service.js');
    await writeFile(code, (await readFile(code, 'utf8')).replace('|| 50', '|| 100'));
    git(repo.path, 'commit', '-qam', 'Raise export limit');
    const today = await invoke('today.view', {}, { config, env: s.env, actor: 'person' });
    expect(today.notesToRecheck).toContainEqual(expect.objectContaining({ path, verdict: 'changed', files: ['srv/orders-service.js'], next: `okb repo update ${registered.id}` }));
    expect(today.recheckUnavailable).toEqual([]);
  });
});
