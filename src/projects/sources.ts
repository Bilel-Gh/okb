import type { OkbConfig } from '../config/schema.js';
import { enabledModules, type ModuleId } from '../modules/catalog.js';
import { openDb } from '../state/db.js';
import { newId, type ProjectStatus } from './projects.js';

/**
 * What a module brings as projects (F2.0-25): the core does not know tickets
 * or repositories; a module registers a source, the engine's registry wires it
 * (src/engine/registry.ts), and the projects are kept in step with it.
 */
export type ProjectSeed = { readonly kind: string; readonly ref: string; readonly title: string; readonly status: 'active' | 'done'; readonly folder?: string | null; readonly updatedAt?: string };
export type ProjectSource = (config: OkbConfig, env: NodeJS.ProcessEnv) => Promise<readonly ProjectSeed[]>;

const SOURCES = new Map<ModuleId, ProjectSource>();

export function registerProjectSource(module: ModuleId, source: ProjectSource): void {
  SOURCES.set(module, source);
}

/**
 * Bring the projects of the modules in use up to date: a new ticket or
 * repository becomes a project, a finished ticket closes its project, a title
 * follows. What the person wrote (where it stands, the next step) is kept.
 */
export async function syncProjects(config: OkbConfig, env: NodeJS.ProcessEnv, now = new Date()): Promise<void> {
  const on = await enabledModules(env);
  const seeds: (ProjectSeed & { module: ModuleId })[] = [];
  for (const [module, source] of SOURCES) {
    if (!on.has(module)) continue;
    for (const seed of await source(config, env).catch(() => [])) seeds.push({ ...seed, module });
  }
  if (!seeds.length) return;
  const db = openDb(config);
  db.tx(() => {
    for (const seed of seeds) {
      const row = db.get<{ id: string; title: string; status: ProjectStatus }>('SELECT id, title, status FROM projects WHERE kind = ? AND ref = ?', seed.kind, seed.ref);
      const at = seed.updatedAt ?? now.toISOString();
      if (!row) {
        db.run('INSERT INTO projects (id, module, kind, title, status, ref, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId('P'), seed.module, seed.kind, seed.title, seed.status, seed.ref, seed.folder ?? null, at, at);
        continue;
      }
      // The module decides done or not; « waiting » is the person's own word while it is open.
      const status: ProjectStatus = seed.status === 'done' ? 'done' : row.status === 'done' ? 'active' : row.status;
      if (row.title !== seed.title || row.status !== status) db.run('UPDATE projects SET title = ?, status = ?, updated_at = ? WHERE id = ?', seed.title, status, now.toISOString(), row.id);
    }
  });
}
