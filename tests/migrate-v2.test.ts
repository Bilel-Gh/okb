import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupRoot, listBackups } from '../src/brain/backup.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { collectCards, dueCount, gradeCard, parseRating, reviewLog } from '../src/learn/learn.js';
import { applyV2, planV2, rollbackV2 } from '../src/migrate/v2.js';
import { closeDbs, dbFile } from '../src/state/db.js';
import { sha256 } from '../src/util/hash.js';
import { walkFiles } from '../src/util/fsx.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const NOW = new Date('2027-03-10T09:00:00Z');

/** A brain as the 1.5 left it: notes, and two cards studied in the files of its state. */
async function from15() {
  const brain = await demoBrain({ concepts: 4 });
  const [a, b, c] = collectCards(brain.config, await loadBundleFor(brain.config)).map((card) => card.id);
  const saved = (due: string) => ({ due, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '2027-03-05T09:00:00.000Z' });
  const dir = resolve(brain.config.stateHome, 'learn');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'cards.json'), JSON.stringify({ version: 1, cards: { [a!]: saved('2027-03-08T09:00:00.000Z'), [b!]: saved('2027-04-01T09:00:00.000Z') } }));
  await writeFile(resolve(dir, 'log.jsonl'), `${JSON.stringify({ at: '2027-03-05T09:00:00.000Z', id: a, rating: 3, was: 'new', next: '2027-03-08T09:00:00.000Z' })}\n${JSON.stringify({ at: '2027-03-05T09:01:00.000Z', id: b, rating: 4, was: 'new', next: '2027-04-01T09:00:00.000Z' })}\n`);
  return { ...brain, dir, ids: [a!, b!, c!] };
}
const notesHash = async (kb: string) => sha256((await Promise.all((await walkFiles(kb)).sort().map(async (f) => `${f}:${sha256(await readFile(resolve(kb, f)))}`))).join('\n'));

describe('moving a brain of the 1.5 to the 2.0 (F2.0-16)', () => {
  it('a dry run says what will happen and changes nothing, not even a file of the state', async () => {
    const { config, env, kb } = await from15();
    const [before, state] = [await notesHash(kb), (await walkFiles(config.stateHome)).sort()];
    const plan = await planV2(config, env, NOW);
    expect(plan.done).toBe(false);
    expect(plan.steps.map((s) => [s.id, s.state])).toEqual([['snapshot', 'todo'], ['reviews', 'todo'], ['space', 'advice'], ['brain', 'done'], ['notes', 'done']]);
    expect(plan.steps.find((s) => s.id === 'reviews')!.detail).toEqual({ cards: 2, answers: 2 });
    expect(plan.steps.find((s) => s.id === 'space')!.detail).toEqual({ space: 'work' });
    expect(plan.steps.find((s) => s.id === 'notes')!.detail.notes).toBeGreaterThan(20);
    expect(await notesHash(kb)).toBe(before);
    expect((await walkFiles(config.stateHome)).sort()).toEqual(state);
    expect(existsSync(dbFile(config))).toBe(false);
  });

  it('applying takes a snapshot first, moves the reviews, checks them, and never touches a note', async () => {
    const { config, env, kb } = await from15();
    const before = await notesHash(kb);
    const done = await applyV2(config, env, NOW);
    expect(done).toMatchObject({ snapshot: '2027-03-10', reviews: { cards: 2, answers: 2 } });
    expect((await listBackups(config, env)).map((b) => b.date)).toEqual(['2027-03-10']);
    expect(await notesHash(kb)).toBe(before);
    expect(await dueCount(config, NOW)).toBe(1);
    const plan = await planV2(config, env, NOW);
    expect(plan.done).toBe(true);
    expect(plan.steps.slice(0, 2).map((s) => s.state)).toEqual(['done', 'done']);
    // Applying again is harmless.
    expect((await applyV2(config, env, NOW)).reviews).toEqual({ cards: 2, answers: 2 });
    expect((await reviewLog(config)).length).toBe(2);
  });

  it('a migration cut short is finished by running it again: nothing twice, nothing lost', async () => {
    const { config, env } = await from15();
    // Cut after the reviews were moved, before the migration was marked done…
    await reviewLog(config);
    // …and a snapshot left half-made by the cut.
    const partial = resolve(await backupRoot(env), config.profile.id, '2027-03-10.partial');
    await mkdir(partial, { recursive: true });
    await writeFile(resolve(partial, 'half'), 'x');
    expect((await planV2(config, env, NOW)).done).toBe(false);
    const done = await applyV2(config, env, NOW);
    expect(done.reviews).toEqual({ cards: 2, answers: 2 });
    expect(await readdir(resolve(await backupRoot(env), config.profile.id))).toEqual(['2027-03-10']);
    expect((await planV2(config, env, NOW)).done).toBe(true);
  });

  it('going back gives the 1.5 its files, with what was studied since; the notes are as they were', async () => {
    const { config, env, kb, dir, ids } = await from15();
    const before = await notesHash(kb);
    await applyV2(config, env, NOW);
    await gradeCard(config, ids[2]!, parseRating('good')!, NOW);
    const back = await rollbackV2(config, env);
    expect(back).toEqual({ reviews: { cards: 3, answers: 3 }, snapshot: '2027-03-10' });
    expect(Object.keys((JSON.parse(await readFile(resolve(dir, 'cards.json'), 'utf8')) as { cards: object }).cards)).toHaveLength(3);
    expect(await notesHash(kb)).toBe(before);
    closeDbs();
    const plan = await planV2(config, env, NOW);
    expect(plan.done).toBe(false);
    expect(plan.steps.find((s) => s.id === 'reviews')).toMatchObject({ state: 'todo', detail: { cards: 3, answers: 3 } });
  });

  it('the same from the terminal: a dry run by default', async () => {
    const { env, dir: _d, kb, config } = await from15();
    const { json } = await import('./helpers/team.js');
    const before = await notesHash(kb);
    const plan = await json(['migrate', '2.0'], env, kb);
    expect(plan).toMatchObject({ ok: true, dryRun: true, done: false });
    expect(existsSync(dbFile(config))).toBe(false);
    const applied = await json(['migrate', '2.0', '--apply'], env, kb);
    expect(applied).toMatchObject({ ok: true, dryRun: false, reviews: { cards: 2, answers: 2 } });
    expect((await json(['migrate', '2.0', '--rollback'], env, kb)).reviews).toEqual({ cards: 2, answers: 2 });
    expect(await notesHash(kb)).toBe(before);
  });
});
