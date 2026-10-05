import { loadConfig } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { ask, type AskResult } from '../pipeline/ask.js';
import { findRepo, type RepoEntry } from '../repo/registry.js';
import { neighboursOf } from './brief.js';
import { scopeRank, type ScopeRank } from './rank.js';
import { resolveScope, workspaceOfRepo } from './scope.js';
import type { Workspace } from './workspaces.js';

/**
 * The scope a search runs in: the repository named with `--repo`, else the
 * one the current folder or the workspace is narrowed to — when it belongs
 * to the KB being searched.
 */
export async function askScope(config: OkbConfig, wanted?: string): Promise<{ repo: RepoEntry; ticket: string | null; rank: ScopeRank; bundle: Bundle } | null> {
  const found = await scopeRepo(wanted);
  if (!found || found.repo.kb !== config.profile.id) return null;
  const bundle = await loadBundleFor(config);
  return { repo: found.repo, ticket: found.ticket, bundle, rank: scopeRank(bundle, found.repo, await neighboursOf(config, found.repo.id, found.workspace)) };
}

async function scopeRepo(wanted?: string): Promise<{ repo: RepoEntry; ticket: string | null; workspace: Workspace | null } | null> {
  if (wanted) {
    const repo = await findRepo(wanted);
    return repo ? { repo, ticket: null, workspace: await workspaceOfRepo(repo) } : null;
  }
  const scope = await resolveScope(process.cwd()).catch(() => null);
  return scope?.repo ? { repo: scope.repo, ticket: scope.ticket?.ref ?? null, workspace: scope.workspace } : null;
}

export type ScopedHit = AskResult['hits'][number] & { readonly kb: string; readonly root: string };
export type ScopedAsk = {
  readonly result: Omit<AskResult, 'hits'> & { readonly hits: readonly ScopedHit[] };
  readonly scope: { readonly repo: string; readonly name: string; readonly ticket: string | null; readonly sharedKb: string | null } | null;
};

/**
 * A search in the scope. A repository of the searched KB: its notes and the
 * shared notes tied to it first. A repository with its own KB in a workspace
 * (attached): its KB first, then the workspace's KB for the shared part, one
 * merged list. `everywhere` drops the ranking but keeps both KBs.
 */
export async function scopedAsk(config: OkbConfig, query: string, options: { limit?: number; cursor?: string; repo?: string; everywhere?: boolean } = {}): Promise<ScopedAsk> {
  const tag = (cfg: OkbConfig, hits: AskResult['hits']): ScopedHit[] => hits.map((h) => ({ ...h, kb: cfg.profile.id, root: cfg.kb.root }));
  const paging = { ...(options.limit !== undefined ? { limit: options.limit } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) };
  const found = await scopeRepo(options.repo).catch(() => null);
  const ws = found?.workspace ?? null;
  const attached = Boolean(found && ws && found.repo.kb !== ws.kb && (config.profile.id === found.repo.kb || config.profile.id === ws.kb));
  if (!found || (!attached && found.repo.kb !== config.profile.id)) {
    const result = await ask(config, query, paging);
    return { result: { ...result, hits: tag(config, result.hits) }, scope: null };
  }
  const repo = found.repo;
  if (!attached) {
    const bundle = await loadBundleFor(config);
    const rank = options.everywhere ? undefined : scopeRank(bundle, repo, await neighboursOf(config, repo.id, ws));
    const result = await ask(config, query, { ...paging, bundle, ...(rank ? { scope: rank } : {}) });
    return { result: { ...result, hits: tag(config, result.hits) }, scope: options.everywhere ? null : { repo: repo.id, name: repo.name, ticket: found.ticket, sharedKb: null } };
  }
  // Attached: the repository's own KB, then the workspace's shared part.
  const own = config.profile.id === repo.kb ? config : (await loadConfig({ profileId: repo.kb })).config;
  const shared = config.profile.id === ws!.kb ? config : (await loadConfig({ profileId: ws!.kb })).config;
  const limit = options.limit ?? config.context.pageSize;
  const ownResult = await ask(own, query, { limit });
  const sharedBundle = await loadBundleFor(shared);
  const rank = options.everywhere ? undefined : scopeRank(sharedBundle, repo, await neighboursOf(shared, repo.id, ws));
  const sharedResult = await ask(shared, query, { limit, bundle: sharedBundle, ...(rank ? { scope: rank } : {}) });
  const lift = (h: AskResult['hits'][number]) => (options.everywhere ? h : { ...h, score: Number((h.score * 1.6 + 6).toFixed(2)), why: ['scope:repo', ...h.why] });
  const hits = [...tag(own, ownResult.hits.map(lift)), ...tag(shared, sharedResult.hits)]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
  const kept = new Set(hits.map((h) => `${h.kb}:${h.path}`));
  return {
    result: {
      query,
      hits,
      evidence: [...ownResult.evidence.map((e) => ({ ...e, kb: own.profile.id })), ...sharedResult.evidence.map((e) => ({ ...e, kb: shared.profile.id }))].filter((e) => kept.has(`${e.kb}:${e.path}`)),
      prerequisites: [...ownResult.prerequisites, ...sharedResult.prerequisites].slice(0, 6),
      truncation: { ...ownResult.truncation, truncated: ownResult.truncation.truncated || sharedResult.truncation.truncated, nextCursor: null },
      notes: [...new Set([...ownResult.notes, ...sharedResult.notes])],
    },
    scope: options.everywhere ? null : { repo: repo.id, name: repo.name, ticket: found.ticket, sharedKb: shared.profile.id },
  };
}
