import { posix } from 'node:path';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { drawerLabel, drawerOfFolder, subName, type BrainLayout, type DrawerId } from './layout.js';

/**
 * Where a note sits in a brain, read back from its path: its drawer, the
 * subjects above it (product, repository, theme) and the hub pages of those
 * subjects. The path is the truth: a note moved by hand is read where it is.
 */
export type Position = {
  readonly path: BundlePath;
  readonly drawer: DrawerId | null;
  readonly product: string | null;
  readonly repo: string | null;
  readonly theme: string | null;
  /** Folders between the drawer and the note, as people read them. */
  readonly crumbs: readonly string[];
  /** Hub pages above the note, nearest last (a hub page is `<folder>/<folder>.md`). */
  readonly ancestors: readonly BundlePath[];
  /** True when the note is the hub of its own folder. */
  readonly isHub: boolean;
};

/** The hub page of a folder: `2 Produits/Produit A` → `2 Produits/Produit A/Produit A.md`. */
export function hubOf(folder: string): BundlePath | null {
  if (!folder || folder === '.') return null;
  // A drawer's page drops its number: `1 Écosystème/Écosystème.md`.
  const name = folder.includes('/') ? posix.basename(folder) : folder.replace(/^\d+ /, '');
  return asBundlePath(`${folder}/${name}.md`);
}

/** The subject folders above a note that have (or should have) a hub page: drawer, theme, product, repository. */
export function subjectFoldersOf(layout: BrainLayout, path: string): { folder: string; kind: 'drawer' | 'domain' | 'product' | 'repo'; title: string }[] {
  const pos = positionOf(layout, path);
  if (!pos.drawer) return [];
  const parts = asBundlePath(path).split('/');
  const out: { folder: string; kind: 'drawer' | 'domain' | 'product' | 'repo'; title: string }[] = [
    { folder: parts[0]!, kind: 'drawer', title: drawerLabel(layout, pos.drawer) },
  ];
  if (pos.theme) out.push({ folder: parts.slice(0, 3).join('/'), kind: 'domain', title: pos.theme });
  if (pos.product) out.push({ folder: parts.slice(0, 2).join('/'), kind: 'product', title: pos.product });
  if (pos.repo) out.push({ folder: parts.slice(0, 4).join('/'), kind: 'repo', title: pos.repo });
  // A note that is itself the hub of a folder does not need that folder's hub.
  return out.filter((f) => hubOf(f.folder) !== pos.path);
}

export function positionOf(layout: BrainLayout, path: string): Position {
  const p = asBundlePath(path);
  const parts = p.split('/');
  const file = parts.pop()!;
  const drawer = parts.length ? drawerOfFolder(layout, parts[0]!) : null;
  let product: string | null = null;
  let repo: string | null = null;
  let theme: string | null = null;
  if (drawer === 'subjects' && parts.length >= 2) {
    product = parts[1]!;
    if (parts[2] === subName(layout, 'code') && parts.length >= 4) repo = parts[3]!;
  }
  if (drawer === 'world' && parts[1] === subName(layout, 'domains') && parts.length >= 3) theme = parts[2]!;
  const ancestors: BundlePath[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const folder = parts.slice(0, i).join('/');
    const hub = hubOf(folder);
    if (hub && hub !== p) ancestors.push(hub);
  }
  const isHub = parts.length > 0 && hubOf(parts.join('/')) === p;
  const crumbs = drawer ? [drawerLabel(layout, drawer), ...parts.slice(1)] : parts;
  return { path: p, drawer, product, repo, theme, crumbs, ancestors, isHub };
}

/** The repository a note belongs to in a brain (`…/Code/<repo>/…`), or null. */
export function repoOfPath(layout: BrainLayout, path: string): string | null {
  return positionOf(layout, path).repo;
}

/**
 * The children of a subject: notes in its folder and sub-folders, except those
 * inside a deeper subject (a sub-folder with its own hub page) — that subject's
 * hub is the child instead. `2 Produits/Produit A` has `Fonctionnel/…` notes and
 * the hub of `Code/repo2`, not repo2's tickets.
 */
export function childrenOf(folder: string, paths: ReadonlySet<string>): BundlePath[] {
  const prefix = folder ? `${folder}/` : '';
  const own = hubOf(folder);
  const out: BundlePath[] = [];
  for (const raw of paths) {
    if (!raw.endsWith('.md') || !raw.startsWith(prefix) || raw === own) continue;
    const rest = raw.slice(prefix.length).split('/');
    let inside = false;
    for (let i = 1; i < rest.length; i++) {
      const subHub = hubOf(`${prefix}${rest.slice(0, i).join('/')}`);
      if (subHub && paths.has(subHub) && raw !== subHub) { inside = true; break; }
    }
    if (!inside) out.push(asBundlePath(raw));
  }
  return out.sort((a, b) => a.localeCompare(b));
}
