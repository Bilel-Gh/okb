import { readdir } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { isFlat, type RepoPlace } from '../repo/pack.js';
import { listRepos, type RepoEntry } from '../repo/registry.js';
import { repoFolderIn, safeName } from './address.js';
import { drawerFolder, layoutOf, pickName, subName, UNSORTED_SUBJECT, type BrainLayout } from './layout.js';

/**
 * Products (projects, topics…) of a brain and the repositories in each. The
 * folders are the truth: `2 Produits/<product>/Code/<repo>/`. The repository
 * list (`~/.okb/repos.yaml`) remembers the product chosen for a repository
 * that has no note yet.
 */
export type ProductInfo = {
  readonly name: string;
  readonly folder: string;
  readonly repos: readonly { readonly id: string; readonly name: string; readonly folder: string | null }[];
  /** True when the product has a folder in the brain. */
  readonly exists: boolean;
};

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Repository folders that exist in the brain, keyed by repository folder name. */
export async function repoFolders(config: OkbConfig, layout: BrainLayout): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const subjects = drawerFolder(layout, 'subjects');
  const code = subName(layout, 'code');
  for (const product of await dirs(resolve(config.kb.root, subjects))) {
    for (const repo of await dirs(resolve(config.kb.root, subjects, product, code))) {
      out.set(repo, posix.join(subjects, product, code, repo));
    }
  }
  return out;
}

/** The folder name of a repository in a brain: its own name, made safe. */
export function repoDisplay(repo: Pick<RepoEntry, 'name' | 'id'>): string {
  return safeName(repo.name) || repo.id;
}

/** Where a repository's notes go in this KB (see src/repo/pack.ts). */
export async function repoPlace(config: OkbConfig, repo: Pick<RepoEntry, 'name' | 'id' | 'product'>): Promise<RepoPlace> {
  const layout = layoutOf(config);
  if (!layout) return isFlat(config);
  const name = repoDisplay(repo);
  const found = (await repoFolders(config, layout)).get(name) ?? (await repoFolders(config, layout)).get(repo.id);
  const folder = found ?? repoFolderIn(layout, repo.product, name);
  return { folder, name: posix.basename(folder), lang: layout.lang, tickets: subName(layout, 'tickets') };
}

/** The product a repository is in: its folder first, then the registered choice. */
export async function productOfRepo(config: OkbConfig, repo: Pick<RepoEntry, 'name' | 'id' | 'product'>): Promise<string | null> {
  const layout = layoutOf(config);
  if (!layout) return null;
  const folders = await repoFolders(config, layout);
  const folder = folders.get(repoDisplay(repo)) ?? folders.get(repo.id);
  if (folder) return folder.split('/')[1] ?? null;
  return repo.product ?? null;
}

/** Every product of the brain: folders, plus products chosen for registered repositories without notes yet. */
export async function listProducts(config: OkbConfig, env: NodeJS.ProcessEnv = process.env): Promise<ProductInfo[]> {
  const layout = layoutOf(config);
  if (!layout) return [];
  const subjects = drawerFolder(layout, 'subjects');
  const code = subName(layout, 'code');
  const byName = new Map<string, { folder: string; exists: boolean; repos: Map<string, { id: string; name: string; folder: string | null }> }>();
  for (const product of await dirs(resolve(config.kb.root, subjects))) {
    const entry = { folder: posix.join(subjects, product), exists: true, repos: new Map<string, { id: string; name: string; folder: string | null }>() };
    for (const repo of await dirs(resolve(config.kb.root, subjects, product, code))) entry.repos.set(repo, { id: repo, name: repo, folder: posix.join(subjects, product, code, repo) });
    byName.set(product, entry);
  }
  const unsorted = pickName(UNSORTED_SUBJECT, layout.lang);
  for (const r of (await listRepos(env)).filter((x) => x.kb === config.profile.id)) {
    const display = repoDisplay(r);
    const homes = [...byName.entries()].filter(([, p]) => p.repos.has(display));
    if (homes.length) {
      // The same name in two products: the registered repository belongs to its own product only.
      const mine = homes.filter(([name]) => r.product && safeName(r.product) === name);
      for (const [, p] of mine.length ? mine : homes.slice(0, 1)) p.repos.set(display, { ...p.repos.get(display)!, id: r.id, name: r.name });
      continue;
    }
    const product = safeName(r.product ?? '') || unsorted;
    const entry = byName.get(product) ?? { folder: posix.join(subjects, product), exists: false, repos: new Map() };
    entry.repos.set(display, { id: r.id, name: r.name, folder: null });
    byName.set(product, entry);
  }
  return [...byName.entries()].map(([name, e]) => ({ name, folder: e.folder, exists: e.exists, repos: [...e.repos.values()] })).sort((a, b) => a.name.localeCompare(b.name));
}
