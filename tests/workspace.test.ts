import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { ask } from '../src/pipeline/ask.js';
import type { RepoEntry } from '../src/repo/registry.js';
import { scopeRank } from '../src/work/rank.js';
import { reposNamed } from '../src/work/scope.js';
import { ticketId } from '../src/work/tickets.js';
import { reposIn, ticketRefs } from '../src/work/workspaces.js';
import { writeFixture } from './helpers/sandbox.js';
import { git, useRepoSandboxes, workKb } from './helpers/repo.js';
import { json, run, team } from './helpers/team.js';

// End-to-end scenarios: dozens of real Git and okb processes; on a loaded machine they need more than one test's usual 90 s.
const SCENARIO_TIMEOUT = 180_000;

useRepoSandboxes();

describe('a workspace: one KB for a team of repositories, narrowed to the one at hand', () => {
  it('registers a team folder, narrows to the repository and ticket the user names, and follows the ticket without AI', async () => {
    const { ws, orders } = await team();
    const { s } = await workKb();
    const env = { ...s.env };
    delete env.OKB_PROFILE;

    const added = await json(['workspace', 'add', ws, '--kb', 'travail', '--name', 'Acme'], env, ws);
    expect(added).toMatchObject({ ok: true, created: true, kb: 'travail', workspace: { id: 'acme', name: 'Acme', tickets: { prefixes: ['ORD'] } } });
    expect(added.repos.map((r: { id: string }) => r.id).sort()).toEqual(['billing-service', 'orders-service', 'pricing-rules']);
    expect(added.landscapeProposal).toBeTruthy();

    // At the top of the workspace: its KB, the whole workspace in scope.
    expect((await json(['status', '--brief'], env, ws)).profile).toBe('travail');
    const whole = await json(['scope'], env, ws);
    expect(whole).toMatchObject({ via: 'none', workspace: 'acme', repo: null });
    expect(whole.brief.repos).toHaveLength(3);

    // The user names a repository and a ticket: OKB narrows to it and says how to follow the ticket.
    const routed = await json(['route', '--suggest', '--cwd', ws, "j'ai le ticket ORD-42 sur orders-service, il faut autoriser 100 lignes"], env, ws);
    expect(routed.scope).toMatchObject({ repo: 'orders-service', ticket: 'ORD-42', changed: true });
    expect(routed.context).toContain('OKB narrowed its scope to "orders-service"');
    expect(routed.context).toContain('okb ticket resume ORD-42 --repo orders-service');
    expect(routed.context).toContain(`Code: ${orders}`);
    // Naming the repository already in scope adds nothing to say.
    expect((await json(['route', '--suggest', '--cwd', ws, 'on reste sur orders-service'], env, ws)).scope).toBeNull();
    // A question across two repositories keeps the scope.
    expect((await json(['route', '--suggest', '--cwd', ws, 'comment billing-service et orders-service se parlent ?'], env, ws)).scope).toBeNull();
    expect(await json(['scope'], env, ws)).toMatchObject({ via: 'chosen', repo: 'orders-service' });

    const started = await json(['ticket', 'start', 'ORD-42', '--text', 'ORD-42 : autoriser les commandes de 100 lignes'], env, ws);
    expect(started).toMatchObject({ ok: true, created: true, repo: 'orders-service', ticket: { ref: 'ORD-42', title: 'autoriser les commandes de 100 lignes', status: 'active' } });
    expect(started.ask).toContain('--repo orders-service');

    // Inside the repository's folder, a ticket OKB does not follow yet is reported too.
    const inRepo = await json(['route', '--suggest', '--cwd', orders, 'je commence aussi ORD-77'], env, orders);
    expect(inRepo.scope).toMatchObject({ repo: 'orders-service', ticket: 'ORD-77', changed: false });
    expect(inRepo.context).toContain('okb ticket resume ORD-77 --repo orders-service');
    expect((await json(['route', '--suggest', '--cwd', orders, 'où en est ORD-42 ?'], env, orders)).scope).toBeNull();

    // The work happens on a branch named after the ticket: OKB finds it and follows its commits.
    git(orders, 'checkout', '-qb', 'feature/ORD-42-lines');
    const service = resolve(orders, 'srv', 'orders-service.js');
    await writeFile(service, (await readFile(service, 'utf8')).replace('|| 50', '|| 100'));
    git(orders, 'commit', '-qam', 'ORD-42 raise the item limit to 100');
    const hooked = await json(['ticket', 'commit', '--cwd', orders], env, orders);
    expect(hooked.context).toContain('joined ticket ORD-42');
    expect((await json(['ticket', 'commit', '--cwd', orders], env, orders)).context).toBe('');
    expect(await json(['ticket', 'note', 'la limite vient du WMS, pas du front', '--kind', 'trap'], env, orders)).toMatchObject({ ok: true, ticket: 'ORD-42' });

    const line = (await json(['status', '--brief'], env, orders)).line;
    expect(line).toContain('📦 orders-service');
    expect(line).toContain('🎫 ORD-42');
    const brief = (await run(['scope', '--context', '--cwd', orders], env, orders)).stdout;
    expect(brief).toContain('OKB scope — repository "orders-service" (workspace "Acme"');
    expect(brief).toContain('Ticket ORD-42');
    expect(brief).toContain('feature/ORD-42-lines: 1 commit(s)');
    expect(brief).toContain('trap: la limite vient du WMS, pas du front');
    expect(brief).toContain('calls pricing-rules (npm @acme/pricing-rules)');

    // Merged and back on main: the next session still sees the ticket, and that its note is missing.
    git(orders, 'checkout', '-q', 'main');
    git(orders, 'merge', '-q', '--no-ff', '-m', 'Merge ORD-42', 'feature/ORD-42-lines');
    const after = (await run(['scope', '--context', '--cwd', orders], env, orders)).stdout;
    expect(after).toContain('merged');
    expect(after).toContain('This ticket looks finished and has no note yet');

    const done = await json(['ticket', 'done'], env, orders);
    expect(done).toMatchObject({ ok: true, ticket: { ref: 'ORD-42', status: 'done' } });
    const facts = await readFile(done.repos[0].file, 'utf8');
    expect(facts).toContain('ORD-42 : autoriser les commandes de 100 lignes');
    expect(facts).toContain('ORD-42 raise the item limit to 100');
    expect(facts).toContain('Piège : la limite vient du WMS, pas du front');
    expect(done.repos[0].suggested.ticketNote).toMatch(/^repos\/orders-service\/tickets\/\d{4}-\d{2}-\d{2}-ord-42-autoriser-les-commandes-de-100-lignes\.md$/);

    // Inside another repository of the workspace, the folder decides.
    const billing = await json(['scope'], env, resolve(ws, 'billing-service'));
    expect(billing).toMatchObject({ via: 'folder', repo: 'billing-service', ticket: null });
  }, SCENARIO_TIMEOUT);

  it('finds the repositories of a folder but not a KB kept beside them', async () => {
    const { ws } = await team();
    await workKb();
    expect((await reposIn(ws)).map((p) => p.slice(ws.length + 1))).toEqual(['billing-service', 'libs/pricing-rules', 'orders-service']);
  });
});

describe('ticket references and repository names in plain words', () => {
  it('reads ticket references without mistaking versions or encodings for them', () => {
    expect(ticketRefs('voir ORD-42 (UTF-8, HTTP-2, ISO-8601) et ABC-7', null, 'message')).toEqual(['ORD-42', 'ABC-7']);
    expect(ticketRefs('feature/abc-123-export', null, 'branch')).toEqual(['ABC-123']);
    expect(ticketRefs('chore/node-18', null, 'branch')).toEqual([]);
    expect(ticketRefs('le ticket ord 42 et ORD_43', { prefixes: ['ORD'], pattern: null }, 'message')).toEqual(['ORD-42', 'ORD-43']);
    expect(ticketRefs('#481 corrigé', { prefixes: [], pattern: '#(\\d+)' }, 'message')).toEqual(['481']);
    expect(ticketId('ord_42')).toBe('ORD-42');
    expect(ticketId('Ajouter l’export CSV')).toBe('T-ajouter-l-export-csv');
  });

  it('recognises a repository by name, and common words only next to "repo"', () => {
    const r = (id: string): RepoEntry => ({ id, name: id, path: `/x/${id}`, remote: null, kb: 'k', addedAt: '' });
    const repos = [r('orders-service'), r('api'), r('web')];
    expect(reposNamed('un bug dans orders-service', repos).map((x) => x.id)).toEqual(['orders-service']);
    expect(reposNamed('orders-service-v2 est ailleurs', repos)).toEqual([]);
    expect(reposNamed('il faut une api pour le web', repos)).toEqual([]);
    expect(reposNamed('dans le repo api, la route /orders', repos).map((x) => x.id)).toEqual(['api']);
  });
});

describe('search inside a scope', () => {
  it('ranks the repository and the shared notes tied to it above another repository’s notes', async () => {
    const { s, config } = await workKb();
    const note = (path: string, title: string, body: string) => writeFixture(resolve(s.vault, path), `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}, pour les tests du périmètre.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-15T09:00:00Z }\n---\n\n${body}\n`);
    await note('repos/billing-service/annulation.md', 'Annulation des factures', 'Annulation : une facture annulée reste numérotée. Annulation annulation.');
    await note('repos/orders-service/carte-du-code.md', 'Carte du code', 'L’annulation d’une commande passe par [la règle](../../concepts/annulation.md).');
    await note('concepts/annulation.md', 'Annulation', 'Une annulation défait une commande avant expédition.');
    await note('guides/paiement.md', 'Paiement', 'Le paiement et l’annulation côté banque.');
    const bundle = await loadBundleFor(config);
    // Without a scope, another repository's note wins: the noise a scope removes.
    const plain = await ask(config, 'annulation', { bundle });
    expect(plain.hits[0]!.path).toBe('repos/billing-service/annulation.md');
    const rank = scopeRank(bundle, { id: 'orders-service', name: 'orders-service' });
    const scoped = await ask(config, 'annulation', { bundle, scope: rank });
    expect(scoped.hits.map((h) => h.path)).toEqual(['concepts/annulation.md', 'repos/orders-service/carte-du-code.md', 'repos/billing-service/annulation.md', 'guides/paiement.md']);
    expect(scoped.hits[0]!.why[0]).toBe('scope:tied');
  });
});
