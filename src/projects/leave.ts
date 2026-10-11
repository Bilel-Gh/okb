import type { OkbConfig } from '../config/schema.js';
import { listActions } from './actions.js';
import { addEntry, listEntries } from './journal.js';
import { getProject, updateProject, type LeftOff, type Project } from './projects.js';

/**
 * « Où j'en étais » (F2.0-07): when the person leaves a project, OKB prepares
 * where they were from what happened since the last time: what was done, what
 * was tried, what they wait for, and where to pick up. No AI: it reads the
 * project's journal and actions. The person corrects a line if they wish.
 */
export type LeftOffEdit = { readonly done?: string; readonly tried?: string; readonly waiting?: string; readonly resume?: string };

const join = (texts: readonly string[]) => [...new Set(texts.map((t) => t.trim()).filter(Boolean))].join(' ; ');

export async function leaveProject(config: OkbConfig, env: NodeJS.ProcessEnv, id: string, edit: LeftOffEdit = {}, now = new Date()): Promise<Project> {
  const project = getProject(config, id);
  const edited = Object.values(edit).some((v) => v !== undefined);
  if (edited && project.leftOff) {
    // A correction keeps what was prepared and changes the lines the person rewrote.
    const leftOff: LeftOff = { ...project.leftOff, ...Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined)), edited: true } as LeftOff;
    return updateProject(config, id, { leftOff }, now);
  }
  const since = project.leftOff?.at ?? '';
  const entries = await listEntries(config, env, { project: id, ...(since ? { since } : {}), limit: 500 });
  const open = await listActions(config, env, { project: id });
  const leftOff: LeftOff = {
    done: edit.done ?? join(entries.filter((e) => e.kind === 'done' || e.kind === 'commit').map((e) => e.text).reverse()),
    tried: edit.tried ?? join(entries.filter((e) => e.kind === 'tried' || e.kind === 'trap').map((e) => e.text).reverse()),
    waiting: edit.waiting ?? join(open.filter((a) => a.kind === 'waiting').map((a) => (a.who ? `${a.text} (${a.who})` : a.text))),
    resume: edit.resume ?? (project.next || open.find((a) => a.kind === 'todo')?.text || ''),
    at: now.toISOString(),
    edited,
  };
  const saved = updateProject(config, id, { leftOff }, now);
  addEntry(config, { text: leftOff.resume || project.title, kind: 'resume', project: id }, now);
  return saved;
}
