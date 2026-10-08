import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { proposeCategory } from '../src/categories/assign.js';
import { BUILTIN_CATEGORIES, categorise, loadCategories, mergeCategories } from '../src/categories/categories.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { buildGraph, neighbours } from '../src/kb/graph.js';
import { louvain } from '../src/kb/communities.js';
import { humaniseTag, nameTheme, themeTitle, type ThemeNote } from '../src/kb/themes.js';
import { maintain } from '../src/maintain/maintain.js';
import { saveProposal } from '../src/proposal/store.js';
import { suggestIntent } from '../src/routing/intent.js';
import { computeStatus } from '../src/status/status.js';
import { loadTemplates } from '../src/templates/registry.js';
import { serve } from '../src/web/serve.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function env() {
  const s = await makeSandbox({ profileId: 'acme' });
  sandboxes.push(s);
  return { s, config: await s.config() };
}

describe('note categories', () => {
  it('decide from an explicit choice, then the template, the type, the folder', () => {
    const cats = [...BUILTIN_CATEGORIES];
    expect(categorise({ path: 'x/a.md', template: 'tutorial', type: 'Concept', explicit: 'decision' }, cats)).toEqual({ category: 'decision', via: 'explicit' });
    expect(categorise({ path: 'x/a.md', template: 'tutorial', type: 'Concept' }, cats)).toEqual({ category: 'howto', via: 'template' });
    expect(categorise({ path: 'x/a.md', template: 'repo-ticket' }, cats)).toEqual({ category: 'ticket', via: 'template' });
    expect(categorise({ path: 'x/a.md', type: 'runbook' }, cats)).toEqual({ category: 'howto', via: 'type' });
    expect(categorise({ path: 'cas-clients/energie.md' }, cats)).toEqual({ category: 'case', via: 'folder' });
    expect(categorise({ path: 'brouillons/idee.md', type: 'Note' }, cats)).toEqual({ category: 'other', via: 'none' });
    expect(categorise({ path: 'a.md', explicit: 'nope', template: 'path' }, cats).category).toBe('path');
    const ids = cats.map((c) => c.id);
    expect(ids).toEqual(['concept', 'guide', 'howto', 'process', 'case', 'ticket', 'decision', 'source', 'path', 'other']);
    expect(new Set(cats.map((c) => c.color)).size).toBe(cats.length);
  });

  it('let a KB rename, recolour, add categories and move templates', async () => {
    const { s, config } = await env();
    await mkdir(resolve(s.vault, '.okb'), { recursive: true });
    await writeFile(resolve(s.vault, '.okb', 'categories.yaml'), [
      'categories:',
      '  - id: case',
      '    label: { fr: Incidents, en: Incidents }',
      '    color: "#b45309"',
      '  - id: client',
      '    label: { fr: Clients, en: Clients }',
      '    emoji: "🏢"',
      '    templates: [client-case]',
      '    folders: [clients]',
      '',
    ].join('\n'));
    const cats = await loadCategories(config);
    expect(cats.map((c) => c.id)).toEqual(['concept', 'guide', 'howto', 'process', 'case', 'ticket', 'decision', 'source', 'path', 'client', 'other']);
    expect(cats.find((c) => c.id === 'case')).toMatchObject({ label: { fr: 'Incidents' }, color: '#b45309', templates: ['experience'] });
    expect(categorise({ path: 'a.md', template: 'client-case' }, cats).category).toBe('client');
    expect(categorise({ path: 'clients/x.md' }, cats).category).toBe('client');
    await writeFile(resolve(s.vault, '.okb', 'categories.yaml'), 'categories: [{ id: Bad }]\n');
    await expect(loadCategories(config)).rejects.toMatchObject({ code: 'E_CONFIG' });
    expect(mergeCategories(BUILTIN_CATEGORIES, [])).toHaveLength(BUILTIN_CATEGORIES.length);
  });

  it('draw the KB as a graph of exact links, with prerequisites and counts', async () => {
    const { config } = await env();
    const bundle = await loadBundleFor(config);
    const graph = buildGraph(bundle, await loadCategories(config), await loadTemplates(config));
    expect(graph.nodes.map((n) => n.id)).toEqual(['architecture/fleet-overview.md', 'concepts/dispatcher.md', 'concepts/idempotence.md', 'concepts/telemetry-channel.md', 'flows/run-a-delivery-job.md', 'reference/glossary.md']);
    expect(graph.edges).toHaveLength(11);
    expect(graph.edges.filter((e) => e.kind === 'prereq').map((e) => `${e.source}>${e.target}`).sort()).toEqual(['concepts/dispatcher.md>concepts/idempotence.md', 'flows/run-a-delivery-job.md>concepts/dispatcher.md', 'flows/run-a-delivery-job.md>concepts/idempotence.md']);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get('concepts/dispatcher.md')).toMatchObject({ category: 'concept', in: 4, out: 3, folder: 'concepts', area: 'concepts' });
    expect(byId.get('architecture/fleet-overview.md')!.category).toBe('guide');
    expect(byId.get('flows/run-a-delivery-job.md')!.category).toBe('howto');
    expect(graph.categories.find((c) => c.id === 'concept')!.count).toBe(3);
    const { incoming, outgoing } = neighbours(graph, 'concepts/idempotence.md');
    expect(incoming.map((n) => n.id).sort()).toEqual(['concepts/dispatcher.md', 'flows/run-a-delivery-job.md', 'reference/glossary.md']);
    expect(outgoing.map((n) => n.id)).toEqual(['concepts/dispatcher.md']);
    const withNav = buildGraph(bundle, await loadCategories(config), [], { includeNav: true });
    expect(withNav.nodes.some((n) => n.id === 'index.md')).toBe(true);
    const status = await computeStatus(config, { light: true });
    expect(status.categories.map((c) => [c.id, c.count])).toEqual([['concept', 3], ['guide', 2], ['howto', 1]]);
  });

  it('move a note to another category through a proposal the person approves', async () => {
    const { s, config } = await env();
    await writeFile(resolve(s.vault, 'idee.md'), '---\ntype: Note\ntitle: Idée\ndescription: x\nstatus: draft\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\n---\n\nUne idée.\n');
    expect((await maintain(config)).issues.filter((i) => i.code === 'NO_CATEGORY').map((i) => i.path)).toEqual(['idee.md']);
    const proposal = await proposeCategory(config, 'idee.md', 'decision');
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0]).toMatchObject({ kind: 'patch-frontmatter', label: 'category of idee.md: other → decision' });
    expect(await readFile(resolve(s.vault, 'idee.md'), 'utf8')).not.toContain('category');
    await saveProposal(config, proposal);
    await grantApproval(config, proposal, ['c-category'], 'human:testuser');
    await applyProposal(config, proposal);
    const text = await readFile(resolve(s.vault, 'idee.md'), 'utf8');
    expect(text).toMatch(/x_okb:\n {2}v: 1\n {2}category: decision/);
    expect(text).toContain('Une idée.');
    expect((await maintain(config)).issues.some((i) => i.code === 'NO_CATEGORY')).toBe(false);
    await expect(proposeCategory(config, 'idee.md', 'decision')).rejects.toMatchObject({ key: 'categorySame' });
    await expect(proposeCategory(config, 'idee.md', 'nope')).rejects.toMatchObject({ key: 'categoryUnknown' });
    await expect(proposeCategory(config, 'absent.md', 'guide')).rejects.toMatchObject({ key: 'noteUnknown' });
    expect((await proposeCategory(config, 'idee.md', 'auto')).changes[0]!.label).toBe('category of idee.md: back to automatic');
  });

  it('serve the graph, the categories and exact backlinks to the web app', async () => {
    const { s, config } = await env();
    const { server, url } = await serve(config, { port: 0, env: s.env });
    closers.push(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
    const graph = await (await fetch(`${url}/api/graph`)).json();
    expect(graph.nodes).toHaveLength(6);
    expect(graph.categories[0]).toMatchObject({ id: 'concept', count: 3, emoji: '💡' });
    const note = await (await fetch(`${url}/api/note?path=concepts/idempotence.md`)).json();
    expect(note.category).toBe('concept');
    expect(note.backlinks.map((b: { path: string }) => b.path).sort()).toEqual(['concepts/dispatcher.md', 'flows/run-a-delivery-job.md', 'reference/glossary.md']);
    expect(note.outlinks).toEqual([{ path: 'concepts/dispatcher.md', title: 'Dispatcher', category: 'concept' }]);
    const notes = await (await fetch(`${url}/api/notes`)).json();
    expect(notes.notes.find((n: { path: string }) => n.path === 'flows/run-a-delivery-job.md').category).toBe('howto');
    const cats = await (await fetch(`${url}/api/categories`)).json();
    expect(cats.categories.find((c: { id: string }) => c.id === 'howto').templates.map((t: { id: string }) => t.id)).toEqual(['procedure', 'tutorial', 'repo-start', 'repo-delivery', 'environments', 'repo-test', 'repo-debug', 'method', 'recipe', 'checklist', 'cheatsheet']);
    for (const asset of ['/vendor/d3-force.js', '/js/graph.js', '/js/views/graph.js', '/js/views/categories.js']) {
      const r = await fetch(`${url}${asset}`);
      expect(r.status, asset).toBe(200);
      expect(r.headers.get('content-type')).toContain('javascript');
    }
    expect(await (await fetch(`${url}/vendor/d3-force.js`)).text()).toContain('forceSimulation');
    const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
    const set = await fetch(`${url}/api/categories/set`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify({ path: 'reference/glossary.md', category: 'concept' }) });
    expect((await set.json()).proposalId).toMatch(/^p-/);
  });

  it('find the themes of a KB (Louvain communities), deterministically', () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'z'];
    const links: { source: string; target: string }[] = [];
    for (const [g, n] of [['a', 5], ['b', 4]] as const) for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) links.push({ source: `${g}${i}`, target: `${g}${j}` });
    links.push({ source: 'a1', target: 'b1' }, { source: 'b1', target: 'a1' });
    const found = louvain(ids, links);
    expect(found.list.map((c) => c.members)).toEqual([['a1', 'a2', 'a3', 'a4', 'a5'], ['b1', 'b2', 'b3', 'b4']]);
    expect(found.of.get('z')).toBe(-1);
    expect(found.modularity).toBe(0.364); // 10/18 − (22/36)² + 6/18 − (14/36)²
    expect(louvain(ids, links)).toEqual(found);
    expect(louvain(['x', 'y'], []).list).toEqual([]);
  });

  it('name each theme after a note of the theme, without emoji or subtitle', async () => {
    const { config } = await env();
    const graph = buildGraph(await loadBundleFor(config), await loadCategories(config), await loadTemplates(config));
    expect(graph.communities.length).toBeGreaterThan(0);
    expect(graph.communities.reduce((n, c) => n + c.size, 0)).toBe(graph.nodes.filter((n) => n.community >= 0).length);
    for (const c of graph.communities) {
      expect(graph.nodes.find((n) => n.id === c.hub)!.community).toBe(c.id);
      if (c.namedBy === 'note') expect(c.label).toBe(themeTitle(graph.nodes.find((n) => n.id === c.hub)!.title));
    }
  });

  it('name a theme after the guide that explains it, not its busiest concept or the home page', () => {
    const note = (id: string, title: string, category: string, tags: string[] = []): ThemeNote => ({ id, title, category, tags });
    const links = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      for (const [x, y] of [[a, b], [b, a]] as const) links.set(x, (links.get(x) ?? new Set()).add(y));
    };
    // A finance theme: the guide explains four concepts; "affaire" is the busiest
    // note but links everywhere; the home page links to every theme of the KB.
    const finance = [
      note('guides/finance.md', '💶 La finance d’une affaire : du coût réel à l’estimation finale', 'guide'),
      note('concepts/eac.md', 'EAC', 'concept'), note('concepts/eaf.md', 'EAF', 'concept'),
      note('concepts/cbs.md', 'CBS', 'concept'), note('concepts/affaire.md', 'Affaire', 'concept'),
      note('accueil.md', '🏠 Argo : accueil et parcours de lecture', 'guide'),
    ];
    for (const c of ['eac', 'eaf', 'cbs', 'affaire']) link('guides/finance.md', `concepts/${c}.md`);
    link('concepts/eac.md', 'concepts/eaf.md');
    link('concepts/eac.md', 'concepts/cbs.md');
    for (const c of ['eac', 'eaf', 'cbs', 'affaire']) link('concepts/affaire.md', `concepts/${c}.md`);
    for (let i = 0; i < 8; i++) { link('concepts/affaire.md', `elsewhere/${i}.md`); link('accueil.md', `elsewhere/${i}.md`); }
    for (const c of ['eac', 'affaire']) link('accueil.md', `concepts/${c}.md`);
    link('accueil.md', 'guides/finance.md');
    const named = nameTheme(finance, links, new Map());
    expect(named).toEqual({ hub: 'guides/finance.md', label: 'La finance d’une affaire', namedBy: 'note' });

    // Only concepts, nearly all tagged alike and the tag used nowhere else: the tag names it.
    const brain = [
      note('concepts/inbox.md', 'Inbox', 'concept', ['concept', 'second-cerveau']),
      note('concepts/capture.md', 'Capture', 'concept', ['concept', 'second-cerveau']),
      note('concepts/ipcra.md', 'IPCRA', 'concept', ['concept', 'second-cerveau']),
      note('concepts/zettel.md', 'Zettelkasten', 'concept', ['concept', 'apprentissage']),
      note('guides/retenir.md', 'Apprendre et retenir', 'guide', ['ingested']),
    ];
    for (const [a, b] of [['inbox', 'capture'], ['capture', 'ipcra'], ['ipcra', 'inbox'], ['zettel', 'ipcra']]) link(`concepts/${a}.md`, `concepts/${b}.md`);
    link('guides/retenir.md', 'concepts/zettel.md');
    const tags = new Map([['concept', 40], ['second-cerveau', 3], ['apprentissage', 2], ['ingested', 30]]);
    const byTag = nameTheme(brain, links, tags);
    expect(byTag).toMatchObject({ label: 'Second cerveau', namedBy: 'tag', tag: 'second-cerveau', hub: 'concepts/ipcra.md' });
  });

  it('turn titles and tags into short, readable theme names', () => {
    expect(themeTitle('🔄 Le cycle d’une affaire, de l’opportunité au REX')).toBe('Le cycle d’une affaire');
    expect(themeTitle('🔐 Approuver, appliquer, annuler : les garde-fous de la KB')).toBe('Approuver, appliquer, annuler');
    expect(themeTitle('Argo : accueil et parcours de lecture')).toBe('Argo : accueil et parcours de lecture');
    expect(themeTitle('Devis, avenants et factures')).toBe('Devis, avenants et factures');
    expect(humaniseTag('securite-ia', [{ id: 'a', title: 'Sécurité des données et IA', category: 'guide', tags: [] }])).toBe('Sécurité IA');
    expect(humaniseTag('second-cerveau')).toBe('Second cerveau');
  });

  it('offer the graph from plain words', () => {
    expect(suggestIntent('montre-moi le graphe de ma kb', { kbs: [], otherTools: [] })?.command).toBe('okb serve');
    expect(suggestIntent('show me my knowledge graph', { kbs: [], otherTools: [] })?.command).toBe('okb serve');
  });
});
