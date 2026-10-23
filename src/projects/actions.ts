import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { addEntry } from './journal.js';
import { getProject, listProjects, newId } from './projects.js';

/**
 * Actions and what the person waits for (F2.0-06): what they must do, what
 * they expect from someone, what someone asked them, and a project's open
 * questions; with a date when there is one.
 */
export const ACTION_KINDS = ['todo', 'waiting', 'asked', 'question'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionStatus = 'open' | 'done' | 'dropped';
/** How much an action matters (F2.4-13): medium unless someone says otherwise. */
export const IMPORTANCES = ['low', 'medium', 'high'] as const;
export type Importance = (typeof IMPORTANCES)[number];
const RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };
export type Action = {
  readonly id: string;
  readonly projectId: string | null;
  readonly text: string;
  readonly kind: ActionKind;
  /** Who it is expected from, or who asked. */
  readonly who: string | null;
  /** A day, `YYYY-MM-DD`. */
  readonly due: string | null;
  readonly status: ActionStatus;
  readonly source: 'person' | 'ai';
  readonly createdAt: string;
  readonly doneAt: string | null;
  /** The work it is tied to, as a module names it (a ticket reference); the core does not read it. */
  readonly workRef: string | null;
  readonly importance: Importance;
  /** At most one pinned open action per work. */
  readonly pinned: boolean;
  /** D74: who ticked it and who set its importance last, when it was not its author's own doing. */
  readonly doneBy: 'person' | 'agent' | null;
  readonly importanceBy: 'person' | 'agent' | null;
  /** D74: why the agent added it (« d’après les critères Jira »). */
  readonly why: string | null;
};
export type Actor = 'person' | 'agent';

type Row = { id: string; project_id: string | null; text: string; kind: string; who: string | null; due: string | null; status: string; source: string; created_at: string; done_at: string | null; ticket_ref: string | null; importance: string; pinned: number; done_by: string | null; importance_by: string | null; why: string | null };
const COLUMNS = 'id, project_id, text, kind, who, due, status, source, created_at, done_at, ticket_ref, importance, pinned, done_by, importance_by, why';
const fromRow = (r: Row): Action => ({ id: r.id, projectId: r.project_id, text: r.text, kind: r.kind as ActionKind, who: r.who, due: r.due, status: r.status as ActionStatus, source: r.source as Action['source'], createdAt: r.created_at, doneAt: r.done_at, workRef: r.ticket_ref, importance: r.importance as Importance, pinned: Boolean(r.pinned), doneBy: r.done_by as Actor | null, importanceBy: r.importance_by as Actor | null, why: r.why });
function checkImportance(i: string | undefined): void {
  if (i !== undefined && !(IMPORTANCES as readonly string[]).includes(i)) throw new OkbError('E_INVALID', `importance must be one of ${IMPORTANCES.join(', ')}`, { key: 'actionImportance' });
}

export function getAction(config: OkbConfig, id: string): Action {
  const row = openDb(config).get<Row>(`SELECT ${COLUMNS} FROM actions WHERE id = ?`, id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no action "${id}"`, { key: 'actionUnknown', params: { id } });
  return fromRow(row);
}

export type NewAction = { readonly text: string; readonly kind?: ActionKind; readonly project?: string; readonly who?: string; readonly due?: string; readonly source?: 'person' | 'ai'; readonly workRef?: string; readonly importance?: Importance; readonly pinned?: boolean; readonly why?: string };

const STOP = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'par', 'the', 'and', 'for', 'with', 'from']);
/** A todo's text reduced to what it says: lower case, no accents or punctuation, single spaces (D74). */
export function todoKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** The words that carry the meaning: a number always counts (« PR 42 » is not « PR 57 »). */
const words = (key: string) => new Set(key.split(' ').filter((w) => /\d/.test(w) || (w.length > 2 && !STOP.has(w))));
/** Two todos say the same thing when their meaningful words overlap by 80 % or more; a short one must match exactly. */
function alike(a: string, b: string): boolean {
  if (a === b) return true;
  const x = words(a), y = words(b);
  if (x.size < 2 || y.size < 2) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / new Set([...x, ...y]).size >= 0.8;
}
type Db = ReturnType<typeof openDb>;
/** The refusal a todo would hit on a ticket, whatever the case of its reference (D74). */
function refusedOn(db: Db, workRef: string, text: string): { key: string; text: string } | undefined {
  const key = todoKey(text);
  return db.all<{ key: string; text: string }>('SELECT key, text FROM action_refusals WHERE upper(work_ref) = upper(?)', workRef).find((r) => alike(r.key, key));
}
function refusedError(refused: { text: string }, workRef: string): OkbError {
  return new OkbError('E_CONFLICT', `the person removed « ${refused.text} » from ${workRef}: do not propose it again`, { key: 'actionRefused', params: { text: refused.text, ref: workRef } });
}
function refuse(db: Db, workRef: string, text: string, now: Date): void {
  db.run('INSERT OR REPLACE INTO action_refusals (work_ref, key, text, at) VALUES (?, ?, ?, ?)', workRef, todoKey(text), text, now.toISOString());
}

export function addAction(config: OkbConfig, input: NewAction, now = new Date()): Action {
  assertNoSecrets({ text: input.text, who: input.who ?? '', why: input.why ?? '' }, 'action');
  checkImportance(input.importance);
  const project = input.project ? getProject(config, input.project) : null;
  const db = openDb(config);
  if (input.source === 'ai' && input.workRef) {
    // D74: the agent never brings back what the person removed, and never adds the same todo twice.
    const key = todoKey(input.text);
    const refused = refusedOn(db, input.workRef, input.text);
    if (refused) throw refusedError(refused, input.workRef);
    const same = db.all<Row>(`SELECT ${COLUMNS} FROM actions WHERE upper(ticket_ref) = upper(?) AND status = 'open'`, input.workRef).find((r) => todoKey(r.text) === key);
    if (same) return fromRow(same);
  }
  const id = newId('A');
  db.tx(() => {
    if (input.pinned && input.workRef) db.run("UPDATE actions SET pinned = 0 WHERE ticket_ref = ? AND status = 'open'", input.workRef);
    db.run('INSERT INTO actions (id, project_id, text, kind, who, due, status, source, created_at, ticket_ref, importance, pinned, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, project?.id ?? null, input.text, input.kind ?? 'todo', input.who ?? null, input.due ?? null, 'open', input.source ?? 'person', now.toISOString(), input.workRef ?? null, input.importance ?? 'medium', input.pinned ? 1 : 0, input.why?.trim() || null);
  });
  return getAction(config, id);
}

export type ActionFilter = { readonly project?: string; readonly status?: ActionStatus | 'all'; readonly kind?: ActionKind };

/** The actions: the late ones first, then by date, the undated last. A module turned off hides its projects' actions. */
export async function listActions(config: OkbConfig, env: NodeJS.ProcessEnv, filter: ActionFilter = {}): Promise<Action[]> {
  const shown = new Set((await listProjects(config, env, { status: 'all' })).map((p) => p.id));
  const status = filter.status ?? 'open';
  const day = new Date().toISOString().slice(0, 10);
  return openDb(config).all<Row>(`SELECT ${COLUMNS} FROM actions ORDER BY created_at, rowid`)
    .map(fromRow)
    // The late first, then the important, then by date (the undated last), then the oldest.
    .sort((a, b) => Number(Boolean(b.due && b.due < day)) - Number(Boolean(a.due && a.due < day)) || RANK[a.importance] - RANK[b.importance] || Number(a.due === null) - Number(b.due === null) || (a.due ?? '').localeCompare(b.due ?? ''))
    .filter((a) => a.projectId === null || shown.has(a.projectId))
    .filter((a) => (status === 'all' || a.status === status) && (!filter.project || a.projectId === filter.project) && (!filter.kind || a.kind === filter.kind));
}

export type ActionPatch = { readonly status?: ActionStatus; readonly text?: string; readonly who?: string | null; readonly due?: string | null; readonly importance?: Importance; readonly pinned?: boolean; readonly workRef?: string | null };

/** Change an action. Doing it leaves a line in the journal of its project. An agent ticks, reopens, pins and sets
 * the importance of any todo, but rewrites or drops only its own (D74). */
export function updateAction(config: OkbConfig, id: string, patch: ActionPatch, now = new Date(), actor: Actor = 'person'): Action {
  const db = openDb(config);
  return db.tx(() => {
    const before = getAction(config, id);
    if (actor === 'agent') {
      if (before.source !== 'ai' && (patch.text !== undefined || patch.who !== undefined || patch.due !== undefined || patch.workRef !== undefined || patch.status === 'dropped'))
        throw new OkbError('E_NOT_APPROVED', 'this todo is the person’s: the agent may tick it or set its importance, not rewrite or drop it', { key: 'actionPersonOwn' });
      // A removed or dropped todo comes back only by the person (« Annuler »); the agent reopens only what was done.
      if (patch.status !== undefined && patch.status !== before.status && (before.status === 'dropped' || (patch.status === 'open' && before.status !== 'done')))
        throw new OkbError('E_NOT_APPROVED', 'the person removed this todo: only they bring it back', { key: 'actionPersonOwn' });
      const ref = patch.workRef === undefined ? before.workRef : patch.workRef;
      if (ref && (patch.text !== undefined || patch.workRef !== undefined)) { const refused = refusedOn(db, ref, patch.text ?? before.text); if (refused) throw refusedError(refused, ref); }
    }
    assertNoSecrets({ text: patch.text ?? '', who: patch.who ?? '' }, 'action');
    checkImportance(patch.importance);
    if (patch.text !== undefined && !patch.text.trim()) throw new OkbError('E_INVALID', 'an action needs a text', { key: 'actionEmpty' });
    const status = patch.status ?? before.status;
    const doneAt = status === 'open' ? null : before.status === status ? before.doneAt : now.toISOString();
    const workRef = patch.workRef === undefined ? before.workRef : patch.workRef;
    const pinned = patch.pinned ?? before.pinned;
    if (pinned && workRef && !before.pinned) db.run("UPDATE actions SET pinned = 0 WHERE ticket_ref = ? AND id <> ?", workRef, id);
    const doneBy = status === 'open' ? null : before.status === status ? before.doneBy : actor;
    const importanceBy = patch.importance !== undefined && patch.importance !== before.importance ? actor : before.importanceBy;
    db.run('UPDATE actions SET text = ?, who = ?, due = ?, status = ?, done_at = ?, importance = ?, pinned = ?, ticket_ref = ?, done_by = ?, importance_by = ? WHERE id = ?',
      patch.text ?? before.text, patch.who === undefined ? before.who : patch.who, patch.due === undefined ? before.due : patch.due, status, doneAt, patch.importance ?? before.importance, pinned ? 1 : 0, workRef, doneBy, importanceBy, id);
    // The person dropping the agent's todo refuses it too, as removing it does (D74).
    if (actor === 'person' && status === 'dropped' && before.status !== 'dropped' && before.source === 'ai' && workRef) refuse(db, workRef, before.text, now);
    if (status === 'done' && before.status !== 'done') {
      // Done leaves a line in the journal of its project, or of its ticket, credited to who did it.
      const project = before.projectId ?? (workRef ? db.get<{ id: string }>('SELECT id FROM projects WHERE upper(ref) = upper(?) ORDER BY updated_at DESC', workRef)?.id ?? null : null);
      addEntry(config, { text: patch.text ?? before.text, kind: 'done', source: actor === 'agent' ? 'ai' : 'person', ...(project ? { project } : {}) }, now);
    }
    return getAction(config, id);
  });
}

/**
 * Remove an action. The person's own goes for good (F2.4-13). The agent's is dropped and remembered as
 * refused on its ticket, so the agent never proposes it again; « Annuler » is `restoreAction` (D74).
 * An agent removes only its own.
 */
export function deleteAction(config: OkbConfig, id: string, actor: Actor = 'person', now = new Date()): { dropped: boolean } {
  const before = getAction(config, id);
  if (actor === 'agent' && before.source !== 'ai') throw new OkbError('E_NOT_APPROVED', 'this todo is the person’s: only they remove it', { key: 'actionPersonOwn' });
  const db = openDb(config);
  if (before.source !== 'ai') { db.run('DELETE FROM actions WHERE id = ?', id); return { dropped: false }; }
  db.tx(() => {
    db.run("UPDATE actions SET status = 'dropped', done_at = ?, done_by = ?, pinned = 0 WHERE id = ?", now.toISOString(), actor, id);
    if (before.workRef) refuse(db, before.workRef, before.text, now);
  });
  return { dropped: true };
}

/** « Annuler »: a removed todo of the agent comes back, and the agent may propose it again (D74). */
export function restoreAction(config: OkbConfig, id: string): Action {
  const before = getAction(config, id);
  if (before.source !== 'ai' || before.status !== 'dropped') throw new OkbError('E_CONFLICT', 'only a removed todo of the agent comes back this way', { key: 'actionNotRemoved' });
  const db = openDb(config);
  db.tx(() => {
    db.run("UPDATE actions SET status = 'open', done_at = NULL, done_by = NULL WHERE id = ?", id);
    if (before.workRef) db.run('DELETE FROM action_refusals WHERE upper(work_ref) = upper(?) AND key = ?', before.workRef, todoKey(before.text));
  });
  return getAction(config, id);
}
