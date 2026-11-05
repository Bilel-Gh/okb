import { resolve } from 'node:path';
import { okbHome } from '../config/load.js';
import { readRootConfig } from '../kb/registry.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { withStateLock } from '../util/state-lock.js';

/**
 * What the scribe knows about each conversation (D77), for the whole machine:
 * how far it read, what it made of it, what it cost. One lock for every
 * writer (the end-of-session hook, a live pass, the evening run), so two runs
 * never read the same lines twice.
 */
export type ScribeMode = 'off' | 'after' | 'live';
export type SessionStatus = 'waiting' | 'done' | 'trivial' | 'skipped' | 'failed';

export type SessionEntry = {
  file: string;
  /** Read up to this byte by a full pass; what follows is new. */
  offset: number;
  /** Read up to this byte by a live pass: its journal is already filed. */
  liveOffset?: number;
  status: SessionStatus;
  /** Why it was skipped, judged trivial or failed: a fixed word, never content. */
  reason?: string;
  updatedAt: string;
  /** The profile and ticket it was filed to, when known. */
  kb?: string;
  ticket?: string | null;
  /** Person turns read so far, to space the live passes. */
  turns: number;
  /** Person turns at the last live pass. */
  liveTurns?: number;
  tokens: number;
  proposals: string[];
  /** Model calls that gave nothing usable: after two, the conversation is left alone. */
  failures?: number;
};

export type Ledger = { version: 1; sessions: Record<string, SessionEntry>; spent: Record<string, number> };

const file = (env: NodeJS.ProcessEnv) => resolve(okbHome(env), 'scribe', 'ledger.json');
const KEEP_DAYS = 120;

export async function readLedger(env: NodeJS.ProcessEnv = process.env): Promise<Ledger> {
  const raw = await readJsonIfExists<Ledger>(file(env)).catch(() => null);
  return raw && raw.version === 1 ? { version: 1, sessions: raw.sessions ?? {}, spent: raw.spent ?? {} } : { version: 1, sessions: {}, spent: {} };
}

export async function changeLedger<T>(env: NodeJS.ProcessEnv, edit: (ledger: Ledger) => T, now = new Date()): Promise<T> {
  return withStateLock(file(env), async () => {
    const ledger = await readLedger(env);
    const out = edit(ledger);
    const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
    for (const [id, s] of Object.entries(ledger.sessions)) if (Date.parse(s.updatedAt) < cutoff) delete ledger.sessions[id];
    for (const day of Object.keys(ledger.spent)) if (Date.parse(day) < cutoff) delete ledger.spent[day];
    await writeJsonAtomic(file(env), ledger);
    return out;
  });
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export type ScribeSettings = { readonly mode: ScribeMode; readonly budget: number; readonly skip: readonly string[] };

/**
 * The person's choice, for the whole machine: `off` (default: nothing is read),
 * `after` (each conversation once it is over, the evening run, the morning
 * catch-up) or `live` (also by batches while it goes on). Folders listed in
 * `scribe.skip` are never read. Only the person sets these.
 */
export async function scribeSettings(env: NodeJS.ProcessEnv = process.env): Promise<ScribeSettings> {
  const root = (await readRootConfig(env).catch(() => ({}))) as { scribe?: { mode?: unknown; budget?: unknown; skip?: unknown } };
  const s = root.scribe ?? {};
  const mode: ScribeMode = s.mode === 'after' || s.mode === 'live' ? s.mode : 'off';
  const budget = typeof s.budget === 'number' && s.budget >= 0 ? s.budget : DEFAULT_BUDGET;
  const skip = Array.isArray(s.skip) ? s.skip.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  return { mode, budget, skip };
}

/** Tokens a day for the scribe alone, apart from `budget.daily`. */
export const DEFAULT_BUDGET = 400_000;
