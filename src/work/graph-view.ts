import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { isFlat } from '../repo/pack.js';
import { listRepos, type RepoEntry } from '../repo/registry.js';
import { kbEdges, workspaceEdges } from './brief.js';
import { kindOf } from './kinds.js';
import { noteRepo, tiedNotes } from './rank.js';
import { readCurrent, workspaceRepos } from './scope.js';
import { listTickets, ticketNoteIn } from './tickets.js';
import { listWorkspaces } from './workspaces.js';

/**
 * What the web graph needs to draw a workspace KB from above: its
 * repositories (notes, own KB when attached), how their code connects, the
 * scope (the repository in focus, the shared notes tied to it, its
 * neighbours) and the tickets followed. Null for a KB that is not a workspace.
 */
export type WorkspaceGraph = {
  readonly id: string | null;
  readonly name: string;
  readonly repos: readonly { readonly id: string; readonly name: string; readonly area: string; readonly notes: number; readonly ownKb: string | null }[];
  readonly edges: readonly { readonly from: string; readonly to: string; readonly label: string }[];
  readonly scope: { readonly repo: string | null; readonly ticket: string | null; readonly tied: readonly string[]; readonly neighbours: readonly string[] };
  readonly tickets: readonly { readonly ref: string; readonly title: string; readonly status: string; readonly repos: readonly string[]; readonly note: string | null }[];
};

export async function workspaceGraph(config: OkbConfig, bundle: Bundle, focus?: string | null): Promise<WorkspaceGraph | null> {
  if (isFlat(config) || (await kindOf(config.profile.id, config)) !== 'workspace') return null;
  const ws = (await listWorkspaces()).find((w) => w.kb === config.profile.id) ?? null;
  const repos: RepoEntry[] = ws ? await workspaceRepos(ws) : (await listRepos()).filter((r) => r.kb === config.profile.id);
  if (!repos.length) return null;
  const counts = new Map<string, number>();
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved) continue;
    const owner = noteRepo(bundle, path);
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const edges = await (ws ? workspaceEdges(ws) : kbEdges(config)).catch(() => []);
  const current = ws ? await readCurrent(ws.id) : null;
  const scopeRepo = repos.find((r) => r.id === (focus ?? current?.repo)) ?? null;
  const tied = scopeRepo ? [...tiedNotes(bundle, scopeRepo).keys()] : [];
  const neighbours = scopeRepo ? [...new Set(edges.flatMap((e) => (e.from === scopeRepo.id ? [e.to] : e.to === scopeRepo.id ? [e.from] : [])))] : [];
  const tickets = (await listTickets(config)).filter((t) => t.status === 'active' || Date.now() - Date.parse(t.updatedAt) < 30 * 86_400_000).slice(0, 30);
  return {
    id: ws?.id ?? null,
    name: ws?.name ?? (config.profile.displayName || config.profile.id),
    repos: repos.map((r) => ({ id: r.id, name: r.name, area: `repos/${r.id}`, notes: counts.get(r.id) ?? 0, ownKb: r.kb !== config.profile.id ? r.kb : null })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    scope: { repo: scopeRepo?.id ?? null, ticket: focus ? null : current?.ticket ?? null, tied, neighbours },
    tickets: tickets.map((t) => ({ ref: t.ref, title: t.title, status: t.status, repos: t.repos.map((r) => r.id), note: ticketNoteIn(bundle, t) })),
  };
}
