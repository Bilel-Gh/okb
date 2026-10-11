import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { metrics } from '../src/metrics/metrics.js';
import { addEntry } from '../src/projects/journal.js';
import { closeDbs } from '../src/state/db.js';
import { dayFromWords } from '../src/util/day.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
// A Thursday.
const NOW = new Date('2027-03-04T15:00:00Z');

describe('« ce que j’ai fait mardi » (F2.0-21)', () => {
  it('a day said in plain words is a date: a weekday is the last one before today', () => {
    const day = (words: string) => dayFromWords(words, NOW);
    expect(['mardi', 'Mardi dernier', 'tuesday', 'ce que j’ai fait mardi'].map(day)).toEqual(['2027-03-02', '2027-03-02', '2027-03-02', '2027-03-02']);
    expect([day('hier'), day('yesterday'), day('avant-hier'), day("aujourd'hui"), day('today')]).toEqual(['2027-03-03', '2027-03-03', '2027-03-02', '2027-03-04', '2027-03-04']);
    // Said on a Thursday, « jeudi » is last week's: today has its own word.
    expect(day('jeudi')).toBe('2027-02-25');
    expect([day('2027-02-14'), day('le 14 février'), day('14/02')]).toEqual(['2027-02-14', '2027-02-14', '2027-02-14']);
    expect([day('réserver le car'), day(''), day('mars')]).toEqual([null, null, null]);
  });

  it('shows what happened that day, and only that day', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
    addEntry(config, { text: 'Devis du transporteur reçu', kind: 'note', project: project.id }, new Date('2026-03-02T10:00:00Z'));
    addEntry(config, { text: 'On part sur le car de 55 places', kind: 'decision', project: project.id }, new Date('2026-03-02T16:00:00Z'));
    addEntry(config, { text: 'Relance du musée', kind: 'note' }, new Date('2026-03-03T09:00:00Z'));
    const tuesday = await invoke('day.view', { day: '2026-03-02' }, ctx);
    expect(tuesday.day).toBe('2026-03-02');
    expect(tuesday.entries.map((e) => [e.kind, e.text, e.project?.title])).toEqual([['decision', 'On part sur le car de 55 places', 'Sortie de juin'], ['note', 'Devis du transporteur reçu', 'Sortie de juin']]);
    expect(tuesday.previous).toBe('2026-03-01');
    expect(tuesday.next).toBe('2026-03-03');
    const refused = await invoke('day.view', { day: 'un de ces jours' }, ctx).then(() => null, (e: { key?: string }) => e.key);
    expect(refused).toBe('dayUnknown');
  });

  it('the same from the terminal', async () => {
    const { config, env, dir } = await demoBrain();
    addEntry(config, { text: 'Devis du transporteur reçu', kind: 'note' }, new Date());
    closeDbs();
    const { json } = await import('./helpers/team.js');
    const today = await json(['journal', 'today'], env, dir);
    expect(today.entries.map((e: { text: string }) => e.text)).toEqual(['Devis du transporteur reçu']);
    expect((await json(['journal', 'yesterday'], env, dir)).entries).toEqual([]);
  });

  it('is measured: finding a day’s journal, the upkeep per day, the tokens spent', async () => {
    const { config, env } = await demoBrain();
    addEntry(config, { text: 'Devis du transporteur reçu', kind: 'note' }, new Date('2027-03-02T10:00:00Z'));
    const out = await metrics(config, await loadBundleFor(config), { env, now: NOW, days: 30, sample: 5 });
    const by = new Map(out.metrics.map((m) => [m.id, m]));
    expect(by.get('day')).toMatchObject({ verdict: 'ok', target: '≤ 1 s' });
    expect(by.get('day')!.params!.ms).toBeLessThan(1000);
    expect(by.get('upkeep')).toMatchObject({ target: '≤ 3 min a day' });
    expect(by.get('tokens')!.params).toHaveProperty('perDay');
  });
});
