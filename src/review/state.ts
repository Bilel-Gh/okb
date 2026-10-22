import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle, KbEntry } from '../kb/bundle.js';
import { trustTier } from '../okf/types.js';
import { openDb } from '../state/db.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';
import { readReceipts } from '../weekly/weekly.js';

/**
 * Where each note stands with the person (F2.0-53, D71): `pending` (to review:
 * the agent filed it and the person has not seen it) or `validated` (the person
 * said yes, or wrote it). Kept in the state database: recording it never
 * rewrites a note. « Verified » is not a state here: it is OKF's `verified`.
 */
export type ReviewState = 'pending' | 'validated';
export type NoteReview = { readonly path: string; readonly noteId: string | null; readonly state: ReviewState; readonly by: string; readonly at: string; readonly sha256: string | null; readonly reason: string | null; readonly receiptId: string | null; /** The path its receipt knows it by (it may have moved since). */ readonly originPath: string | null };
type Row = { path: string; note_id: string | null; state: ReviewState; by: string; at: string; sha256: string | null; reason: string | null; receipt_id: string | null; origin_path: string | null };
const fromRow = (r: Row): NoteReview => ({ path: r.path, noteId: r.note_id, state: r.state, by: r.by, at: r.at, sha256: r.sha256, reason: r.reason, receiptId: r.receipt_id, originPath: r.origin_path });
const idOf = (e: KbEntry | undefined) => { const id = (e?.ext as { id?: unknown } | undefined)?.id; return typeof id === 'string' ? id : null; };

/** Give every note without a review its first one: approved by a human or written by the person → validated; generated without a trace → to review. */
export async function classifyNotes(config: OkbConfig, bundle: Bundle): Promise<number> {
  const db = openDb(config);
  const rows = db.all<{ path: string }>('SELECT path FROM note_reviews').map((r) => r.path);
  const known = new Set(rows);
  const todo = bundle.entries.filter((e) => !e.reserved && !known.has(e.path));
  // A review whose note is gone from the disk (and not found by its id) is dropped, so a new file there starts afresh (I5).
  const gone = rows.filter((p) => !bundle.byPath.has(asBundlePath(p)) && !existsSync(resolve(config.kb.root, p)));
  if (!todo.length && !gone.length) return 0;
  const approved = new Set<string>();
  for (const r of await readReceipts(config).catch(() => [])) {
    if (!r.approval?.approvedBy?.startsWith('human:') || r.rolledBack) continue;
    for (const res of r.results) if (res.action !== 'deleted') approved.add(res.path);
  }
  const at = new Date().toISOString();
  let added = 0;
  db.tx(() => {
    for (const e of todo) {
      // A note moved outside OKB keeps its review through its id.
      const id = idOf(e);
      const moved = id ? db.get<Row>('SELECT * FROM note_reviews WHERE note_id = ?', id) : undefined;
      if (moved && !bundle.byPath.has(asBundlePath(moved.path))) { db.run('UPDATE note_reviews SET path = ? WHERE path = ?', e.path, moved.path); continue; }
      const generated = Boolean(bundle.docs.get(e.path)?.data.generated);
      const state: ReviewState = approved.has(e.path) || !generated ? 'validated' : 'pending';
      db.run('INSERT OR IGNORE INTO note_reviews (path, note_id, state, by, at, sha256, reason, receipt_id) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
        e.path, id, state, approved.has(e.path) ? 'receipt' : generated ? 'migration' : 'person', at, e.sha256);
      added++;
    }
    for (const p of gone) if (!existsSync(resolve(config.kb.root, p))) db.run('DELETE FROM note_reviews WHERE path = ?', p);
  });
  return added;
}

/** A note's review; a note moved outside OKB is found again by its id. */
export function reviewOf(config: OkbConfig, path: string, bundle?: Bundle): NoteReview | null {
  const db = openDb(config);
  const row = db.get<Row>('SELECT * FROM note_reviews WHERE path = ?', path);
  if (row) return fromRow(row);
  const id = idOf(bundle?.byPath.get(asBundlePath(path)));
  if (!id) return null;
  const moved = db.get<Row>('SELECT * FROM note_reviews WHERE note_id = ?', id);
  if (!moved || bundle?.byPath.has(asBundlePath(moved.path))) return null;
  db.run('UPDATE note_reviews SET path = ? WHERE path = ?', path, moved.path);
  return fromRow({ ...moved, path });
}

/** Record a review. A field left out keeps its value; `receiptId` and `originPath` given (even null) replace it. */
export function setReview(config: OkbConfig, path: string, state: ReviewState, by: string, extra: { reason?: string | null; at?: string; receiptId?: string | null; noteId?: string | null; sha256?: string | null; originPath?: string | null } = {}): void {
  const receiptGiven = 'receiptId' in extra ? 1 : 0;
  openDb(config).run(
    `INSERT INTO note_reviews (path, note_id, state, by, at, sha256, reason, receipt_id, origin_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at,
       note_id = COALESCE(excluded.note_id, note_reviews.note_id), sha256 = COALESCE(excluded.sha256, note_reviews.sha256),
       reason = CASE WHEN excluded.reason IS NULL THEN note_reviews.reason ELSE excluded.reason END,
       receipt_id = CASE WHEN ${receiptGiven} THEN excluded.receipt_id ELSE note_reviews.receipt_id END,
       origin_path = CASE WHEN ${receiptGiven} THEN excluded.origin_path ELSE note_reviews.origin_path END`,
    path, extra.noteId ?? null, state, by, extra.at ?? new Date().toISOString(), extra.sha256 ?? null, extra.reason ?? null, extra.receiptId ?? null, (extra.originPath ?? extra.receiptId) ? (extra.originPath ?? path) : null,
  );
}

/**
 * Whether the agent's change may go in without the person (D71): it creates a note
 * not there yet, or rewrites a note still to review that nobody touched since the
 * agent's last write. Never a deletion; never a validated note.
 */
export function mayGoInDirectly(config: OkbConfig, kind: string, path: string, current: string | null): boolean {
  if (kind === 'create-document') return current === null;
  if (kind === 'delete-document' || current === null) return false;
  const review = reviewOf(config, path);
  return review?.state === 'pending' && (review.sha256 === null || review.sha256 === sha256(current));
}

export function forgetReview(config: OkbConfig, path: string): void {
  openDb(config).run('DELETE FROM note_reviews WHERE path = ?', path);
}

export type PendingNote = NoteReview & { readonly title: string; readonly type: string };

/** What is to review, oldest first; a path no longer in the KB is left out. */
export function pendingList(config: OkbConfig, bundle: Bundle): PendingNote[] {
  return openDb(config).all<Row>("SELECT * FROM note_reviews WHERE state = 'pending' ORDER BY at, path").map(fromRow)
    .flatMap((r) => { const e = bundle.byPath.get(asBundlePath(r.path)); return e ? [{ ...r, title: e.title, type: e.type }] : []; });
}

/** How much of the KB the person validated (F2.0-57); `share` is null for an empty KB. */
export async function validatedShare(config: OkbConfig, bundle: Bundle): Promise<{ total: number; validated: number; verified: number; pending: number; share: number | null }> {
  await classifyNotes(config, bundle);
  const states = new Map(openDb(config).all<Row>('SELECT path, state FROM note_reviews').map((r) => [r.path, r.state]));
  let total = 0, validated = 0, verified = 0;
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    total++;
    if (states.get(e.path) !== 'validated') continue;
    validated++;
    const doc = bundle.docs.get(e.path);
    if (doc && trustTier(doc.data) !== 'unverified') verified++;
  }
  return { total, validated, verified, pending: total - validated, share: total ? Math.round((validated * 100) / total) : null };
}
