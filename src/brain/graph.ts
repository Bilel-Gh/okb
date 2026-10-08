import { posix } from 'node:path';
import type { Bundle } from '../kb/bundle.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import { drawerFolder, drawerLabel, DRAWERS, subName, type BrainLayout } from './layout.js';
import { hubOf, positionOf } from './tree.js';

/**
 * The graph of a brain, by levels: from above, the drawers and the products;
 * a click opens a product (its sides and its repositories); another opens a
 * repository (its notes). Every level aggregates the links between notes into
 * links between what is shown, so the picture stays readable at 3 000 notes.
 */
export type BrainNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: 'drawer' | 'subject' | 'side' | 'repo' | 'note' | 'outside';
  readonly notes: number;
  /** The folder a click opens, or null. */
  readonly drill: string | null;
  /** For a note: its path; for a group: its page when it exists. */
  readonly path: string | null;
  readonly type?: string;
};
export type BrainEdge = { readonly from: string; readonly to: string; readonly weight: number };
export type BrainGraph = { readonly focus: string; readonly crumbs: readonly { readonly label: string; readonly focus: string }[]; readonly nodes: readonly BrainNode[]; readonly edges: readonly BrainEdge[] };

export function brainGraph(layout: BrainLayout, bundle: Bundle, rawFocus: string): BrainGraph {
  const focus = rawFocus.replace(/\/+$/, '');
  const subjects = drawerFolder(layout, 'subjects');
  const code = subName(layout, 'code');
  // The home page and the drawers' own pages shape the brain; they are not part of what is drawn.
  const structural = (p: string) => !p.includes('/') || (p.split('/').length === 2 && hubOf(p.split('/')[0]!) === p);
  const paths = bundle.entries.filter((e) => !e.reserved && !structural(e.path)).map((e) => e.path as string);
  const has = new Set(paths);

  /** The group a note belongs to at the top level: its product in the subjects drawer, else its drawer. */
  const top = (p: string): string => {
    const parts = p.split('/');
    if (parts[0] === subjects && parts.length > 2) return parts.slice(0, 2).join('/');
    return parts.length > 1 ? parts[0]! : '.';
  };
  /** The group of a note at the current level. */
  const groupOf = (p: string): string => {
    if (!focus) return top(p);
    if (!p.startsWith(`${focus}/`)) return `outside:${top(p)}`;
    const rest = p.slice(focus.length + 1).split('/');
    if (rest.length === 1) return isLeaf ? p : `${focus}/.`;
    if (rest[0] === code && rest.length > 2) return `${focus}/${code}/${rest[1]}`;
    return isLeaf ? p : `${focus}/${rest[0]}`;
  };
  const inside = paths.filter((p) => !focus || p.startsWith(`${focus}/`));
  // A level is a leaf when it has no sub-folder worth a bubble: its notes are drawn one by one.
  const subFolders = new Set(inside.map((p) => p.slice(focus ? focus.length + 1 : 0).split('/')).filter((r) => r.length > 1).map((r) => r[0]));
  const isLeaf = Boolean(focus) && (positionOf(layout, `${focus}/x.md`).repo !== null || subFolders.size === 0 || (subFolders.size === 1 && inside.length <= 40));

  const counts = new Map<string, number>();
  for (const p of paths) {
    const g = groupOf(p);
    if (g.startsWith('outside:')) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const edges = new Map<string, number>();
  const outside = new Map<string, number>();
  for (const [p, doc] of bundle.docs) {
    if (!has.has(p)) continue;
    const a = groupOf(p);
    for (const l of extractLinks(doc.body)) {
      const target = resolveInternal(p, l.url);
      if (!target || !has.has(target)) continue;
      const b = groupOf(target);
      if (a === b || (a.startsWith('outside:') && b.startsWith('outside:'))) continue;
      // The breadcrumb is a link up, not a relation: it shapes the tree, not the edges.
      if (doc.body.split('\n').some((line) => line.startsWith('🧭') && line.includes(l.url))) continue;
      const [x, y] = a < b ? [a, b] : [b, a];
      edges.set(`${x}\u0000${y}`, (edges.get(`${x}\u0000${y}`) ?? 0) + 1);
      for (const g of [a, b]) if (g.startsWith('outside:')) outside.set(g, (outside.get(g) ?? 0) + 1);
    }
  }
  const nodes: BrainNode[] = [];
  const labelOf = (g: string): string => {
    const name = posix.basename(g);
    const d = DRAWERS.find((x) => drawerFolder(layout, x) === g);
    return d ? drawerLabel(layout, d) : name === '.' ? posix.basename(focus) : name;
  };
  for (const [g, n] of counts) {
    if (isLeaf && focus) {
      const e = bundle.byPath.get(g as never);
      nodes.push({ id: g, label: e?.title ?? posix.basename(g, '.md'), kind: 'note', notes: 1, drill: null, path: g, type: e?.ext.brain?.type ?? e?.ext.template ?? e?.type ?? '' });
      continue;
    }
    const isDrawer = !g.includes('/') && g !== '.';
    const isRepo = g.split('/').includes(code) && positionOf(layout, `${g}/x.md`).repo !== null;
    const hub = hubOf(g.endsWith('/.') ? g.slice(0, -2) : g);
    nodes.push({
      id: g, label: labelOf(g), kind: isDrawer ? 'drawer' : isRepo ? 'repo' : focus ? 'side' : 'subject', notes: n,
      drill: g === '.' || g.endsWith('/.') ? null : g, path: hub && has.has(hub) ? hub : null,
    });
  }
  for (const [g, n] of outside) {
    const real = g.slice('outside:'.length);
    nodes.push({ id: g, label: labelOf(real), kind: 'outside', notes: n, drill: real === '.' ? null : real, path: null });
  }
  const crumbs: { label: string; focus: string }[] = [{ label: '🧠', focus: '' }];
  if (focus) {
    const parts = focus.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const f = parts.slice(0, i).join('/');
      if (parts[i - 1] === code) continue;
      crumbs.push({ label: labelOf(f), focus: f });
    }
  }
  return {
    focus, crumbs, nodes: nodes.sort((a, b) => b.notes - a.notes),
    edges: [...edges.entries()].map(([k, w]) => { const [from, to] = k.split('\u0000') as [string, string]; return { from, to, weight: w }; }),
  };
}
