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
};

type Row = { id: string; project_id: string | null; text: string; kind: string; who: string | null; due: string | null; status: string; source: string; created_at: string; done_at: string | null; ticket_ref: string | null; importance: string; pinned: number };
const COLUMNS = 'id, project_id, text, kind, who, due, status, source, created_at, done_at, ticket_ref, importance, pinned';
const fromRow = (r: Row): Action => ({ id: r.id, projectId: r.project_id, text: r.text, kind: r.kind as ActionKind, who: r.who, due: r.due, status: r.status as ActionStatus, source: r.source as Action['source'], createdAt: r.created_at, doneAt: r.done_at, workRef: r.ticket_ref, importance: r.importance as Importance, pinned: Boolean(r.pinned) });
function checkImportance(i: string | undefined): void {
  if (i !== undefined && !(IMPORTANCES as readonly string[]).includes(i)) throw new OkbError('E_INVALID', `importance must be one of ${IMPORTANCES.join(', ')}`, { key: 'actionImportance' });
}

export function getAction(config: OkbConfig, id: string): Action {
  const row = openDb(config).get<Row>(`SELECT ${COLUMNS} FROM actions WHERE id = ?`, id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no action "${id}"`, { key: 'actionUnknown', params: { id } });
  return fromRow(row);
}

export type NewAction = { readonly text: string; readonly kind?: ActionKind; readonly project?: string; readonly who?: string; readonly due?: string; readonly source?: 'person' | 'ai'; readonly workRef?: string; readonly importance?: Importance; readonly pinned?: boolean };

export function addAction(config: OkbConfig, input: NewAction, now = new Date()): Action {
  assertNoSecrets({ text: input.text, who: input.who ?? '' }, 'action');
  checkImportance(input.importance);
  const project = input.project ? getProject(config, input.project) : null;
  const id = newId('A');
  const db = openDb(config);
  db.tx(() => {
    if (input.pinned && input.workRef) db.run("UPDATE actions SET pinned = 0 WHERE ticket_ref = ? AND status = 'open'", input.workRef);
    db.run('INSERT INTO actions (id, project_id, text, kind, who, due, status, source, created_at, ticket_ref, importance, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, project?.id ?? null, input.text, input.kind ?? 'todo', input.who ?? null, input.due ?? null, 'open', input.source ?? 'person', now.toISOString(), input.workRef ?? null, input.importance ?? 'medium', input.pinned ? 1 : 0);
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

/** Change an action. Doing it leaves a line in the journal of its project. */
export function updateAction(config: OkbConfig, id: string, patch: ActionPatch, now = new Date()): Action {
  const db = openDb(config);
  return db.tx(() => {
    const before = getAction(config, id);
    assertNoSecrets({ text: patch.text ?? '', who: patch.who ?? '' }, 'action');
    checkImportance(patch.importance);
    if (patch.text !== undefined && !patch.text.trim()) throw new OkbError('E_INVALID', 'an action needs a text', { key: 'actionEmpty' });
    const status = patch.status ?? before.status;
    const doneAt = status === 'open' ? null : before.status === status ? before.doneAt : now.toISOString();
    const workRef = patch.workRef === undefined ? before.workRef : patch.workRef;
    const pinned = patch.pinned ?? before.pinned;
    if (pinned && workRef && !before.pinned) db.run("UPDATE actions SET pinned = 0 WHERE ticket_ref = ? AND id <> ?", workRef, id);
    db.run('UPDATE actions SET text = ?, who = ?, due = ?, status = ?, done_at = ?, importance = ?, pinned = ?, ticket_ref = ? WHERE id = ?',
      patch.text ?? before.text, patch.who === undefined ? before.who : patch.who, patch.due === undefined ? before.due : patch.due, status, doneAt, patch.importance ?? before.importance, pinned ? 1 : 0, workRef, id);
    if (status === 'done' && before.status !== 'done') addEntry(config, { text: patch.text ?? before.text, kind: 'done', ...(before.projectId ? { project: before.projectId } : {}) }, now);
    return getAction(config, id);
  });
}

/** Remove an action for good: the person changed their mind (F2.4-13). */
export function deleteAction(config: OkbConfig, id: string): void {
  getAction(config, id);
  openDb(config).run('DELETE FROM actions WHERE id = ?', id);
}
