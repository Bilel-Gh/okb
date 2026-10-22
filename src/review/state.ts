import type { OkbConfig } from '../config/schema.js';
import type { Bundle, KbEntry } from '../kb/bundle.js';
import { trustTier } from '../okf/types.js';
import { openDb } from '../state/db.js';
import { asBundlePath } from '../util/paths.js';
import { readReceipts } from '../weekly/weekly.js';

/**
 * Where each note stands with the person (F2.0-53, D71): `pending` (to review:
 * the agent filed it and the person has not seen it) or `validated` (the person
 * said yes, or wrote it). Kept in the state database: recording it never
 * rewrites a note. « Verified » is not a state here: it is OKF's `verified`.
 */
export type ReviewState = 'pending' | 'validated';
export type NoteReview = { readonly path: string; readonly noteId: string | null; readonly state: ReviewState; readonly by: string; readonly at: string; readonly sha256: string | null; readonly reason: string | null; readonly receiptId: string | null };
type Row = { path: string; note_id: string | null; state: ReviewState; by: string; at: string; sha256: string | null; reason: string | null; receipt_id: string | null };
const fromRow = (r: Row): NoteReview => ({ path: r.path, noteId: r.note_id, state: r.state, by: r.by, at: r.at, sha256: r.sha256, reason: r.reason, receiptId: r.receipt_id });
const idOf = (e: KbEntry | undefined) => { const id = (e?.ext as { id?: unknown } | undefined)?.id; return typeof id === 'string' ? id : null; };

/** Give every note without a review its first one: approved by a human or written by the person → validated; generated without a trace → to review. */
export async function classifyNotes(config: OkbConfig, bundle: Bundle): Promise<number> {
  const db = openDb(config);
  const known = new Set(db.all<{ path: string }>('SELECT path FROM note_reviews').map((r) => r.path));
  const todo = bundle.entries.filter((e) => !e.reserved && !known.has(e.path));
  if (!todo.length) return 0;
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

export function setReview(config: OkbConfig, path: string, state: ReviewState, by: string, extra: { reason?: string | null; at?: string; receiptId?: string | null; noteId?: string | null; sha256?: string | null } = {}): void {
  openDb(config).run(
    `INSERT INTO note_reviews (path, note_id, state, by, at, sha256, reason, receipt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET state = excluded.state, by = excluded.by, at = excluded.at,
       note_id = COALESCE(excluded.note_id, note_reviews.note_id), sha256 = COALESCE(excluded.sha256, note_reviews.sha256),
       reason = CASE WHEN excluded.reason IS NULL THEN note_reviews.reason ELSE excluded.reason END,
       receipt_id = COALESCE(excluded.receipt_id, note_reviews.receipt_id)`,
    path, extra.noteId ?? null, state, by, extra.at ?? new Date().toISOString(), extra.sha256 ?? null, extra.reason ?? null, extra.receiptId ?? null,
  );
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
