import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBackup } from '../brain/backup.js';
import { layoutOf } from '../brain/layout.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { clearReviews, exportReviews, reviewLog } from '../learn/learn.js';
import { spaceOf } from '../spaces/space.js';
import { readMeta, reviewCounts } from '../state/db.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';

/**
 * Moving a brain of the 1.5 to the 2.0 (F2.0-16). The notes are never touched:
 * the 2.0 only adds state (a database, a documents folder). What moves is the
 * reviews, from two files into the database. The tool makes that move one a
 * person can watch: a dry run by default, a snapshot before anything, a check
 * after, and a way back that gives the 1.5 its files again.
 */
export type V2Step = {
  readonly id: 'snapshot' | 'reviews' | 'space' | 'brain' | 'notes';
  /** `todo` will be done by applying; `advice` is for the person to decide, and does not block. */
  readonly state: 'todo' | 'done' | 'advice';
  readonly detail: Readonly<Record<string, string | number>>;
};
export type V2Plan = { readonly profile: string; readonly done: boolean; readonly steps: readonly V2Step[] };
type Mark = { version: 2; at: string; snapshot: string };

const markFile = (config: OkbConfig) => resolve(statePaths(config).root, 'version.json');

/** What the 1.5 left in its two files. */
async function inFiles(config: OkbConfig): Promise<{ cards: number; answers: number }> {
  const dir = resolve(config.stateHome, 'learn');
  const store = await readJsonIfExists<{ cards?: Record<string, unknown> }>(resolve(dir, 'cards.json')).catch(() => null);
  const log = await readFile(resolve(dir, 'log.jsonl'), 'utf8').catch(() => '');
  return { cards: Object.keys(store?.cards ?? {}).length, answers: log.split('\n').filter((l) => l.trim()).length };
}

/** The dry run: what applying would do. It reads only, and creates nothing — not even the database. */
export async function planV2(config: OkbConfig, _env: NodeJS.ProcessEnv = process.env, _now = new Date()): Promise<V2Plan> {
  const mark = await readJsonIfExists<Mark>(markFile(config)).catch(() => null);
  const imported = readMeta(config, 'learn.imported') !== null;
  const bundle = await loadBundleFor(config);
  return {
    profile: config.profile.id,
    done: mark?.version === 2,
    steps: [
      { id: 'snapshot', state: mark ? 'done' : 'todo', detail: mark ? { date: mark.snapshot } : {} },
      { id: 'reviews', state: imported ? 'done' : 'todo', detail: imported ? reviewCounts(config) : await inFiles(config) },
      { id: 'space', state: config.kb.space ? 'done' : 'advice', detail: { space: spaceOf(config) } },
      { id: 'brain', state: layoutOf(config) ? 'done' : 'advice', detail: {} },
      { id: 'notes', state: 'done', detail: { notes: bundle.entries.filter((e) => !e.reserved).length } },
    ],
  };
}

/**
 * Apply: a snapshot first, then the reviews, then the check, then the mark.
 * Each step can be run again: a migration cut short is finished by applying
 * once more.
 */
export async function applyV2(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<{ snapshot: string; reviews: { cards: number; answers: number } }> {
  const snapshot = (await runBackup(config, { force: true, env, now })).info.date;
  const before = await inFiles(config);
  await reviewLog(config);
  const reviews = reviewCounts(config);
  if (reviews.cards < before.cards || reviews.answers < before.answers) {
    throw new OkbError('E_INTERNAL', `the reviews did not all arrive (${reviews.cards}/${before.cards} cards, ${reviews.answers}/${before.answers} answers)`, { key: 'migrateIncomplete', params: { snapshot } });
  }
  await writeJsonAtomic(markFile(config), { version: 2, at: now.toISOString(), snapshot } satisfies Mark);
  return { snapshot, reviews };
}

/** The way back: the 1.5's files get everything studied since, and the database forgets the reviews so a later move starts from those files. */
export async function rollbackV2(config: OkbConfig, _env: NodeJS.ProcessEnv = process.env): Promise<{ reviews: { cards: number; answers: number }; snapshot: string | null }> {
  const mark = await readJsonIfExists<Mark>(markFile(config)).catch(() => null);
  const out = await exportReviews(config);
  clearReviews(config);
  await rm(markFile(config), { force: true });
  return { reviews: { cards: out.cards, answers: out.log }, snapshot: mark?.snapshot ?? null };
}
