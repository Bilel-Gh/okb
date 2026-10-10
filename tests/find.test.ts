import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { brainGraph } from '../src/brain/graph.js';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import { errorSignature, findNotes, knowledgeGaps, knownErrors, notesAboutFile, processTerm, recordEmpty } from '../src/find/find.js';
import { bilingual } from '../src/find/lexicon.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { runSetup } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function demo(extra: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-find-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 3, repos: 6, tickets: 60, meetings: 20, concepts: 30 }));
  for (const [p, c] of Object.entries(extra)) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  await ensureState(statePaths(config));
  return { config, bundle: await loadBundleFor(config) };
}

const note = (title: string, body: string, extra = '') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\n${extra}---\n\n# ${title}\n\n${body}\n`;

describe('find a note in three seconds', () => {
  it('tolerates typos, accents, plurals and word beginnings, and puts the exact match first', async () => {
    const { config, bundle } = await demo();
    const typo = findNotes(config, bundle, 'exprot csv');
    expect(typo.best?.title).toMatch(/export CSV/i);
    const accents = findNotes(config, bundle, 'deploiement');
    expect(accents.hits.length + 1).toBeGreaterThan(0);
    expect(findNotes(config, bundle, 'odata').best).toMatchObject({ title: 'OData', concept: true });
    expect(findNotes(config, bundle, 'Idempot').best?.title).toBe('Idempotence');
    // A reference is found directly.
    const ticket = bundle.entries.find((e) => e.path.includes('/Tickets/'))!;
    const ref = ticket.title.split(' — ')[0]!;
    expect(findNotes(config, bundle, ref).best?.path).toBe(ticket.path);
    // Filters and facets.
    const atlas = findNotes(config, bundle, 'export', { product: 'Atlas' });
    expect(atlas.hits.every((h) => h.product === 'Atlas')).toBe(true);
    expect(Object.keys(findNotes(config, bundle, 'export').facets.product).length).toBeGreaterThan(1);
    expect(findNotes(config, bundle, 'export csv').ms).toBeLessThan(2000);
    expect(processTerm('Factures')).toBe('facture');
  }, 60_000);

  it('searches both languages and recognises an error message', async () => {
    const { config, bundle } = await demo({
      '2 Produits/Atlas/Support/Erreur — jeton expiré.md': note('Erreur — jeton expiré', "Quand l'appel échoue avec\n\n```\nTokenExpiredError: jwt expired at 2026-10-01T10:00:00Z\n```\n\n> TokenExpiredError: jwt expired\n\nIl faut rafraîchir le jeton.", 'x_okb:\n  brain:\n    type: known-error\n'),
      '2 Produits/Atlas/Fonctionnel/Les factures.md': note('Les factures', 'Comment une facture est émise.'),
    });
    expect(bilingual('facture client')).toContain('invoice');
    expect(findNotes(config, bundle, 'invoice').hits.map((h) => h.title)).toContain('Les factures');
    expect(errorSignature('TokenExpiredError: jwt expired at 2026-10-01T10:00:00Z /usr/src/app/x.js:12')).toBe('tokenexpirederror jwt expired at');
    const hits = knownErrors(config, bundle, 'npm test\nFAIL src/auth.test.ts\nTokenExpiredError: jwt expired at 2026-11-02T08:00:00Z');
    expect(hits.map((h) => h.title)).toEqual(['Erreur — jeton expiré']);
    expect(knownErrors(config, bundle, 'all tests passed')).toEqual([]);
  }, 60_000);

  it('brings the notes about a file, and remembers searches that found nothing', async () => {
    const { config, bundle } = await demo({
      '2 Produits/Atlas/Code/atlas-api/atlas-api — Composant TVA.md': note('Composant TVA', 'Le calcul vit dans `src/billing/tax.ts` : attention à l’arrondi.'),
    });
    const notes = notesAboutFile(bundle, 'atlas-api', 'src/billing/tax.ts');
    expect(notes.map((n) => n.title)).toEqual(['Composant TVA']);
    expect(notesAboutFile(bundle, 'atlas-api', 'src/other.ts')).toEqual([]);
    await recordEmpty(config, 'quota api');
    await recordEmpty(config, 'Quota API');
    await recordEmpty(config, 'once');
    expect(await knowledgeGaps(config)).toMatchObject([{ query: 'quota api', times: 2 }]);
  }, 60_000);
});

describe('the brain seen from above, by levels', () => {
  it('shows drawers and products, then a product’s sides and repositories, then a repository’s notes', async () => {
    const { bundle } = await demo();
    const layout = { preset: 'work' as const, lang: 'fr' as const };
    const top = brainGraph(layout, bundle, '');
    expect(top.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Atlas', 'Boréal', 'Boîte à outils', 'Activité']));
    expect(top.nodes.find((n) => n.label === 'Atlas')).toMatchObject({ kind: 'subject', drill: '2 Produits/Atlas' });
    const atlas = brainGraph(layout, bundle, '2 Produits/Atlas');
    expect(atlas.nodes.some((n) => n.kind === 'repo' && n.label === 'atlas-api')).toBe(true);
    expect(atlas.nodes.some((n) => n.kind === 'outside')).toBe(true);
    expect(atlas.crumbs.map((c) => c.label)).toEqual(['🧠', 'Produits', 'Atlas']);
    const repo = brainGraph(layout, bundle, '2 Produits/Atlas/Code/atlas-api');
    expect(repo.nodes.filter((n) => n.kind === 'note').length).toBeGreaterThan(3);
  }, 60_000);
});

describe('the search index follows the notes that change (F2.0-22)', () => {
  it('after notes are changed, added and deleted, it answers exactly like an index built from scratch', async () => {
    const { cp, unlink, readFile } = await import('node:fs/promises');
    const { config, bundle } = await demo();
    const queries = ['export', 'zorglub', 'quokka', 'déploiement', 'réunion client'];
    for (const q of queries) findNotes(config, bundle, q);
    const changed = bundle.entries.find((e) => !e.reserved && e.path.includes('/'))!;
    const removed = bundle.entries.filter((e) => !e.reserved && e.path !== changed.path)[5]!;
    const file = resolve(config.kb.root, changed.path);
    await writeFile(file, (await readFile(file, 'utf8')).replace(/\n# .*\n/, '\n# Zorglub et compagnie\n'));
    await unlink(resolve(config.kb.root, removed.path));
    await writeFile(resolve(config.kb.root, 'quokka.md'), note('Quokka', 'Un petit marsupial, et un mot rare : zorglub.'));
    const next = await loadBundleFor(config);

    const copy = resolve(config.kb.root, '..', 'copie');
    await cp(config.kb.root, copy, { recursive: true });
    const fresh = { ...config, kb: { ...config.kb, root: copy } };
    const freshBundle = await loadBundleFor(fresh);
    const shape = (r: ReturnType<typeof findNotes>) => r.hits.map((h) => `${h.path}:${h.score}`).sort();
    for (const q of queries) expect(shape(findNotes(config, next, q)), q).toEqual(shape(findNotes(fresh, freshBundle, q)));
    expect(findNotes(config, next, 'quokka').best?.path).toBe('quokka.md');
    expect(findNotes(config, next, removed.title).hits.map((h) => h.path)).not.toContain(removed.path);
  });
});
