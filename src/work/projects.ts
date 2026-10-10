import type { OkbConfig } from '../config/schema.js';
import type { ProjectSeed } from '../projects/sources.js';
import { listRepos } from '../repo/registry.js';
import { listTickets } from './tickets.js';

/** The developer module's projects: the repositories of this KB and its tickets. */
export async function devProjects(config: OkbConfig, env: NodeJS.ProcessEnv): Promise<ProjectSeed[]> {
  const repos = (await listRepos(env)).filter((r) => r.kb === config.profile.id);
  const tickets = await listTickets(config);
  return [
    ...repos.map((r): ProjectSeed => ({ kind: 'repo', ref: r.id, title: r.name, status: 'active', updatedAt: r.addedAt })),
    ...tickets.map((t): ProjectSeed => ({ kind: 'ticket', ref: t.ref, title: t.title, status: t.status === 'done' ? 'done' : 'active', updatedAt: t.updatedAt })),
  ];
}
