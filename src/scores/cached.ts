import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { statePaths } from '../state/paths.js';
import { sha256 } from '../util/hash.js';
import { scoreBundle, type NoteScore } from './scores.js';

const scoreCache = new Map<string, { key: string; scores: Map<string, NoteScore> }>();

/**
 * Scores of every note, computed once per version of what they depend on
 * (F2.0-35): every note's content, what the person did with the notes (read,
 * cited, rated: the events file) and the day (a note ages, a new one grows).
 */
export async function scoresFor(config: OkbConfig, bundle: Bundle): Promise<Map<string, NoteScore>> {
  const events = await stat(resolve(statePaths(config).root, 'usage', 'notes.jsonl')).catch(() => null);
  const key = sha256([
    ...bundle.entries.map((e) => `${e.path}\u0000${e.sha256}`),
    `events\u0000${events ? `${events.size}:${events.mtimeMs}` : 'none'}`,
    `day\u0000${new Date().toISOString().slice(0, 10)}`,
  ].join('\n'));
  const hit = scoreCache.get(config.kb.root);
  if (hit && hit.key === key) return hit.scores;
  const scores = new Map((await scoreBundle(config, bundle)).map((s) => [s.path as string, s]));
  scoreCache.set(config.kb.root, { key, scores });
  return scores;
}

/** Forget the scores of a KB: the next request computes them again. */
export function forgetScores(root: string): void {
  scoreCache.delete(root);
}
