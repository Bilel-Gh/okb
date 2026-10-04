import { realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import YAML from 'yaml';
import { okbHome } from '../config/load.js';
import { isInside } from '../kb/registry.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { gitIdentity, gitRoot } from './git.js';

/**
 * Code repositories a person documents with OKB, and the KB each one lives in.
 * The list sits beside the KB list (`~/.okb/repos.yaml`), not in a KB: it holds
 * local paths, which belong to this machine, not to the knowledge.
 */
export type RepoEntry = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly remote: string | null;
  /** The OKB KB (profile id) whose `repos/<id>/` folder holds this repository's notes. */
  readonly kb: string;
  readonly addedAt: string;
};

type RepoFile = { repos?: RepoEntry[] };

function file(env: NodeJS.ProcessEnv): string {
  return resolve(okbHome(env), 'repos.yaml');
}

export async function listRepos(env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry[]> {
  const raw = await readTextIfExists(file(env));
  if (!raw) return [];
  try {
    const data = (YAML.parse(raw) as RepoFile | null) ?? {};
    return (Array.isArray(data.repos) ? data.repos : []).filter((r) => r && typeof r.id === 'string' && typeof r.path === 'string' && typeof r.kb === 'string');
  } catch (cause) {
    throw new OkbError('E_CONFIG', 'cannot read the list of repositories (~/.okb/repos.yaml)', { cause });
  }
}

async function save(repos: readonly RepoEntry[], env: NodeJS.ProcessEnv): Promise<void> {
  await writeTextAtomic(file(env), [
    '# Code repositories documented with OKB, and the KB that holds each one\'s notes.',
    '# Local paths: this file stays on this machine.',
    YAML.stringify({ repos }, { lineWidth: 0 }),
  ].join('\n'));
}

/** "Catalog Service.git" → "catalog-service". */
export function repoSlug(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'repo';
}

/** The repository's own name: the remote's last segment, else the folder name. */
export function repoNameFrom(root: string, remote: string | null): string {
  const fromRemote = remote?.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '');
  return fromRemote || basename(root);
}

/**
 * The registered repository containing `dir`: by path first (deepest match),
 * then by remote, so a fresh clone in another folder still finds its notes.
 */
export async function repoForDir(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ repo: RepoEntry; moved: boolean } | null> {
  const repos = await listRepos(env);
  if (!repos.length) return null;
  // Git reports physical paths (/private/var…): compare physical paths too.
  const target = await realpath(resolve(dir)).catch(() => resolve(dir));
  const byPath = repos.filter((r) => isInside(target, r.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (byPath) return { repo: byPath, moved: false };
  const root = await gitRoot(target);
  if (!root) return null;
  const { remote } = await gitIdentity(root);
  if (!remote) return null;
  const byRemote = repos.find((r) => r.remote && sameRemote(r.remote, remote));
  return byRemote ? { repo: { ...byRemote, path: root }, moved: true } : null;
}

/** `git@host:org/x.git` and `https://host/org/x` name the same repository. */
export function sameRemote(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().toLowerCase()
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^[^@/]+@/, '')
    .replace(':', '/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return norm(a) === norm(b);
}

export async function findRepo(idOrPath: string, env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry | null> {
  const repos = await listRepos(env);
  const byId = repos.find((r) => r.id === idOrPath || r.name === idOrPath);
  if (byId) return byId;
  const found = await repoForDir(idOrPath, env).catch(() => null);
  return found?.repo ?? null;
}

export type AddRepoInput = { readonly path: string; readonly kb: string; readonly name?: string; readonly id?: string };

/** Register a repository (or move an existing registration to a new path or KB). */
export async function addRepo(input: AddRepoInput, env: NodeJS.ProcessEnv = process.env): Promise<{ repo: RepoEntry; created: boolean }> {
  const given = resolve(input.path);
  const isDir = await stat(given).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new OkbError('E_NOT_FOUND', `not a folder: ${given}`, { key: 'repoNotFolder', params: { path: given } });
  const abs = await realpath(given);
  const root = (await gitRoot(abs)) ?? abs;
  const identity = await gitIdentity(root);
  const repos = await listRepos(env);
  const existing = repos.find((r) => resolve(r.path) === root) ?? (identity.remote ? repos.find((r) => r.remote && sameRemote(r.remote, identity.remote!)) : undefined);
  const name = input.name?.trim() || existing?.name || repoNameFrom(root, identity.remote);
  let id = input.id ?? existing?.id ?? repoSlug(name);
  if (!existing) {
    const taken = new Set(repos.map((r) => r.id));
    for (let n = 2; taken.has(id); n++) id = `${repoSlug(name)}-${n}`;
  }
  const repo: RepoEntry = { id, name, path: root, remote: identity.remote, kb: input.kb, addedAt: existing?.addedAt ?? new Date().toISOString() };
  await save([...repos.filter((r) => r !== existing), repo].sort((a, b) => a.id.localeCompare(b.id)), env);
  return { repo, created: !existing };
}

/** Forget a repository. Its notes and its private scan state stay where they are. */
export async function removeRepo(id: string, env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry> {
  const repos = await listRepos(env);
  const found = repos.find((r) => r.id === id);
  if (!found) throw new OkbError('E_NOT_FOUND', `repository "${id}" is not registered`, { key: 'repoUnknown', params: { id } });
  await save(repos.filter((r) => r !== found), env);
  return found;
}
