import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import type { OkbConfig } from '../src/config/schema.js';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { exportPack, mergePack } from '../src/packs/pack.js';
import { listProposals, loadProposal } from '../src/proposal/store.js';
import { writeSetting } from '../src/settings/settings.js';
import { runSetup } from '../src/setup/setup.js';
import { baggageDraft, internalDetails, keepInBaggage } from '../src/spaces/baggage.js';
import { baggageKb, listSpaces, spaceOf } from '../src/spaces/space.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);

/** A work brain, and beside it the person's own baggage (a career brain) in the same OKB home. */
async function twoSpaces(options: { baggage?: boolean } = {}) {
  const work = await demoBrain();
  if (options.baggage === false) return { ...work, baggage: null as unknown as OkbConfig, baggageRoot: '' };
  const baggageRoot = resolve(work.dir, 'bagage');
  await mkdir(baggageRoot, { recursive: true });
  await runSetup({ profileId: 'bagage', kbRoot: baggageRoot, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Mon bagage', brain: { preset: 'career', names: 'fr' } }, { env: work.env });
  const { config: baggage } = await loadConfig({ env: work.env, profileId: 'bagage' });
  const { config } = await loadConfig({ env: work.env, profileId: 'travail' });
  return { ...work, config, baggage, baggageRoot };
}

const LESSON = 'Leçons/Isoler chaque appel.md';
const NOTE = `---
type: Procedure
title: Isoler chaque appel pour trouver une lenteur
description: La méthode qui a trouvé la lenteur de l’export d’Atlas.
status: stable
generated:
  by: agent:claude
  at: 2026-10-06T12:00:00Z
sources:
  - title: journal du ticket
    resource: tickets/ABC-101.md
x_okb:
  v: 1
  id: n-lesson0001
  brain:
    type: method
---

# Isoler chaque appel pour trouver une lenteur

Sur Atlas, l’export prenait 40 secondes. Le ticket ABC-101 a coûté 12 000 € de retard.

1. Rejouer chaque appel seul, avec son temps ([le tableau interne](https://wiki.acme-interne.example/perf)).
2. Demander à paul.martin@acme.example les journaux de atlas-api.
3. Lire [la définition du percentile](https://fr.wikipedia.org/wiki/Centile).
`;

async function withLesson() {
  const s = await twoSpaces();
  await mkdir(resolve(s.kb, '3 Boîte à outils/Méthodes'), { recursive: true });
  const path = '3 Boîte à outils/Méthodes/Isoler chaque appel pour trouver une lenteur.md';
  await writeFile(resolve(s.kb, path), NOTE);
  return { ...s, path };
}

describe('two spaces: Mon bagage and Travail (F2.0-12)', () => {
  it('a career brain is the baggage, any other brain is work, and the person can say otherwise', async () => {
    const { config, baggage, env } = await twoSpaces();
    expect([spaceOf(config), spaceOf(baggage)]).toEqual(['work', 'baggage']);
    await writeSetting('travail', 'kb.space', 'baggage', env);
    expect(spaceOf((await loadConfig({ env, profileId: 'travail' })).config)).toBe('baggage');
    await expect(writeSetting('travail', 'kb.space', 'partout', env)).rejects.toMatchObject({ key: 'settingBadValue' });
  });

  it('the person chooses a space, then one of its brains', async () => {
    const { env } = await twoSpaces();
    expect((await listSpaces(env)).map((s) => [s.id, s.kbs.map((k) => k.id)])).toEqual([['baggage', ['bagage']], ['work', ['travail']]]);
  });

  it('the baggage never leaves in a share', async () => {
    const { baggage, config } = await twoSpaces();
    expect((await failure(exportPack(baggage, await loadBundleFor(baggage), '3 Boîte à outils'))).key).toBe('spaceBaggageStays');
    // A work brain still shares a folder…
    const pack = await exportPack(config, await loadBundleFor(config), '3 Boîte à outils');
    expect(pack.notes.length).toBeGreaterThan(0);
    // …and what a colleague shares from work does not enter the baggage that way.
    expect((await failure(mergePack(baggage, pack, 'Reçu'))).key).toBe('spaceBaggageStays');
  });

  it('knows which brain is the baggage, and says when there is none', async () => {
    const { env } = await twoSpaces();
    expect((await baggageKb(env))?.profile.id).toBe('bagage');
    const alone = await twoSpaces({ baggage: false });
    expect(await baggageKb(alone.env)).toBeNull();
  });
});

describe('« Garder dans mon bagage » (F2.0-12)', () => {
  it('finds what belongs to the workplace in a note', async () => {
    const { config, path } = await withLesson();
    const bundle = await loadBundleFor(config);
    const found = await internalDetails(config, bundle, bundle.docs.get(path as never)!.body);
    expect(found.map((d) => [d.kind, d.text]).sort()).toEqual([
      ['amount', '12 000 €'], ['email', 'paul.martin@acme.example'], ['product', 'Atlas'],
      // « atlas-api » names a repository: the product's name inside it is not counted again.
      ['repository', 'atlas-api'], ['ticket', 'ABC-101'], ['url', 'https://wiki.acme-interne.example/perf'],
    ].sort());
  });

  it('prepares a first version without them, which reads the same otherwise', async () => {
    const { config, path } = await withLesson();
    const bundle = await loadBundleFor(config);
    const draft = await baggageDraft(config, bundle, path);
    expect(draft.title).toBe('Isoler chaque appel pour trouver une lenteur');
    expect(draft.removed).toHaveLength(6);
    expect(await internalDetails(config, bundle, draft.text)).toEqual([]);
    expect(draft.text).toContain('1. Rejouer chaque appel seul, avec son temps (le tableau interne).');
    expect(draft.text).toContain('Sur un produit, l’export prenait 40 secondes.');
    // A public page stays a link; the breadcrumb of the work brain does not come along.
    expect(draft.text).toContain('[la définition du percentile](https://fr.wikipedia.org/wiki/Centile)');
    expect(draft.text).not.toContain('🧭');
    // A note of the brain starts with its breadcrumb: the version for the baggage starts with its title.
    expect((await baggageDraft(config, bundle, '3 Boîte à outils/Méthodes/Enquêter sur une lenteur.md')).text.startsWith('# Enquêter sur une lenteur')).toBe(true);
  });

  it('keeping prepares a proposal in the baggage: nothing is written, and nothing of the workplace comes along', async () => {
    const { config, baggage, baggageRoot, path, kb } = await withLesson();
    const before = (await readdir(baggageRoot, { recursive: true })).sort();
    const kept = await keepInBaggage(config, baggage, { path });
    expect(kept.kb).toBe('bagage');
    expect(kept.target).toMatch(/Isoler chaque appel pour trouver une lenteur\.md$/);
    expect((await listProposals(baggage)).map((p) => p.id)).toEqual([kept.proposal]);
    expect(await listProposals(config)).toEqual([]);
    const proposal = await loadProposal(baggage, kept.proposal);
    const content = proposal.changes.map((c) => ('after' in c ? String((c as { after?: string }).after ?? '') : '')).join('\n') + JSON.stringify(proposal);
    for (const inside of ['Atlas', 'ABC-101', 'acme', 'atlas-api', '12 000', 'n-lesson0001', 'tickets/', 'Travail']) expect(content, inside).not.toContain(inside);
    expect(content).toContain('Rejouer chaque appel seul');
    expect((await readdir(baggageRoot, { recursive: true })).sort()).toEqual(before);
    expect((await readdir(resolve(kb, '3 Boîte à outils/Méthodes'))).length).toBeGreaterThan(0);
  });

  it('in the baggage it reads as the lesson it is, and the person’s yes writes it there', async () => {
    const { config, baggage, baggageRoot, path, env } = await withLesson();
    const kept = await keepInBaggage(config, baggage, { path });
    const { eveningView, sayYes } = await import('../src/evening/evening.js');
    const evening = await eveningView(baggage, env);
    expect(evening.apart).toEqual([]);
    expect(evening.changes.map((c) => [c.id, c.title.replace(/ \+\d+$/, '')])).toEqual([[kept.proposal, 'Isoler chaque appel pour trouver une lenteur']]);
    const done = await sayYes(baggage, env, { changes: [kept.proposal], cards: [] }, async () => 'confirmed');
    expect(done.changes).toEqual([{ id: kept.proposal, ok: true }]);
    const { readFile } = await import('node:fs/promises');
    const written = await readFile(resolve(baggageRoot, kept.target), 'utf8');
    expect(written).toContain('Rejouer chaque appel seul');
    expect(written).toContain('space: work');
    for (const inside of ['Atlas', 'ABC-101', 'acme', 'n-lesson0001']) expect(written, inside).not.toContain(inside);
  });

  it('a version the person rewrote is taken as it is, unless it still names the workplace', async () => {
    const { config, baggage, path } = await withLesson();
    const mine = '# Isoler chaque appel\n\nRejouer chaque appel seul et noter son temps : la lenteur se voit tout de suite.\n';
    const kept = await keepInBaggage(config, baggage, { path, text: mine, title: 'Isoler chaque appel' });
    expect(JSON.stringify(await loadProposal(baggage, kept.proposal))).toContain('la lenteur se voit tout de suite');
    const refused = await failure(keepInBaggage(config, baggage, { path, text: `${mine}\nVu sur Atlas (ABC-101).\n` }));
    expect(refused.key).toBe('baggageDetails');
    expect((refused.detail as { details: { text: string }[] }).details.map((d) => d.text).sort()).toEqual(['ABC-101', 'Atlas']);
  });

  it('an assistant can prepare it, but never from a 🔒 note', async () => {
    const { config, env, path, kb } = await withLesson();
    const agent = { config, env, actor: 'agent' as const };
    expect((await invoke('baggage.keep', { path }, agent)).kb).toBe('bagage');
    await writeFile(resolve(kb, path), NOTE.replace('  v: 1\n', '  v: 1\n  confidentiality: secret\n'));
    expect((await failure(invoke('baggage.keep', { path, title: 'Autre titre' }, agent))).code).toBe('E_NOT_FOUND');
    expect((await invoke('baggage.draft', { path }, { config, env, actor: 'person' })).removed.length).toBe(6);
  });

  it('without a baggage, OKB says how to make one; and a baggage does not keep from itself', async () => {
    const alone = await twoSpaces({ baggage: false });
    const failed = await failure(invoke('baggage.keep', { path: '3 Boîte à outils/Méthodes/Enquêter sur une lenteur.md' }, { config: alone.config, env: alone.env, actor: 'person' }));
    expect(failed.key).toBe('baggageNone');
    const { baggage, env } = await twoSpaces();
    expect((await failure(invoke('baggage.keep', { path: 'x.md' }, { config: baggage, env, actor: 'person' }))).key).toBe('baggageAlready');
  });

  it('the same gesture from the terminal and from the app’s address', async () => {
    const { env, dir, path, config } = await withLesson();
    const { json } = await import('./helpers/team.js');
    const draft = await json(['baggage', 'draft', path], env, dir);
    expect(draft.removed).toHaveLength(6);
    const kept = await json(['baggage', 'keep', path, '--title', 'Isoler pour mesurer'], env, dir);
    expect(kept).toMatchObject({ ok: true, kb: 'bagage', title: 'Isoler pour mesurer' });
    // The app: the brains come with their space, and the baggage routes answer.
    const { serve } = await import('../src/web/server.js');
    const started = await serve(config, { port: 0, env });
    try {
      const session = (await (await fetch(`${started.url}/api/session`)).json()) as { kbs: { id: string; space: string }[] };
      expect(session.kbs.map((k) => [k.id, k.space]).sort()).toEqual([['bagage', 'baggage'], ['travail', 'work']]);
      const viaWeb = (await (await fetch(`${started.url}/api/baggage/draft?path=${encodeURIComponent(path)}`)).json()) as { removed: unknown[] };
      expect(viaWeb.removed).toHaveLength(6);
      expect((await fetch(`${started.url}/api/baggage/keep`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })).status).toBe(403);
    } finally { started.server.closeAllConnections(); started.server.close(); }
  });
});

