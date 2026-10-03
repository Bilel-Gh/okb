import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Receipt } from '../apply/apply.js';
import type { OkbConfig } from '../config/schema.js';
import { listInbox, type InboxItem } from '../inbox/inbox.js';
import { readFocus, sessionsSince } from '../focus/focus.js';
import { loadBundleFor } from '../kb/bundle.js';
import { maintain } from '../maintain/maintain.js';
import { listProposals } from '../proposal/store.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists } from '../util/fsx.js';

/**
 * The weekly review, read-only: what waits (inbox, proposals), what changed,
 * what to re-read while it is still fresh, and what maintenance found. It
 * prepares a ritual; it decides and writes nothing.
 */
export const REVIEW_MILESTONES = [1, 7, 30, 90] as const;

export type WeeklyReport = {
  readonly period: { readonly from: string; readonly to: string; readonly days: number };
  readonly inbox: { readonly open: number; readonly oldestDays: number | null; readonly stale: readonly InboxItem[] };
  readonly proposals: { readonly prepared: readonly { id: string; ageDays: number; changes: number; label: string }[]; readonly staleDays: number };
  readonly applied: { readonly receipts: number; readonly created: readonly string[]; readonly updated: readonly string[] };
  /** Notes created N days ago for N in REVIEW_MILESTONES: re-reading them now fixes them in memory. */
  readonly toReview: readonly { path: string; title: string; ageDays: number; milestone: number }[];
  readonly maintenance: { readonly errors: number; readonly warnings: number; readonly byCode: Readonly<Record<string, number>> };
  /** Is the compass still right? Sessions journaled this period and their open "next time". */
  readonly focus: { readonly path: string; readonly exists: boolean; readonly ageDays: number | null; readonly stale: boolean };
  readonly sessions: { readonly count: number; readonly next: readonly { at: string; profile: string; next: string }[] };
};

const dayMs = 86_400_000;
const days = (from: number, to: number) => Math.floor((to - from) / dayMs);

export async function weeklyReport(
  config: OkbConfig,
  options: { now?: Date; days?: number; inboxStaleDays?: number; proposalStaleDays?: number } = {},
): Promise<WeeklyReport> {
  const now = options.now ?? new Date();
  const period = options.days ?? 7;
  const from = new Date(now.getTime() - period * dayMs);
  const inboxStale = options.inboxStaleDays ?? 21;
  const proposalStale = options.proposalStaleDays ?? 7;

  const inbox = await listInbox(config, { now });
  const prepared = (await listProposals(config))
    .filter((p) => p.status === 'prepared')
    .map((p) => ({ id: p.id, ageDays: days(Date.parse(p.createdAt), now.getTime()), changes: p.changes.length, label: p.notes[0] ?? p.changes[0]?.label ?? '' }))
    .sort((a, b) => b.ageDays - a.ageDays);

  const receipts = await readReceipts(config);
  const created = new Map<string, number>();
  const inPeriod = { receipts: 0, created: new Set<string>(), updated: new Set<string>() };
  for (const r of receipts) {
    const at = Date.parse(r.appliedAt);
    const recent = at >= from.getTime() && at <= now.getTime();
    if (recent) inPeriod.receipts++;
    for (const result of r.results) {
      if (result.action === 'created' && !created.has(result.path)) created.set(result.path, at);
      if (recent && result.action === 'created') inPeriod.created.add(result.path);
      if (recent && result.action === 'updated') inPeriod.updated.add(result.path);
    }
  }

  const bundle = await loadBundleFor(config);
  const titles = new Map(bundle.entries.map((e) => [e.path as string, e.title]));
  const toReview: { path: string; title: string; ageDays: number; milestone: number }[] = [];
  for (const [path, at] of created) {
    if (!titles.has(path)) continue;
    const age = days(at, now.getTime());
    // The latest milestone reached during the period, so a weekly run never misses one.
    const milestone = [...REVIEW_MILESTONES].reverse().find((m) => m <= age && m > age - period);
    if (milestone !== undefined) toReview.push({ path, title: String(titles.get(path) ?? path), ageDays: age, milestone });
  }
  toReview.sort((a, b) => a.milestone - b.milestone || a.path.localeCompare(b.path));

  const audit = await maintain(config, { bundle, now });
  const byCode: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;
  const levels = [...audit.okfFindings.map((f) => [f.code, f.level]), ...audit.linkIssues.map((i) => [i.code, i.level]), ...audit.issues.map((i) => [i.code, i.level])];
  for (const [code, level] of levels) {
    if (level === 'error') errors++;
    else if (level === 'warning') warnings++;
    else continue;
    byCode[code!] = (byCode[code!] ?? 0) + 1;
  }

  const focus = await readFocus(config, { now });
  const sessions = (await sessionsSince(config, from)).filter((s) => Date.parse(s.at) <= now.getTime());

  return {
    period: { from: from.toISOString(), to: now.toISOString(), days: period },
    inbox: { open: inbox.length, oldestDays: inbox[0]?.ageDays ?? null, stale: inbox.filter((i) => i.ageDays >= inboxStale) },
    proposals: { prepared, staleDays: proposalStale },
    applied: { receipts: inPeriod.receipts, created: [...inPeriod.created].sort(), updated: [...inPeriod.updated].sort() },
    toReview,
    maintenance: { errors, warnings, byCode },
    focus: { path: focus.path, exists: focus.exists, ageDays: focus.ageDays, stale: focus.stale },
    sessions: { count: sessions.length, next: sessions.filter((s) => s.next).slice(0, 5).map((s) => ({ at: s.at, profile: s.profile, next: s.next! })) },
  };
}

async function readReceipts(config: OkbConfig): Promise<Receipt[]> {
  const dir = statePaths(config).receipts;
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: Receipt[] = [];
  for (const name of names) {
    const r = await readJsonIfExists<Receipt>(resolve(dir, name));
    if (r && r.complete && !r.rolledBack && Array.isArray(r.results)) out.push(r);
  }
  return out;
}
