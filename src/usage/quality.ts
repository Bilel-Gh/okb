import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { listProposals } from '../proposal/store.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists, readTextIfExists } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { bundlePathToAbsolute } from '../util/paths.js';
import type { Receipt } from '../apply/apply.js';

/**
 * How well OKB's work holds up, from what already happened to the proposals:
 * what the person kept, dropped or undid, how long they waited for review, and
 * which applied notes they later rewrote by hand. These are the signs that the
 * writing was right or not, read from local files without any model call.
 */
export type QualitySignals = {
  readonly kb: string;
  readonly proposals: number;
  readonly applied: number;
  readonly partial: number;
  /** Changes left out when approving: the parts the person did not want. */
  readonly changesProposed: number;
  readonly changesDropped: number;
  /** Dropped changes by kind: article, concept-card, link, metadata. */
  readonly droppedByKind: Readonly<Record<string, number>>;
  readonly rolledBack: number;
  readonly pending: number;
  readonly pendingOldestDays: number | null;
  readonly superseded: number;
  readonly reviewHoursMedian: number | null;
  /** Applied notes changed by hand since (not by a later proposal). */
  readonly editedAfter: number;
  readonly appliedFiles: number;
  readonly editedPaths: readonly string[];
};

const median = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export async function qualitySignals(config: OkbConfig, options: { since?: string; now?: Date } = {}): Promise<QualitySignals> {
  const now = options.now ?? new Date();
  const since = options.since ?? '';
  const proposals = (await listProposals(config).catch(() => [])).filter((p) => p.createdAt >= since);
  const paths = statePaths(config);
  const receipts: Receipt[] = [];
  for (const f of await readdir(paths.receipts).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    const r = await readJsonIfExists<Receipt>(join(paths.receipts, f)).catch(() => null);
    if (r) receipts.push(r);
  }
  receipts.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  const byProposal = new Map<string, Receipt[]>();
  for (const r of receipts) byProposal.set(r.proposalId, [...(byProposal.get(r.proposalId) ?? []), r]);

  let applied = 0, partial = 0, rolledBack = 0, pending = 0, superseded = 0, changesProposed = 0, changesDropped = 0;
  let oldestPending: number | null = null;
  const droppedByKind: Record<string, number> = {};
  const reviewHours: number[] = [];
  for (const p of proposals) {
    changesProposed += p.changes.length;
    if (p.status === 'superseded') { superseded += 1; continue; }
    const rs = byProposal.get(p.id) ?? [];
    if (!rs.length) {
      pending += 1;
      const days = (now.getTime() - Date.parse(p.createdAt)) / 86_400_000;
      oldestPending = Math.max(oldestPending ?? 0, days);
      continue;
    }
    applied += 1;
    const kept = new Set(rs.flatMap((r) => r.selection));
    const droppedChanges = p.changes.filter((c) => !kept.has(c.id));
    for (const c of droppedChanges) droppedByKind[c.category] = (droppedByKind[c.category] ?? 0) + 1;
    const dropped = droppedChanges.length;
    changesDropped += dropped;
    if (dropped) partial += 1;
    if (rs.some((r) => r.rolledBack)) rolledBack += 1;
    const first = rs[0]!;
    const approvedAt = Date.parse(first.approval?.approvedAt ?? first.appliedAt);
    if (Number.isFinite(approvedAt)) reviewHours.push(Math.max(0, (approvedAt - Date.parse(p.createdAt)) / 3_600_000));
  }

  // The last applied version of each file, compared with the file today.
  const lastWrite = new Map<string, string>();
  for (const r of receipts) {
    if (r.rolledBack) continue;
    if (since && r.appliedAt < since) continue;
    for (const res of r.results) if (res.action === 'created' || res.action === 'updated') lastWrite.set(res.path, res.sha256);
  }
  const edited: string[] = [];
  for (const [path, hash] of lastWrite) {
    const text = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path as never)).catch(() => null);
    if (text !== null && sha256(text) !== hash) edited.push(path);
  }
  return {
    kb: config.profile.id,
    proposals: proposals.length,
    applied, partial, changesProposed, changesDropped, droppedByKind, rolledBack, pending, superseded,
    pendingOldestDays: oldestPending === null ? null : Math.round(oldestPending),
    reviewHoursMedian: median(reviewHours) === null ? null : Math.round(median(reviewHours)! * 10) / 10,
    editedAfter: edited.length,
    appliedFiles: lastWrite.size,
    editedPaths: edited.sort(),
  };
}
