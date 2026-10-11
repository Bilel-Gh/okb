import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { journal } from '../src/journal/journal.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { collectCards, dueCards, dueCount, exportReviews, gradeCard, parseRating, reviewLog } from '../src/learn/learn.js';
import { activities } from '../src/progress/progress.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const NOW = new Date('2027-03-10T09:00:00Z');

/** A brain as the 1.5 left it: two cards studied, in the files of its state folder. */
async function from15() {
  const brain = await demoBrain({ concepts: 4 });
  const bundle = await loadBundleFor(brain.config);
  const [a, b, c] = collectCards(brain.config, bundle).map((card) => card.id);
  const saved = (due: string) => ({ due, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '2027-03-05T09:00:00.000Z' });
  const dir = resolve(brain.config.stateHome, 'learn');
  await mkdir(dir, { recursive: true });
  const cards = JSON.stringify({ version: 1, cards: { [a!]: saved('2027-03-08T09:00:00.000Z'), [b!]: saved('2027-04-01T09:00:00.000Z') } });
  const log = [{ at: '2027-03-05T09:00:00.000Z', id: a, rating: 3, was: 'new', next: '2027-03-08T09:00:00.000Z' }, { at: '2027-03-05T09:01:00.000Z', id: b, rating: 4, was: 'new', next: '2027-04-01T09:00:00.000Z' }].map((l) => JSON.stringify(l)).join('\n') + '\n';
  await writeFile(resolve(dir, 'cards.json'), cards);
  await writeFile(resolve(dir, 'log.jsonl'), log);
  return { ...brain, bundle, dir, cards, log, ids: [a!, b!, c!] };
}

describe('the reviews live in the state database (F2.0-18)', () => {
  it('a brain from the 1.5 keeps what was studied: read from its files once, which are left as they were', async () => {
    const { config, bundle, dir, cards, log, ids } = await from15();
    expect(await dueCount(config, NOW)).toBe(1);
    const due = await dueCards(config, bundle, { now: NOW });
    expect(due.due.map((c) => c.id)).toEqual([ids[0]]);
    expect((await reviewLog(config)).map((l) => l.id)).toEqual([ids[0], ids[1]]);
    expect(await readFile(resolve(dir, 'cards.json'), 'utf8')).toBe(cards);
    expect(await readFile(resolve(dir, 'log.jsonl'), 'utf8')).toBe(log);
    // Read again: nothing is imported twice.
    closeDbs();
    expect((await reviewLog(config)).length).toBe(2);
    expect(openDb(config).all<{ n: number }>('SELECT COUNT(*) AS n FROM reviews')[0]!.n).toBe(2);
  });

  it('an answer is written in the database only, and is there after a restart', async () => {
    const { config, dir, cards, ids } = await from15();
    const graded = await gradeCard(config, ids[0]!, parseRating('good')!, NOW);
    expect(Date.parse(graded.due)).toBeGreaterThan(NOW.getTime());
    await gradeCard(config, ids[2]!, parseRating('good')!, NOW);
    closeDbs();
    expect(await dueCount(config, NOW)).toBe(0);
    expect((await reviewLog(config)).map((l) => [l.id, l.was])).toEqual([[ids[0], 'new'], [ids[1], 'new'], [ids[0], 'learning'], [ids[2], 'new']]);
    expect(await readFile(resolve(dir, 'cards.json'), 'utf8')).toBe(cards);
  });

  it('two answers at the same moment are both kept', async () => {
    const { config, ids } = await from15();
    await Promise.all([gradeCard(config, ids[0]!, parseRating('good')!, NOW), gradeCard(config, ids[2]!, parseRating('easy')!, NOW)]);
    expect((await reviewLog(config)).length).toBe(4);
    expect(openDb(config).all<{ n: number }>('SELECT COUNT(*) AS n FROM reviews')[0]!.n).toBe(3);
  });

  it('the journal of the week and the progress still count the reviews', async () => {
    const { config, bundle, ids } = await from15();
    await gradeCard(config, ids[0]!, parseRating('good')!, NOW);
    expect((await activities(config)).filter((a) => a.kind === 'review')).toHaveLength(3);
    const week = await journal(config, bundle, { now: NOW, days: 7 });
    expect(week.days.reduce((n, d) => n + d.reviews, 0)).toBe(3);
  });

  it('going back to the 1.5: the files get what was studied since', async () => {
    const { config, dir, ids } = await from15();
    await gradeCard(config, ids[2]!, parseRating('good')!, NOW);
    const out = await exportReviews(config);
    expect(out).toEqual({ cards: 3, log: 3 });
    const cards = JSON.parse(await readFile(resolve(dir, 'cards.json'), 'utf8')) as { version: number; cards: Record<string, { due: string }> };
    expect(Object.keys(cards.cards).sort()).toEqual([...ids].sort());
    expect((await readFile(resolve(dir, 'log.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(3);
  });
});
