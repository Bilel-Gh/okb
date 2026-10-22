import { sha256 } from '../util/hash.js';
import { readReceipts } from '../weekly/weekly.js';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { applyProposal, loadReceipt } from '../apply/apply.js';
import { grantApproval } from '../apply/approval.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { applyFileEdits, planMove } from '../links/check.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { listProposals, loadProposal, saveProposal, updateProposalStatus } from '../proposal/store.js';
import { openDb } from '../state/db.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists } from '../util/fsx.js';
import { asBundlePath } from '../util/paths.js';
import { classifyNotes, forgetReview, pendingList, reviewOf, setReview, type PendingNote } from './state.js';

/**
 * The person's gestures on what the agent filed (F2.0-55, D71). Each one goes
 * through the engine with the person's approval, so receipts, backups and undo
 * stay as for any other change. Called only for the person (engine: agents: false).
 */
async function personApply(config: OkbConfig, proposal: Proposal, env: NodeJS.ProcessEnv): Promise<void> {
  await saveProposal(config, proposal);
  const saved = await loadProposal(config, proposal.id);
  await grantApproval(config, saved, saved.changes.map((c) => c.id), config.profile.humanActor);
  await applyProposal(config, saved, { env });
}

export type WaitingChange = { readonly id: string; readonly createdAt: string; readonly label: string; readonly paths: readonly string[] };
export type ReviewList = { readonly notes: readonly PendingNote[]; readonly changes: readonly WaitingChange[]; readonly checks: readonly { id: string; path: string; createdAt: string }[]; /** Validated by the person since midnight. */ readonly sortedToday: number };

export async function reviewList(config: OkbConfig, bundle?: Bundle): Promise<ReviewList> {
  const b = bundle ?? await loadBundleFor(config);
  await classifyNotes(config, b);
  const changes = (await listProposals(config)).filter((p) => p.profileId === config.profile.id && p.status === 'prepared')
    .sort((a, x) => a.createdAt.localeCompare(x.createdAt))
    .map((p) => ({ id: p.id, createdAt: p.createdAt, label: p.notes[0] ?? p.changes[0]?.label ?? p.id, paths: [...new Set(p.changes.map((c) => c.path as string))] }));
  const checks = openDb(config).all<{ id: string; path: string; created_at: string }>("SELECT id, path, created_at FROM note_requests WHERE state = 'pending' ORDER BY created_at").map((r) => ({ id: r.id, path: r.path, createdAt: r.created_at }));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const sortedToday = openDb(config).get<{ n: number }>("SELECT COUNT(*) n FROM note_reviews WHERE state = 'validated' AND by LIKE 'human:%' AND at >= ?", midnight.toISOString())!.n;
  return { notes: pendingList(config, b), changes, checks, sortedToday };
}

export function validateNotes(config: OkbConfig, paths: readonly string[]): number {
  let n = 0;
  for (const p of paths) {
    const r = reviewOf(config, p);
    if (!r) continue;
    setReview(config, p, 'validated', config.profile.humanActor);
    n++;
  }
  return n;
}

/** « Non »: a note the agent created goes (only it); a note to review the agent changed gets its text back. */
export async function rejectNote(config: OkbConfig, path: string, env: NodeJS.ProcessEnv): Promise<'removed' | 'restored'> {
  const review = reviewOf(config, path);
  if (!review || review.state !== 'pending') throw new OkbError('E_CONFLICT', `${path} is not to review`, { key: 'reviewNotPending' });
  const bundle = await loadBundleFor(config);
  const receipt = review.receiptId ? await loadReceipt(config, review.receiptId).catch(() => null) : null;
  const known = review.originPath ?? path;
  const result = receipt?.results.find((r) => r.path === known);
  if (!result || result.action === 'created') {
    await personApply(config, proposeFiles(config, bundle, new Map([[path, null]]), `remove ${path} (« Non » in To review)`), env);
    forgetReview(config, path);
    return 'removed';
  }
  const backup = receipt!.backups[known];
  const before = backup ? await readTextIfExists(resolve(statePaths(config).backups, receipt!.proposalId, backup)) : null;
  if (before === null) throw new OkbError('E_NOT_FOUND', `no earlier text kept for ${path}`, { key: 'reviewNoBackup' });
  await personApply(config, proposeFiles(config, bundle, new Map([[path, before]]), `restore ${path} (« Non » in To review)`), env);
  // The text now is the one before that receipt: the earlier agent write that made it, if any (I3).
  const earlier = (await readReceipts(config)).filter((r) => r.appliedAt < receipt!.appliedAt && r.approval.approvedBy === 'policy:review-later' && r.results.some((x) => x.path === known && x.action !== 'deleted' && x.action !== 'skipped'))
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0];
  const now = await readTextIfExists(resolve(config.kb.root, path));
  setReview(config, path, 'pending', review.by, { receiptId: earlier?.id ?? null, originPath: earlier ? known : null, ...(now !== null ? { sha256: sha256(now) } : {}) });
  return 'restored';
}

export async function approveChange(config: OkbConfig, proposalId: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const proposal = await loadProposal(config, proposalId);
  if (proposal.status !== 'prepared') throw new OkbError('E_CONFLICT', 'this change is not waiting', { key: 'reviewChangeNotWaiting' });
  await grantApproval(config, proposal, proposal.changes.map((c) => c.id), config.profile.humanActor);
  const receipt = await applyProposal(config, proposal, { env });
  const touched = receipt.results.filter((r) => r.action !== 'skipped').map((r) => r.path as string);
  for (const p of touched) {
    const r = receipt.results.find((x) => x.path === p)!;
    if (r.action === 'deleted') forgetReview(config, p); else setReview(config, p, 'validated', config.profile.humanActor, { receiptId: receipt.id, sha256: r.sha256 });
  }
  return touched;
}

export async function rejectChange(config: OkbConfig, proposalId: string): Promise<void> {
  const proposal = await loadProposal(config, proposalId);
  if (proposal.status !== 'prepared') throw new OkbError('E_CONFLICT', 'this change is not waiting', { key: 'reviewChangeNotWaiting' });
  await updateProposalStatus(config, proposalId, 'superseded');
}

/** Another place: the note moves with its links, and its review follows it. */
export async function moveNote(config: OkbConfig, path: string, folder: string, env: NodeJS.ProcessEnv): Promise<string> {
  const bundle = await loadBundleFor(config);
  const to = asBundlePath(`${folder.replace(/^\/+|\/+$/g, '')}/${basename(path)}`);
  const plan = planMove(bundle.snapshot, path, to);
  if (!bundle.snapshot.files.has(plan.from)) throw new OkbError('E_NOT_FOUND', 'this note is no longer there', { key: 'reviewMoveMissing' });
  if (bundle.snapshot.files.has(plan.to)) throw new OkbError('E_CONFLICT', 'a note already has this name there', { key: 'reviewMoveExists' });
  const updated = applyFileEdits(bundle.snapshot, [...plan.inbound, ...plan.outbound]);
  const desired = new Map<string, string | null>(updated);
  desired.set(plan.to, updated.get(plan.from) ?? bundle.snapshot.files.get(plan.from)!);
  desired.set(plan.from, null);
  const review = reviewOf(config, path);
  await personApply(config, proposeFiles(config, bundle, desired, `move ${plan.from} to ${plan.to}`, true), env);
  if (review) {
    // The review follows the note, with what « Non » needs: its receipt, the path that receipt knows, its text (I3).
    const moved = await readTextIfExists(resolve(config.kb.root, plan.to));
    forgetReview(config, path);
    setReview(config, plan.to, review.state, review.by, { reason: review.reason, at: review.at, noteId: review.noteId, receiptId: review.receiptId, originPath: review.originPath ?? (review.receiptId ? path : null), ...(moved !== null ? { sha256: sha256(moved) } : {}) });
  }
  return plan.to;
}

/** « Oui à tout »: only what the person saw on their screen and is still waiting — never what arrived since (I2). */
export async function yesToAll(config: OkbConfig, shown: { notes: readonly string[]; changes: readonly string[] }, env: NodeJS.ProcessEnv): Promise<{ notes: number; changes: number }> {
  const list = await reviewList(config);
  const notes = validateNotes(config, list.notes.map((n) => n.path).filter((p) => shown.notes.includes(p)));
  let changes = 0;
  for (const c of list.changes.filter((x) => shown.changes.includes(x.id))) { await approveChange(config, c.id, env); changes++; }
  return { notes, changes };
}

/** Ask the agent to check a note against its sources at the next session. */
export function requestCheck(config: OkbConfig, path: string): string {
  const db = openDb(config);
  const open = db.get<{ id: string }>("SELECT id FROM note_requests WHERE path = ? AND state = 'pending'", path);
  if (open) return open.id;
  const id = `C-${randomBytes(3).toString('hex')}`;
  db.run("INSERT INTO note_requests (id, path, kind, state, created_at) VALUES (?, ?, 'check', 'pending', ?)", id, path, new Date().toISOString());
  return id;
}
