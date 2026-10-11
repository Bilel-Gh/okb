import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { indicators, type Indicator } from '../src/indicators/indicators.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { collectCards, gradeCard, parseRating } from '../src/learn/learn.js';
import { closeDbs } from '../src/state/db.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const NOW = new Date('2027-03-10T09:00:00Z');
const note = (title: string, body: string, extra = '') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}, en une phrase.\nstatus: stable\ngenerated:\n  by: agent:claude\n  at: 2027-01-05T10:00:00Z\n${extra}---\n\n# ${title}\n\n${body}\n`;
async function put(kb: string, path: string, text: string) {
  await mkdir(dirname(resolve(kb, path)), { recursive: true });
  await writeFile(resolve(kb, path), text);
}
const by = (list: readonly Indicator[], id: Indicator['id']) => list.find((i) => i.id === id)!;

describe('honest indicators: four of them, apart, each with what to do (F2.0-24)', () => {
  it('gives coverage, freshness, quality and understanding separately, each with what it is made of', async () => {
    const { config, env } = await demoBrain();
    const list = await indicators(config, await loadBundleFor(config), env, NOW);
    expect(list.map((i) => i.id)).toEqual(['coverage', 'freshness', 'quality', 'understanding']);
    for (const i of list) {
      if (i.value !== null) { expect(i.value).toBeGreaterThanOrEqual(0); expect(i.value).toBeLessThanOrEqual(100); expect(i.of.total).toBeGreaterThan(0); }
      for (const gap of i.gaps) { expect(gap.count).toBeGreaterThan(0); expect(gap.action.to).toBeTruthy(); }
    }
  });

  it('coverage: a term several notes use without a card is a gap, with the cards to propose', async () => {
    const { config, env, kb } = await demoBrain();
    const before = by(await indicators(config, await loadBundleFor(config), env, NOW), 'coverage');
    for (const n of [1, 2, 3]) await put(kb, `3 Boîte à outils/Méthodes/Note ZQX ${n}.md`, note(`Note ZQX ${n}`, 'Le module ZQX recalcule les totaux.'));
    const after = by(await indicators(config, await loadBundleFor(config), env, NOW), 'coverage');
    const gap = after.gaps.find((g) => g.id === 'terms-without-card')!;
    expect(gap.examples.map((e) => e.title)).toContain('ZQX');
    expect(gap.action).toEqual({ kind: 'command', to: 'okb suggest concepts --queue' });
    expect(after.of.total - after.of.have).toBe(before.of.total - before.of.have + 1);
    expect(after.value!).toBeLessThan(before.value!);
  });

  it('freshness: a note past its date is said, and a brain where nothing can go stale has no figure rather than a false 100', async () => {
    const { config, env, kb } = await demoBrain();
    expect(by(await indicators(config, await loadBundleFor(config), env, NOW), 'freshness')).toMatchObject({ value: null, of: { have: 0, total: 0 }, gaps: [] });
    await put(kb, '3 Boîte à outils/Méthodes/Tarifs.md', note('Tarifs', 'Le car coûte 480 euros.', 'stale_after: 2027-02-01\n'));
    await put(kb, '3 Boîte à outils/Méthodes/Horaires.md', note('Horaires', 'Départ à 8 h.', 'stale_after: 2027-12-01\n'));
    const fresh = by(await indicators(config, await loadBundleFor(config), env, NOW), 'freshness');
    expect(fresh).toMatchObject({ value: 50, of: { have: 1, total: 2 } });
    expect(fresh.gaps).toEqual([{ id: 'past-date', count: 1, examples: [{ title: 'Tarifs', path: '3 Boîte à outils/Méthodes/Tarifs.md' }], action: { kind: 'note', to: '3 Boîte à outils/Méthodes/Tarifs.md' } }]);
  });

  it('quality: the average of the notes, and the weakest ones to open first', async () => {
    const { config, env, kb } = await demoBrain();
    await put(kb, 'Brouillon.md', '# Brouillon\n\nUne ligne.\n');
    const quality = by(await indicators(config, await loadBundleFor(config), env, NOW), 'quality');
    expect(quality.of.total).toBeGreaterThan(20);
    const weak = quality.gaps.find((g) => g.id === 'weak-notes')!;
    expect(weak.examples[0]).toMatchObject({ path: 'Brouillon.md' });
    expect(weak.action).toEqual({ kind: 'note', to: 'Brouillon.md' });
    expect(quality.of.have).toBe(quality.of.total - weak.count);
  });

  it('understanding: what the person studied and knows, not what the notes say', async () => {
    const { config, env } = await demoBrain({ concepts: 4 });
    const bundle = await loadBundleFor(config);
    const cards = collectCards(config, bundle);
    const before = by(await indicators(config, bundle, env, NOW), 'understanding');
    expect(before).toMatchObject({ value: 0, of: { have: 0, total: cards.length } });
    expect(before.gaps.find((g) => g.id === 'never-studied')).toMatchObject({ count: cards.length, action: { kind: 'route', to: 'learn' } });
    // Answered « easy » twice, a month apart: the card is known.
    await gradeCard(config, cards[0]!.id, parseRating('easy')!, new Date('2027-01-01T09:00:00Z'));
    await gradeCard(config, cards[0]!.id, parseRating('easy')!, new Date('2027-02-10T09:00:00Z'));
    const after = by(await indicators(config, bundle, env, NOW), 'understanding');
    expect(after.of).toEqual({ have: 1, total: cards.length });
    expect(after.value).toBe(Math.round(100 / cards.length));
  });

  it('the same for the terminal, the app and an assistant', async () => {
    const { config, env, dir } = await demoBrain();
    const viaEngine = await invoke('indicators.view', {}, { config, env, actor: 'agent' });
    expect(viaEngine.indicators.map((i) => i.id)).toEqual(['coverage', 'freshness', 'quality', 'understanding']);
    closeDbs();
    const { json } = await import('./helpers/team.js');
    const viaCli = await json(['indicators'], env, dir);
    expect(viaCli.indicators.map((i: { id: string; value: number | null }) => [i.id, i.value])).toEqual(viaEngine.indicators.map((i) => [i.id, i.value]));
  });
});
