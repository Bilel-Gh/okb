import { randomBytes } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import { enabledModules, type ModuleId } from '../modules/catalog.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';

/**
 * The project (F2.0-03): what the person works on. A subject they create
 * themselves (a course, a mission, the June outing), or what a module brings
 * (with the developer module: a ticket, a repository). It says where it stands
 * in one sentence and what comes next; its actions, journal, notes and
 * documents hang on it. It lives in the operational state, not in the notes.
 */
export type ProjectStatus = 'active' | 'waiting' | 'done';
export type LeftOff = { readonly done: string; readonly tried: string; readonly waiting: string; readonly resume: string; readonly at: string; readonly edited: boolean };
export type Project = {
  readonly id: string;
  /** The module that brings this kind of project: `core` for the person's own subjects. */
  readonly module: ModuleId;
  readonly kind: string;
  readonly title: string;
  readonly status: ProjectStatus;
  /** Where it stands, in one sentence. */
  readonly where: string;
  /** The next step. */
  readonly next: string;
  /** What the module knows it by (a ticket reference, a repository id). */
  readonly ref: string | null;
  /** Where its notes live in the KB, when it has a folder. */
  readonly folder: string | null;
  readonly leftOff: LeftOff | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type Row = { id: string; module: string; kind: string; title: string; status: string; where_line: string; next_step: string; ref: string | null; folder: string | null; left_off: string | null; created_at: string; updated_at: string };
const COLUMNS = 'id, module, kind, title, status, where_line, next_step, ref, folder, left_off, created_at, updated_at';
const fromRow = (r: Row): Project => ({
  id: r.id, module: r.module as ModuleId, kind: r.kind, title: r.title, status: r.status as ProjectStatus, where: r.where_line, next: r.next_step,
  ref: r.ref, folder: r.folder, leftOff: r.left_off ? JSON.parse(r.left_off) as LeftOff : null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').slice(0, 6)}`;

export type ProjectFilter = { readonly status?: ProjectStatus | 'open' | 'all'; readonly kind?: string };

/** The projects of the modules in use, the latest touched first. A module turned off hides its projects; nothing is deleted. */
export async function listProjects(config: OkbConfig, env: NodeJS.ProcessEnv, filter: ProjectFilter = {}): Promise<Project[]> {
  const on = await enabledModules(env);
  const status = filter.status ?? 'open';
  return openDb(config).all<Row>(`SELECT ${COLUMNS} FROM projects ORDER BY updated_at DESC, id`)
    .map(fromRow)
    .filter((p) => on.has(p.module))
    .filter((p) => status === 'all' || (status === 'open' ? p.status !== 'done' : p.status === status))
    .filter((p) => !filter.kind || p.kind === filter.kind);
}

export function getProject(config: OkbConfig, id: string): Project {
  const row = openDb(config).get<Row>(`SELECT ${COLUMNS} FROM projects WHERE id = ?`, id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no project "${id}"`, { key: 'projectUnknown', params: { id } });
  return fromRow(row);
}

export type NewProject = { readonly title: string; readonly where?: string; readonly next?: string; readonly folder?: string };

export function createProject(config: OkbConfig, input: NewProject, now = new Date()): Project {
  assertNoSecrets({ title: input.title, where: input.where ?? '', next: input.next ?? '' }, 'project');
  const id = newId('P');
  const at = now.toISOString();
  openDb(config).run(
    'INSERT INTO projects (id, module, kind, title, status, where_line, next_step, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, 'core', 'subject', input.title, 'active', input.where ?? '', input.next ?? '', input.folder ?? null, at, at,
  );
  return getProject(config, id);
}

export type ProjectPatch = { readonly title?: string; readonly status?: ProjectStatus; readonly where?: string; readonly next?: string; readonly folder?: string | null; readonly leftOff?: LeftOff | null };

export function updateProject(config: OkbConfig, id: string, patch: ProjectPatch, now = new Date()): Project {
  const db = openDb(config);
  return db.tx(() => {
    const before = getProject(config, id);
    assertNoSecrets({ title: patch.title ?? '', where: patch.where ?? '', next: patch.next ?? '' }, 'project');
    db.run(
      'UPDATE projects SET title = ?, status = ?, where_line = ?, next_step = ?, folder = ?, left_off = ?, updated_at = ? WHERE id = ?',
      patch.title ?? before.title, patch.status ?? before.status, patch.where ?? before.where, patch.next ?? before.next,
      patch.folder === undefined ? before.folder : patch.folder,
      patch.leftOff === undefined ? (before.leftOff ? JSON.stringify(before.leftOff) : null) : patch.leftOff ? JSON.stringify(patch.leftOff) : null,
      now.toISOString(), id,
    );
    return getProject(config, id);
  });
}
