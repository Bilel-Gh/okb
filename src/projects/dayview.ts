import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { dayFromWords, localDay, shiftDay } from '../util/day.js';
import { listEntries, type Entry } from './journal.js';

/**
 * « Ce que j'ai fait mardi » (F2.0-21): one day of the journal, found from the
 * words a person uses for a day. The lines are the day's own — what was noted,
 * decided, tried and done, with what the modules know of it — the latest first.
 */
export type DayView = { readonly day: string; readonly entries: readonly Entry[]; readonly previous: string; readonly next: string | null };

export async function dayView(config: OkbConfig, env: NodeJS.ProcessEnv, words: string, now = new Date()): Promise<DayView> {
  const day = dayFromWords(words, now);
  if (!day) throw new OkbError('E_INVALID', `"${words}" names no day`, { key: 'dayUnknown', params: { words: words.slice(0, 60) }, hint: 'okb journal mardi · okb journal hier · okb journal 2027-03-02' });
  const at = new Date(`${day}T12:00:00`);
  const today = localDay(now);
  return { day, entries: await listEntries(config, env, { day, limit: 300 }), previous: localDay(shiftDay(at, -1)), next: day < today ? localDay(shiftDay(at, 1)) : null };
}
