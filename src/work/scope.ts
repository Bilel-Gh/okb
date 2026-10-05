import { resolve } from 'node:path';
import YAML from 'yaml';
import { loadConfig, okbHome } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { isInside } from '../kb/registry.js';
import { listRepos, repoForDir, type RepoEntry } from '../repo/registry.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { loadTicket, ticketHere, type TicketRecord } from './tickets.js';
import { ticketRefs, workspaceForDir, type Workspace } from './workspaces.js';

/**
 * The scope: what OKB narrows to while the person works — one repository of a
 * workspace and, when there is one, the ticket in progress. Inside a
 * repository's folder the scope is that repository; at the top of a workspace
 * it is the one the person last named or chose (`okb scope <repo>`, or a
 * message that names a repository or a ticket). Searches rank the scope
 * first, Claude gets its notes at the start of a session, and what is learned
 * goes back to the right place.
 */
export type Scope = {
  readonly workspace: Workspace | null;
  readonly kb: string | null;
  readonly config: OkbConfig | null;
  /**
   * The workspace's KB when the repository has a KB of its own (attached):
   * the shared part (business, features, decisions) comes from there.
   */
  readonly shared: OkbConfig | null;
  readonly repo: RepoEntry | null;
  readonly ticket: TicketRecord | null;
  /** How the repository was chosen: the folder the session runs in, or the person's choice in the workspace. */
  readonly via: 'folder' | 'chosen' | 'none';
};

type Current = { repo: string | null; ticket: string | null; at: string };
type ScopeFile = { current?: Record<string, Current> };

function file(env: NodeJS.ProcessEnv): string {
  return resolve(okbHome(env), 'scope.yaml');
}

async function readFile(env: NodeJS.ProcessEnv): Promise<ScopeFile> {
  const raw = await readTextIfExists(file(env));
  if (!raw) return {};
  try { return (YAML.parse(raw) as ScopeFile | null) ?? {}; } catch { return {}; }
}

export async function readCurrent(workspaceId: string, env: NodeJS.ProcessEnv = process.env): Promise<Current | null> {
  return (await readFile(env)).current?.[workspaceId] ?? null;
}

/** Remember the repository (and ticket) the person works on in a workspace. */
export async function setCurrent(workspaceId: string, value: { repo: string | null; ticket: string | null }, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const data = await readFile(env);
  const current = { ...(data.current ?? {}) };
  if (!value.repo && !value.ticket) delete current[workspaceId];
  else current[workspaceId] = { ...value, at: new Date().toISOString() };
  await writeTextAtomic(file(env), [
    '# The repository and ticket each workspace is narrowed to (okb scope). Local state.',
    YAML.stringify({ current }, { lineWidth: 0 }),
  ].join('\n'));
}

/**
 * The repositories of a workspace: registered in its KB, plus the attached
 * ones — with a KB of their own, inside its folders or listed by `attach`.
 */
export async function workspaceRepos(ws: Workspace, env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry[]> {
  return (await listRepos(env)).filter((r) => r.kb === ws.kb || ws.attached.includes(r.id) || ws.roots.some((root) => isInside(r.path, root)));
}

/** The workspace a repository belongs to: the one whose folder holds it, that lists it, or that uses its KB. */
export async function workspaceOfRepo(repo: RepoEntry, env: NodeJS.ProcessEnv = process.env): Promise<Workspace | null> {
  const byFolder = await workspaceForDir(repo.path, env);
  if (byFolder) return byFolder;
  const { listWorkspaces } = await import('./workspaces.js');
  const list = await listWorkspaces(env);
  return list.find((w) => w.attached.includes(repo.id)) ?? list.find((w) => w.kb === repo.kb) ?? null;
}

async function sharedConfig(workspace: Workspace | null, repo: RepoEntry | null, env: NodeJS.ProcessEnv): Promise<OkbConfig | null> {
  if (!workspace || !repo || workspace.kb === repo.kb) return null;
  return loadConfig({ profileId: workspace.kb, env }).then((r) => r.config, () => null);
}

export async function resolveScope(cwd: string, options: { env?: NodeJS.ProcessEnv; autoStart?: boolean } = {}): Promise<Scope> {
  const env = options.env ?? process.env;
  const here = await repoForDir(cwd, env).catch(() => null);
  if (here) {
    const repo = here.repo;
    const workspace = await workspaceOfRepo(repo, env);
    const config = await loadConfig({ profileId: repo.kb, env }).then((r) => r.config, () => null);
    const ticket = config
      ? await ticketHere(config, repo, (b) => ticketRefs(b, workspace?.tickets ?? null, 'branch'), { autoStart: options.autoStart ?? false }).catch(() => null)
      : null;
    return { workspace, kb: repo.kb, config, shared: await sharedConfig(workspace, repo, env), repo, ticket, via: 'folder' };
  }
  const workspace = await workspaceForDir(cwd, env);
  if (!workspace) return { workspace: null, kb: null, config: null, shared: null, repo: null, ticket: null, via: 'none' };
  const current = await readCurrent(workspace.id, env);
  const repo = current?.repo ? (await workspaceRepos(workspace, env)).find((r) => r.id === current.repo) ?? null : null;
  // An attached repository: its own KB, and the workspace's for the shared part.
  const kb = repo?.kb ?? workspace.kb;
  const config = await loadConfig({ profileId: kb, env }).then((r) => r.config, () => null);
  const ticket = config && current?.ticket ? await loadTicket(config, current.ticket).catch(() => null) : null;
  return { workspace, kb, config, shared: await sharedConfig(workspace, repo, env), repo, ticket, via: repo ? 'chosen' : 'none' };
}

/** The scope for a repository (and ticket) of a workspace, with its KB and, when attached, the workspace's. */
export async function scopeFor(workspace: Workspace | null, repo: RepoEntry | null, ticket: TicketRecord | null, via: Scope['via'], env: NodeJS.ProcessEnv = process.env): Promise<Scope> {
  const kb = repo?.kb ?? workspace?.kb ?? null;
  const config = kb ? await loadConfig({ profileId: kb, env }).then((r) => r.config, () => null) : null;
  return { workspace, kb, config, shared: await sharedConfig(workspace, repo, env), repo, ticket, via };
}

/* ------------------------------------------------- a message names a scope */

/** Repository names too common to be meant as a repository without the word "repo" next to them. */
const COMMON = new Set(['api', 'app', 'web', 'core', 'common', 'docs', 'doc', 'front', 'back', 'ui', 'server', 'client', 'tools', 'utils', 'shared', 'lib', 'libs', 'infra', 'config', 'test', 'tests', 'data', 'model', 'models', 'service', 'services', 'backend', 'frontend', 'mobile', 'admin', 'portal', 'site', 'scripts', 'deploy', 'main', 'base']);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The repositories a message names: their name or id as a whole word ("repo x" for common words). */
export function reposNamed(message: string, repos: readonly RepoEntry[]): RepoEntry[] {
  const text = message.toLowerCase();
  const out: RepoEntry[] = [];
  for (const repo of repos) {
    const names = [...new Set([repo.name.toLowerCase(), repo.id])];
    const hit = names.some((n) => {
      const bare = new RegExp(`(?<![\\w./-])${escape(n)}(?![\\w-])`, 'u');
      const framed = new RegExp(`\\b(?:repo|repos|dépôt|depot|projet|project|module|service|micro-?service)\\s+(?:de |du |d['’]|of |the |le |la )?${escape(n)}(?![\\w-])`, 'u');
      return COMMON.has(n) || n.length < 4 ? framed.test(text) : bare.test(text);
    });
    if (hit) out.push(repo);
  }
  return out;
}

export type MessageScope = {
  readonly repo: RepoEntry;
  readonly ref: string | null;
  /** The ticket, when OKB already follows it. */
  readonly ticket: TicketRecord | null;
  /** The scope changed (it was another repository or ticket). */
  readonly changed: boolean;
};

/**
 * At the top of a workspace, a message that names one repository or a ticket
 * narrows the scope to it ("j'ai le ticket ABC-123 sur orders-service"). A
 * message naming several repositories is a question across them: the scope
 * stays. Inside a repository's folder the folder decides; a ticket OKB
 * does not follow yet is still reported, so Claude can offer to follow it.
 */
export async function scopeFromMessage(message: string, scope: Scope, env: NodeJS.ProcessEnv = process.env): Promise<MessageScope | null> {
  const sample = message.length > 4000 ? message.slice(0, 4000) : message;
  // Inside a repository's folder: only a ticket OKB does not follow yet is worth a word.
  if (scope.via === 'folder' && scope.repo && scope.config) {
    const ref = ticketRefs(sample, scope.workspace?.tickets ?? null, 'message').find((r) => r !== scope.ticket?.ref);
    if (!ref || (await loadTicket(scope.config, ref).catch(() => null))) return null;
    return { repo: scope.repo, ref, ticket: null, changed: false };
  }
  if (!scope.workspace || !scope.config) return null;
  const repos = await workspaceRepos(scope.workspace, env);
  if (!repos.length) return null;
  const refs = ticketRefs(sample, scope.workspace.tickets, 'message');
  const named = reposNamed(sample, repos);
  for (const ref of refs) {
    const ticket = await findTicket(scope.workspace, ref, env);
    if (!ticket) continue;
    const repo = named.find((r) => ticket.repos.some((t) => t.id === r.id)) ?? repos.find((r) => r.id === ticket.repos[0]?.id);
    if (!repo) continue;
    const changed = scope.repo?.id !== repo.id || scope.ticket?.ref !== ticket.ref;
    if (changed) await setCurrent(scope.workspace.id, { repo: repo.id, ticket: ticket.ref }, env);
    return { repo, ref, ticket, changed };
  }
  if (named.length !== 1) return null;
  const repo = named[0]!;
  const ref = refs[0] ?? null;
  const keepTicket = !ref && scope.ticket && scope.ticket.repos.some((t) => t.id === repo.id) ? scope.ticket.ref : null;
  const changed = scope.repo?.id !== repo.id;
  if (changed) await setCurrent(scope.workspace.id, { repo: repo.id, ticket: keepTicket }, env);
  return { repo, ref, ticket: keepTicket ? scope.ticket : null, changed };
}

/** A ticket OKB follows in a workspace: in its KB, or in the KB of one of its attached repositories. */
export async function findTicket(ws: Workspace, ref: string, env: NodeJS.ProcessEnv = process.env): Promise<TicketRecord | null> {
  const kbs = [...new Set([ws.kb, ...(await workspaceRepos(ws, env)).map((r) => r.kb)])];
  for (const kb of kbs) {
    const config = await loadConfig({ profileId: kb, env }).then((r) => r.config, () => null);
    const ticket = config ? await loadTicket(config, ref).catch(() => null) : null;
    if (ticket) return ticket;
  }
  return null;
}

/** Narrow the scope by hand: a repository, a ticket, or nothing (`off`). */
export async function chooseScope(scope: Scope, target: { repo: RepoEntry | null; ticket: TicketRecord | null }, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!scope.workspace) return;
  await setCurrent(scope.workspace.id, { repo: target.repo?.id ?? null, ticket: target.ticket?.ref ?? null }, env);
}

/** Whether `dir` is a workspace's top (or a folder in it that is not a repository). */
export function insideRoots(dir: string, ws: Workspace): boolean {
  return ws.roots.some((r) => isInside(dir, r));
}
