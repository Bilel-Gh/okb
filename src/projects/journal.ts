import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { localDay } from '../util/day.js';
import { getProject, listProjects, newId, type Project } from './projects.js';
import { moduleEvents } from './sources.js';

/**
 * The journal (F2.0-05): what happened, day by day and project by project. The
 * person's own lines and what OKB notes for them (an action done, a project
 * left) live in the operational state; a module adds what it knows of its
 * projects (with the developer module: a ticket's decisions and commits).
 */
export const ENTRY_KINDS = ['note', 'decision', 'done', 'tried', 'meeting', 'ai', 'resume', 'commit', 'trap', 'question'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type Entry = {
  readonly id: string;
  readonly projectId: string | null;
  readonly project: { readonly id: string; readonly title: string } | null;
  readonly at: string;
  readonly day: string;
  readonly kind: EntryKind;
  readonly text: string;
  readonly source: 'person' | 'ai' | 'module';
};

type Row = { id: string; project_id: string | null; at: string; day: string; kind: string; text: string; source: string };

export type NewEntry = { readonly text: string; readonly kind?: EntryKind; readonly project?: string; readonly source?: 'person' | 'ai' };

export function addEntry(config: OkbConfig, input: NewEntry, now = new Date()): Entry {
  assertNoSecrets({ text: input.text }, 'journal');
  const project = input.project ? getProject(config, input.project) : null;
  const id = newId('J');
  const at = now.toISOString();
  const day = localDay(now);
  openDb(config).run('INSERT INTO journal (id, project_id, at, day, kind, text, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, project?.id ?? null, at, day, input.kind ?? 'note', input.text, input.source ?? 'person');
  return { id, projectId: project?.id ?? null, project: project ? { id: project.id, title: project.title } : null, at, day, kind: input.kind ?? 'note', text: input.text, source: input.source ?? 'person' };
}

export type EntryFilter = { readonly project?: string; readonly day?: string; readonly since?: string; readonly limit?: number };

/** The entries, the latest first: of one project, of one day, or since a moment. A module turned off hides its projects' lines. */
export async function listEntries(config: OkbConfig, env: NodeJS.ProcessEnv, filter: EntryFilter = {}): Promise<Entry[]> {
  const projects = await listProjects(config, env, { status: 'all' });
  const byId = new Map(projects.map((p) => [p.id, p]));
  const wanted: Project[] = filter.project ? [getProject(config, filter.project)].filter((p) => byId.has(p.id)) : projects;
  const rows = openDb(config).all<Row & { n: number }>('SELECT rowid AS n, id, project_id, at, day, kind, text, source FROM journal ORDER BY at DESC, rowid DESC');
  const own: (Entry & { order: number })[] = rows
    .filter((r) => (filter.project ? r.project_id === filter.project : r.project_id === null || byId.has(r.project_id)))
    .map((r) => {
      const p = r.project_id ? byId.get(r.project_id) : undefined;
      return { id: r.id, projectId: r.project_id, project: p ? { id: p.id, title: p.title } : null, at: r.at, day: r.day, kind: r.kind as EntryKind, text: r.text, source: r.source as Entry['source'], order: r.n };
    });
  const fromModules: (Entry & { order: number })[] = (await moduleEvents(config, env, wanted)).map((e, i) => ({
    id: `M-${e.project.id}-${i}`, projectId: e.project.id, project: { id: e.project.id, title: e.project.title }, at: e.at, day: localDay(new Date(e.at)), kind: e.kind, text: e.text, source: 'module' as const, order: -1,
  }));
  return [...own, ...fromModules]
    .filter((e) => (!filter.day || e.day === filter.day) && (!filter.since || e.at > filter.since))
    .sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order)
    .slice(0, filter.limit ?? 200)
    .map(({ order: _order, ...e }) => e);
}
