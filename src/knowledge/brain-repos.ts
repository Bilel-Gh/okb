import { layoutOf } from '../brain/layout.js';
import { listProducts, repoDisplay } from '../brain/products.js';
import type { OkbConfig } from '../config/schema.js';
import { addRepo, listRepos, type RepoEntry } from '../repo/registry.js';
import { OkbError } from '../util/errors.js';

/**
 * The repositories of a brain: the `Code/<repo>` folders of its products, and
 * the repositories registered on this computer for it. A brain received from a
 * colleague, or the demo, has repository folders that are not linked to any code
 * here: they are listed too, with `linked: false`, so nothing seems to vanish.
 */
export type BrainRepo = {
  readonly id: string;
  readonly name: string;
  readonly product: string;
  /** Its folder in the brain, or null while it has no note yet. */
  readonly folder: string | null;
  /** Registered on this computer for this KB (its code can be read). */
  readonly linked: boolean;
  readonly path: string | null;
};

export async function brainRepos(config: OkbConfig, env: NodeJS.ProcessEnv = process.env): Promise<BrainRepo[]> {
  if (!layoutOf(config)) return [];
  const registered = (await listRepos(env)).filter((r) => r.kb === config.profile.id);
  const byName = new Map<string, RepoEntry>();
  for (const r of registered) { byName.set(repoDisplay(r), r); byName.set(r.id, r); }
  const out: BrainRepo[] = [];
  const seen = new Set<string>();
  for (const product of await listProducts(config, env)) {
    for (const r of product.repos) {
      const entry = byName.get(r.name) ?? byName.get(r.id);
      const key = entry?.id ?? `folder:${r.folder ?? r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: entry?.id ?? r.id, name: entry?.name ?? r.name, product: product.name, folder: r.folder, linked: Boolean(entry), path: entry?.path ?? null });
    }
  }
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.name.localeCompare(b.name));
}

/** Link a folder of code to one of the brain's repositories (like `okb repo add <path> --product <product>`). */
export async function linkBrainRepo(config: OkbConfig, folder: string, codePath: string, env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry> {
  const repo = (await brainRepos(config, env)).find((r) => r.folder === folder);
  if (!repo) throw new OkbError('E_NOT_FOUND', `no repository folder ${folder} in this brain`, { key: 'repoUnknown', params: { id: folder } });
  return (await addRepo({ path: codePath, kb: config.profile.id, name: repo.name, product: repo.product }, env)).repo;
}
