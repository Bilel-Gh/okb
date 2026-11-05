import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { appendLine } from '../util/fsx.js';

/**
 * What OKB's own AI calls cost (translations…), counted in the same daily
 * budget as the suggestion cards (`budget.daily`). One line per call.
 */
const file = (config: OkbConfig) => resolve(statePaths(config).root, 'ai', 'usage.jsonl');

export async function recordAiUsage(config: OkbConfig, entry: { tokens: number; purpose: string; provider: string; estimated?: boolean }, now = new Date()): Promise<void> {
  await appendLine(file(config), JSON.stringify({ at: now.toISOString(), ...entry }));
}

/** Tokens OKB's AI calls used today: the scribe's apart (D77), or only them. */
export async function aiSpentToday(config: OkbConfig, now = new Date(), which: { only?: 'scribe' } = {}): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const raw = await readFile(file(config), 'utf8').catch(() => '');
  let total = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { at?: string; tokens?: number; purpose?: string };
      if ((e.purpose === 'scribe') !== (which.only === 'scribe')) continue;
      if (e.at?.startsWith(day) && typeof e.tokens === 'number') total += e.tokens;
    } catch { /* a torn line */ }
  }
  return total;
}
