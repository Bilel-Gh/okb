import { describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { setSubjectField } from '../src/fields/sourced.js';
import { addRepo } from '../src/repo/registry.js';
import { scanAndStore } from '../src/repo/scan.js';
import { renderBrief, type Brief } from '../src/work/brief.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

/** The fictional CAP repository (its CODEOWNERS names @acme/orders-team), registered under a product. */
async function setup() {
  const { config } = await workKb();
  const root = await gitFixture();
  const { repo } = await addRepo({ path: root, kb: 'travail', product: 'Commerce' });
  await scanAndStore(config, repo);
  const person = { config, env: process.env, actor: 'person' as const };
  const agent = { config, env: process.env, actor: 'agent' as const };
  return { config, repo, person, agent };
}

describe('F2.4-19 · the team responsible for a repository (D73)', () => {
  it('is discreet when unknown, suggests CODEOWNERS, and never fills it on its own', async () => {
    const { repo, person } = await setup();
    const team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.value).toBeNull();
    expect(team.inherited).toBeNull();
    expect(team.suggestion).toMatchObject({ value: '@acme/orders-team', origin: 'github' });
    await invoke('team.suggestion.dismiss', { kind: 'repo', subject: repo.id, value: '@acme/orders-team' }, person);
    expect((await invoke('team.get', { kind: 'repo', subject: repo.id }, person)).suggestion).toBeNull();
  });

  it('keeps the person’s value; another source becomes a conflict the person settles', async () => {
    const { repo, person, agent } = await setup();
    await invoke('team.set', { kind: 'repo', subject: repo.id, value: 'Équipe Commandes' }, person);
    const r = await invoke('team.set', { kind: 'repo', subject: repo.id, value: 'Équipe Paiement', origin: 'servicenow', url: 'https://snow.example.test/group/42' }, agent);
    expect(r).toMatchObject({ changed: false, conflict: { value: 'Équipe Paiement', origin: 'servicenow' } });
    let team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.value).toMatchObject({ value: 'Équipe Commandes', origin: 'person', manual: true });
    expect(team.conflicts).toHaveLength(1);
    await invoke('team.conflict.resolve', { kind: 'repo', subject: repo.id, keep: 'servicenow' }, person);
    team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.value).toMatchObject({ value: 'Équipe Paiement', origin: 'servicenow', url: 'https://snow.example.test/group/42' });
    expect(team.conflicts).toEqual([]);
  });

  it('lets the agent fill an empty team with its origin and link, and the terminal write as the person', async () => {
    const { repo, person, agent } = await setup();
    await invoke('team.set', { kind: 'repo', subject: repo.id, value: 'Équipe Commandes', origin: 'jira', url: 'https://jira.example.test/projects/ORD' }, agent);
    expect((await invoke('team.get', { kind: 'repo', subject: repo.id }, person)).value).toMatchObject({ origin: 'jira', manual: false });
    // A person writing through the terminal writes in their own name, whatever origin they type (as in lot A).
    await invoke('team.set', { kind: 'repo', subject: repo.id, value: 'Équipe Logistique', origin: 'jira' }, person);
    expect((await invoke('team.get', { kind: 'repo', subject: repo.id }, person)).value).toMatchObject({ value: 'Équipe Logistique', origin: 'person', manual: true });
  });

  it('inherits the product’s team until the repository has its own', async () => {
    const { repo, person } = await setup();
    await invoke('team.set', { kind: 'product', subject: 'Commerce', value: 'Équipe Commerce', origin: 'wiki', url: 'https://wiki.example.test/team' }, person);
    let team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.value).toBeNull();
    expect(team.inherited).toMatchObject({ product: 'Commerce', value: { value: 'Équipe Commerce' } });
    await invoke('team.set', { kind: 'repo', subject: repo.id, value: 'Équipe Commandes' }, person);
    team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.value?.value).toBe('Équipe Commandes');
  });

  it('refuses a placeholder, and accepts « not applicable » with a reason', async () => {
    const { repo, person, config } = await setup();
    await expect(invoke('team.set', { kind: 'repo', subject: repo.id, value: 'TBD' }, person)).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(setSubjectField(config, 'repo', repo.id, { field: 'team', value: '  inconnu ', origin: 'agent' })).rejects.toMatchObject({ code: 'E_INVALID' });
    await invoke('team.na', { kind: 'repo', subject: repo.id, reason: 'bibliothèque partagée sans propriétaire' }, person);
    const team = await invoke('team.get', { kind: 'repo', subject: repo.id }, person);
    expect(team.notApplicable).toBe('bibliothèque partagée sans propriétaire');
    await expect(invoke('team.na', { kind: 'repo', subject: repo.id, reason: 'x' }, { ...person, actor: 'agent' as const })).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
  });

  it('refuses a repository or a product this KB does not know', async () => {
    const { person } = await setup();
    await expect(invoke('team.set', { kind: 'repo', subject: 'nowhere', value: 'Équipe X' }, person)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    await expect(invoke('team.set', { kind: 'product', subject: 'Nulle part', value: 'Équipe X' }, person)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

describe('F2.4-20 · asking the agent for the team', () => {
  it('keeps one open request per subject, lists it, and gives a prompt that says where to look', async () => {
    const { repo, person, agent } = await setup();
    const a = await invoke('team.requests.create', { kind: 'repo', subject: repo.id }, person);
    const b = await invoke('team.requests.create', { kind: 'repo', subject: repo.id }, person);
    expect(b.id).toBe(a.id);
    expect((await invoke('team.requests.list', {}, agent)).requests.map((r) => r.id)).toEqual([a.id]);
    const { prompt } = await invoke('team.requests.prompt', { id: a.id, lang: 'fr' }, agent);
    expect(prompt).toContain('ServiceNow');
    expect(prompt).toContain(`okb team set repo ${repo.id}`);
    expect(prompt).toContain('N’invente rien');
    const closed = await invoke('team.requests.close', { id: a.id, found: ['team'], missing: [], read: ['servicenow'], unavailable: [], note: '' }, agent);
    expect(closed.state).toBe('done');
    expect((await invoke('team.requests.list', {}, agent)).requests).toEqual([]);
    expect((await invoke('team.get', { kind: 'repo', subject: repo.id }, person)).request).toBeNull();
  });
});

describe('F2.4-19 · the session brief names the team', () => {
  const base: Brief = {
    workspace: null, kb: { id: 'travail', name: 'Travail', root: '/kb' }, sharedKb: null, via: 'folder',
    repo: { id: 'orders', name: 'orders', path: '/code/orders' }, notes: [], recentTickets: [], shared: [], talksTo: [], calledBy: [],
    ticket: null, repos: [], activeTickets: [], landscape: null, requests: [],
  };
  it('says who is responsible, where it comes from, and the open team requests', () => {
    const text = renderBrief({ ...base, team: { value: 'Équipe Commandes', origin: 'servicenow', inherited: null }, teamRequests: [{ id: 'T-1a2b3c', kind: 'repo', subject: 'orders', since: '' }] });
    expect(text).toContain('Team responsible: Équipe Commandes (servicenow)');
    expect(text).toContain('okb team requests close');
    expect(renderBrief({ ...base, team: { value: 'Équipe Commerce', origin: 'wiki', inherited: 'Commerce' } })).toContain('Team responsible: Équipe Commerce (from product Commerce, wiki)');
    expect(renderBrief(base)).not.toContain('Team responsible');
  });
});
