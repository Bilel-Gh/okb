import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { receipts } from '../status/status.js';
import { loadQueue } from '../suggest/suggest.js';

/**
 * Personal progress (roadmap §5.2): experience for what the person does with
 * their brain — reading, reviewing cards, deciding on suggestions, writing notes
 * — and bronze, silver and gold badges. Local, never shared, never ranked here.
 * Volume alone earns little: each action of a kind gives a bit less than the
 * previous one the same day, and a note read twice the same day counts once.
 */
export type ActionKind = 'read' | 'review' | 'decide' | 'write';
export type Activity = { readonly kind: ActionKind; readonly at: string; readonly key: string };

const BASE: Readonly<Record<ActionKind, number>> = { read: 1, review: 2, decide: 3, write: 6 };
/** The n-th action of a kind the same day is worth BASE × DECAY^(n-1), never less than FLOOR × BASE. */
const DECAY = 0.93;
const FLOOR = 0.05;

const dayOf = (iso: string) => iso.slice(0, 10);

/** One count per (kind, day, key): a note read twice the same day is one read. */
function distinct(acts: readonly Activity[]): Activity[] {
  const seen = new Set<string>();
  const out: Activity[] = [];
  for (const a of [...acts].sort((x, y) => x.at.localeCompare(y.at))) {
    const k = `${a.kind}|${dayOf(a.at)}|${a.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function streaks(days: ReadonlySet<string>, now: Date): { current: number; best: number } {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  // The current run ends today or yesterday (today may not have started yet).
  let current = 0;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let t = days.has(now.toISOString().slice(0, 10)) ? today : today - 86_400_000; days.has(new Date(t).toISOString().slice(0, 10)); t -= 86_400_000) current++;
  return { current, best };
}

export function xpOf(acts: readonly Activity[], now = new Date()): { total: number; byKind: Record<ActionKind, number>; byDay: Record<string, number>; streak: { current: number; best: number } } {
  const byKind: Record<ActionKind, number> = { read: 0, review: 0, decide: 0, write: 0 };
  const byDay: Record<string, number> = {};
  const nth = new Map<string, number>();
  let total = 0;
  for (const a of distinct(acts)) {
    const k = `${a.kind}|${dayOf(a.at)}`;
    const n = (nth.get(k) ?? 0) + 1;
    nth.set(k, n);
    const gain = BASE[a.kind] * Math.max(FLOOR, DECAY ** (n - 1));
    total += gain;
    byKind[a.kind] += gain;
    byDay[dayOf(a.at)] = (byDay[dayOf(a.at)] ?? 0) + gain;
  }
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    total: Math.round(total),
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round(v)])) as Record<ActionKind, number>,
    byDay: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, round(v)])),
    streak: streaks(new Set(Object.keys(byDay)), now),
  };
}

/** Level n starts at 25 × n × (n − 1) XP: 0, 50, 150, 300, 500… */
export function levelOf(xp: number): { level: number; from: number; to: number } {
  let n = 1;
  while (25 * (n + 1) * n <= xp) n++;
  return { level: n, from: 25 * n * (n - 1), to: 25 * (n + 1) * n };
}

export type Tier = 'none' | 'bronze' | 'silver' | 'gold';
export type Badge = { readonly id: string; readonly tier: Tier; readonly count: number; readonly next: number | null; readonly steps: readonly [number, number, number] };

const BADGES: readonly { id: string; steps: readonly [number, number, number]; count: (acts: readonly Activity[], streak: { best: number }) => number }[] = [
  { id: 'reader', steps: [10, 50, 200], count: (a) => new Set(a.filter((x) => x.kind === 'read').map((x) => x.key)).size },
  { id: 'reviewer', steps: [25, 150, 600], count: (a) => a.filter((x) => x.kind === 'review').length },
  { id: 'decider', steps: [5, 25, 100], count: (a) => new Set(a.filter((x) => x.kind === 'decide').map((x) => x.key)).size },
  { id: 'builder', steps: [5, 25, 100], count: (a) => a.filter((x) => x.kind === 'write').length },
  { id: 'streak', steps: [3, 10, 30], count: (_a, s) => s.best },
];

export function badgesOf(acts: readonly Activity[], now = new Date()): Badge[] {
  const unique = distinct(acts);
  const { streak } = xpOf(acts, now);
  return BADGES.map((b) => {
    const count = b.count(unique, streak);
    const tier: Tier = count >= b.steps[2] ? 'gold' : count >= b.steps[1] ? 'silver' : count >= b.steps[0] ? 'bronze' : 'none';
    const next = tier === 'gold' ? null : b.steps[tier === 'none' ? 0 : tier === 'bronze' ? 1 : 2];
    return { id: b.id, tier, count, next, steps: b.steps };
  });
}

/* --------------------------------------------------------------- reading */

async function jsonLines<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, 'utf8').catch(() => '');
  const out: T[] = [];
  for (const line of raw.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line) as T); } catch { /* a torn line */ } }
  return out;
}

/** Everything the person did in this brain, from OKB's own local records. */
export async function activities(config: OkbConfig): Promise<Activity[]> {
  const root = statePaths(config).root;
  const [opens, reviews, queue, applied] = await Promise.all([
    jsonLines<{ at: string; path: string; kind: string }>(resolve(root, 'usage', 'notes.jsonl')),
    jsonLines<{ at: string; id: string }>(resolve(root, 'learn', 'log.jsonl')),
    loadQueue(config).catch(() => []),
    receipts(config).catch(() => []),
  ]);
  const out: Activity[] = [];
  for (const e of opens) if (e.kind === 'open') out.push({ kind: 'read', at: e.at, key: e.path });
  for (const r of reviews) out.push({ kind: 'review', at: r.at, key: `${r.id}@${r.at}` });
  for (const s of queue) if (s.decidedAt && s.decidedBy && s.status !== 'expired') out.push({ kind: 'decide', at: s.decidedAt, key: s.id });
  for (const r of applied) {
    if (r.rolledBack || !r.complete) continue;
    for (let i = 0; i < r.created + r.updated; i++) out.push({ kind: 'write', at: r.appliedAt, key: `${r.id}#${i}` });
  }
  return out;
}

export async function progress(config: OkbConfig, now = new Date()) {
  const acts = await activities(config);
  const xp = xpOf(acts, now);
  const today = now.toISOString().slice(0, 10);
  const week = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10)).map((d) => ({ day: d, xp: xp.byDay[d] ?? 0 }));
  return { xp: xp.total, today: xp.byDay[today] ?? 0, byKind: xp.byKind, level: levelOf(xp.total), streak: xp.streak, badges: badgesOf(acts, now), week };
}
