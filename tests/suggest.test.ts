import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { noteEvent, scoreBundle } from '../src/scores/scores.js';
import { runSetup } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { hasConsent, idsFromQuestion, idsIn, isPlainYes, recordConsent } from '../src/suggest/consent.js';
import { conceptGaps } from '../src/suggest/gaps.js';
import { requireAccepted } from '../src/suggest/guard.js';
import { addSuggestion, buildCard, contextFor, renderCard, setStatus } from '../src/suggest/suggest.js';
import { json, run } from './helpers/team.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); delete process.env.OKB_VIA_CLAUDE; });

async function brain(files: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-suggest-')));
  made.push(dir);
  const home = resolve(dir, 'home');
  const kb = resolve(dir, 'kb');
  await mkdir(kb, { recursive: true });
  for (const [p, c] of Object.entries(files)) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: home, OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  await ensureState(statePaths(config));
  return { dir, kb, env, config };
}

const concept = (title: string, body = '') => `---\ntype: Concept\ntitle: ${title}\ndescription: ${title} en une minute.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  template: concept\n---\n\n# ${title}\n\n## En bref\n\n${title} expliqué.${body}\n`;

describe('a suggestion card says everything before a token is spent', () => {
  it('computes the place, what already covers it, a recommendation, a pertinence and a cost', async () => {
    const { config } = await brain({ '3 Boîte à outils/Concepts/OData.md': concept('OData') });
    const bundle = await loadBundleFor(config);
    const ctx = await contextFor(config, bundle);
    const existing = buildCard(config, { type: 'concept', title: 'OData', why: 'demandé', signal: 'asked' }, ctx);
    expect(existing).toMatchObject({ recommendation: 'complete', target: '3 Boîte à outils/Concepts/OData.md' });
    const fresh = buildCard(config, { type: 'concept', title: 'Idempotence', why: 'demandé', signal: 'asked' }, ctx);
    expect(fresh).toMatchObject({ recommendation: 'create', path: '3 Boîte à outils/Concepts/Idempotence.md', breadcrumb: '🧠 Travail › Boîte à outils › Concepts' });
    expect(fresh.pertinence.novelty).toBe(30);
    expect(fresh.pertinence.signal).toBe(15);
    expect(fresh.cost).toMatchObject({ size: 'small', tokens: 4000 });
    const pack = buildCard(config, { type: 'repo-start', title: 'atlas-api', product: 'Atlas', repo: 'atlas-api', why: 'onboarding', scope: '2 Produits/Atlas/Code/atlas-api', notes: 6 }, ctx);
    expect(pack.cost.size).toBe('large');
    const text = renderCard(fresh, 'fr');
    expect(text).toContain('Pertinence');
    expect(text).toContain('Coût estimé');
    // The same card twice is one suggestion.
    const a = await addSuggestion(config, { type: 'concept', title: 'Idempotence', why: 'x' }, ctx);
    const b = await addSuggestion(config, { type: 'concept', title: 'idempotence', why: 'y' }, ctx);
    expect(b).toMatchObject({ created: false, suggestion: { id: a.suggestion.id } });
  });
});

describe('the yes comes from the person', () => {
  it('reads their pick in a question, never the question text, and a plain « oui »', () => {
    const q = { questions: [{ question: 'Créer la fiche S-abc123 ?', options: [{ label: 'Créer (recommandé)' }, { label: 'Non' }] }] };
    expect(idsFromQuestion(q, { answers: { 'Créer la fiche S-abc123 ?': 'Créer (recommandé)' } })).toEqual({ ids: ['S-abc123'], any: false });
    expect(idsFromQuestion(q, { answers: { 'Créer la fiche S-abc123 ?': 'Non' } })).toEqual({ ids: [], any: false });
    const list = { questions: [{ question: 'Lesquelles ?', options: [{ label: 'S-aaaaaa OData' }, { label: 'S-bbbbbb CDS' }] }] };
    expect(idsFromQuestion(list, { answers: { 'Lesquelles ?': 'S-bbbbbb CDS' } }).ids).toEqual(['S-bbbbbb']);
    expect(idsFromQuestion({ questions: [{ question: 'Je garde ça ?', options: [{ label: 'Garder' }, { label: 'Plus tard' }] }] }, { answers: { 'Je garde ça ?': 'Garder' } })).toEqual({ ids: [], any: true });
    expect(isPlainYes('oui vas-y')).toBe(true);
    expect(isPlainYes('non pas maintenant')).toBe(false);
    expect(isPlainYes('oui mais explique-moi d’abord comment marche la pagination côté serveur, je ne suis pas sûr')).toBe(false);
    expect(idsIn('ok pour S-ABC123 et S-def456')).toEqual(['S-abc123', 'S-def456']);
  });

  it('refuses to accept or write without it when Claude runs OKB, and checks the budget', async () => {
    const { config, env, dir } = await brain();
    const added = await json(['suggest', 'add', '--type', 'concept', '--title', 'Idempotence', '--why', 'demandé', '--signal', 'asked'], env, dir);
    const id = added.suggestion.id;
    const claude = { ...env, OKB_VIA_CLAUDE: '1' };
    const refused = await run(['suggest', 'accept', id, '--json'], claude, dir);
    expect(JSON.parse(refused.stdout).error.code).toBe('E_NOT_APPROVED');
    // The person's « oui » right after the card, recorded by the prompt hook.
    await run(['suggest', 'consent', '--prompt', 'oui'], env, dir);
    expect(await hasConsent(config, id, added.suggestion.shownAt)).toBe(true);
    const accepted = await json(['suggest', 'accept', id], claude, dir);
    expect(accepted).toMatchObject({ ok: true, place: '3 Boîte à outils/Concepts/Idempotence.md', mode: 'create', template: 'concept' });
    // A tiny budget: the next card is refused before anything is written.
    await writeFile(resolve(env.OKB_HOME!, 'config.yaml'), 'budget:\n  daily: 5000\nprofiles:\n  - travail\nactiveProfile: travail\n');
    const other = await json(['suggest', 'add', '--type', 'concept', '--title', 'Pagination', '--why', 'x'], env, dir);
    const over = await run(['suggest', 'accept', other.suggestion.id, '--json'], env, dir);
    expect(JSON.parse(over.stdout).error.key).toBe('suggestOverBudget');
  });

  it('lets Claude write a note in a brain only for an accepted suggestion that covers it', async () => {
    const { config } = await brain();
    process.env.OKB_VIA_CLAUDE = '1';
    await expect(requireAccepted(config, '3 Boîte à outils/Concepts/X.md', undefined)).rejects.toMatchObject({ key: 'suggestRequired' });
    const bundle = await loadBundleFor(config);
    const { suggestion } = await addSuggestion(config, { type: 'concept', title: 'X', why: 'x' }, await contextFor(config, bundle));
    await expect(requireAccepted(config, suggestion.path!, suggestion.id)).rejects.toMatchObject({ key: 'suggestNotAccepted' });
    await recordConsent(config, { at: new Date().toISOString(), ids: [suggestion.id], via: 'question' });
    await setStatus(config, suggestion.id, 'accepted', 'consent');
    await expect(requireAccepted(config, suggestion.path!, suggestion.id)).resolves.toMatchObject({ id: suggestion.id });
    await expect(requireAccepted(config, '3 Boîte à outils/Concepts/Autre.md', suggestion.id)).rejects.toMatchObject({ key: 'suggestOtherPlace' });
    // Typed by the person in a terminal: their own act.
    delete process.env.OKB_VIA_CLAUDE;
    await expect(requireAccepted(config, '3 Boîte à outils/Concepts/Autre.md', undefined)).resolves.toBeNull();
  });
});

describe('moments worth a note, spotted without AI', () => {
  it('in live mode, queues a card when the person asked what something is, and offers it once', async () => {
    const { env, dir } = await brain();
    const { writeSetting } = await import('../src/settings/settings.js');
    await writeSetting('travail', 'suggest.mode', 'live', env);
    const answer = 'OData est un protocole… '.repeat(40);
    const first = await run(['suggest', 'moment', '--stdin', '--json'], env, dir).then(() => null);
    expect(first).toBeNull();
    const { spawnSync } = await import('node:child_process');
    const { BIN } = await import('./helpers/team.js');
    const call = () => JSON.parse(spawnSync(process.execPath, [BIN, 'suggest', 'moment', '--stdin', '--json'], { input: JSON.stringify({ prompt: "c'est quoi OData ?", answer }), env: { ...env, OKB_NO_INTERACTIVE: '1' }, cwd: dir, encoding: 'utf8' }).stdout);
    const once = call();
    expect(once.context).toContain('OData');
    expect(once.context).toContain(once.suggestion.id);
    expect(call().context).toBeUndefined();
    const list = await json(['suggest', 'list'], env, dir);
    expect(list.suggestions.map((s: { title: string }) => s.title)).toEqual(['OData']);
  });

  it('finds frequent terms without a card', async () => {
    const { config } = await brain({
      '2 Produits/Atlas/Fonctionnel/A.md': concept('A', ' Le flux passe par CDS et `gateway-core`.'),
      '2 Produits/Atlas/Fonctionnel/B.md': concept('B', ' CDS encore, et `gateway-core`.'),
      '3 Boîte à outils/Concepts/OData.md': concept('OData', ' Voir CDS.'),
    });
    const gaps = conceptGaps({ preset: 'work', lang: 'fr' }, await loadBundleFor(config));
    expect(gaps.map((g) => g.term)).toEqual(['CDS', 'gateway-core']);
    expect(gaps[0]!.notes).toBe(3);
  });
});

describe('every note has a score', () => {
  it('rates quality and value out of 100, stars, and lets the person’s opinion count', async () => {
    const { config, kb } = await brain();
    await rm(kb, { recursive: true, force: true });
    await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 2, repos: 3, tickets: 10, meetings: 5, concepts: 10 }));
    const bundle = await loadBundleFor(config);
    const scores = await scoreBundle(config, bundle, new Date('2026-12-01T00:00:00Z'));
    expect(scores.length).toBe(bundle.entries.length);
    for (const s of scores) {
      expect(s.quality).toBeGreaterThanOrEqual(0);
      expect(s.quality).toBeLessThanOrEqual(100);
      expect(s.value).toBeLessThanOrEqual(100);
      expect(s.stars).toBeGreaterThanOrEqual(0);
      expect(s.stars).toBeLessThanOrEqual(5);
    }
    const target = scores.find((s) => s.path.includes('/Concepts/'))!;
    await noteEvent(config, target.path, 'up');
    await noteEvent(config, target.path, 'cited');
    const after = (await scoreBundle(config, bundle, new Date('2026-12-01T00:00:00Z'))).find((s) => s.path === target.path)!;
    expect(after.parts.value.opinion).toBe(20);
    expect(after.value).toBeGreaterThan(target.value);
  });
});
