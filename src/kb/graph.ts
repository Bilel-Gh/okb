import { categorise, categoryById, OTHER, templateCategories, type Category } from '../categories/categories.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import type { NoteTemplate } from '../templates/builtin.js';
import type { BundlePath } from '../util/paths.js';
import type { Bundle } from './bundle.js';
import { louvain } from './communities.js';

/**
 * The KB as a graph: one node per note, one edge per link a note makes to
 * another (Markdown links, read from the parsed text, not guessed), plus the
 * declared prerequisites. It feeds the web graph, exact backlinks, the local
 * graph of a note and the category counts.
 */
export type GraphNode = {
  readonly id: BundlePath;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly categoryVia: 'explicit' | 'template' | 'type' | 'folder' | 'none';
  readonly type: string;
  readonly template: string | null;
  /** First folder (`concepts`, `repos`…), `.` for notes at the root. */
  readonly folder: string;
  /** Where the note belongs: a repository (`repos/<id>`), else its first folder. */
  readonly area: string;
  readonly tags: readonly string[];
  readonly status: string;
  readonly reserved: boolean;
  readonly size: number;
  readonly in: number;
  readonly out: number;
  /** Detected theme (Louvain community), -1 for a note without links. */
  readonly community: number;
};

export type GraphEdge = { readonly source: BundlePath; readonly target: BundlePath; readonly kind: 'link' | 'prereq' };

export type KbGraph = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly categories: readonly (Category & { readonly count: number })[];
  readonly areas: readonly { readonly id: string; readonly count: number }[];
  /** Links to notes that do not exist (yet). */
  readonly unresolved: number;
  /** Detected themes, largest first, each named after its most linked note. */
  readonly communities: readonly { readonly id: number; readonly size: number; readonly hub: BundlePath; readonly label: string }[];
  /** How well the themes separate (Louvain modularity, 0 to 1; above ~0.3 the themes are real). */
  readonly modularity: number;
};

export function buildGraph(bundle: Bundle, categories: readonly Category[], templates: readonly NoteTemplate[] = [], options: { includeNav?: boolean } = {}): KbGraph {
  const byTemplate = templateCategories(templates);
  const nodes = new Map<BundlePath, Omit<GraphNode, 'in' | 'out' | 'community'>>();
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved && !options.includeNav) continue;
    const entry = bundle.byPath.get(path);
    if (!entry) continue;
    const ext = entry.ext as { template?: unknown; category?: unknown; repo?: { id?: unknown } };
    const { category, via } = categorise({ path, type: entry.type, template: ext.template, explicit: ext.category }, categories, byTemplate);
    const parts = path.split('/');
    const folder = parts.length > 1 ? parts[0]! : '.';
    const repo = typeof ext.repo?.id === 'string' && ext.repo.id !== '*' ? ext.repo.id : parts[0] === 'repos' && parts.length > 2 ? parts[1] : null;
    nodes.set(path, {
      id: path, title: entry.title, description: entry.description, category, categoryVia: via,
      type: entry.type, template: typeof ext.template === 'string' ? ext.template : null,
      folder, area: repo ? `repos/${repo}` : folder, tags: entry.tags, status: entry.status, reserved: entry.reserved, size: entry.bodyLength,
    });
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  const add = (source: BundlePath, target: BundlePath, kind: GraphEdge['kind']) => {
    if (source === target) return;
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };
  for (const [path, doc] of bundle.docs) {
    if (!nodes.has(path)) continue;
    for (const link of extractLinks(doc.body)) {
      if (link.kind === 'image') continue;
      const target = resolveInternal(path, link.url);
      if (!target || !target.endsWith('.md')) continue;
      if (nodes.has(target)) add(path, target, 'link');
      else if (!bundle.docs.has(target)) unresolved++;
    }
    const prereqs = (bundle.byPath.get(path)?.ext.prereqs ?? []) as string[];
    for (const p of prereqs) if (nodes.has(p as BundlePath)) add(path, p as BundlePath, 'prereq');
  }
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  for (const e of edges) {
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
  }
  const ordered = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const found = louvain(ordered.map((n) => n.id), edges.map((e) => ({ source: e.source, target: e.target })));
  const list: GraphNode[] = ordered.map((n) => ({ ...n, in: inCount.get(n.id) ?? 0, out: outCount.get(n.id) ?? 0, community: found.of.get(n.id) ?? -1 }));
  const degree = (id: string) => (inCount.get(id) ?? 0) + (outCount.get(id) ?? 0);
  const communities = found.list.map((c) => {
    const hub = [...c.members].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))[0]! as BundlePath;
    return { id: c.id, size: c.members.length, hub, label: nodes.get(hub)?.title ?? hub };
  });
  const counts = new Map<string, number>();
  for (const n of list) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
  const areas = new Map<string, number>();
  for (const n of list) areas.set(n.area, (areas.get(n.area) ?? 0) + 1);
  return {
    nodes: list,
    edges,
    categories: categories.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })),
    areas: [...areas].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    unresolved,
    communities,
    modularity: found.modularity,
  };
}

/** Notes linking to `path`, and notes it links to: exact, from parsed links. */
export function neighbours(graph: KbGraph, path: string): { incoming: GraphNode[]; outgoing: GraphNode[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id as string, n]));
  const incoming = graph.edges.filter((e) => e.target === path).map((e) => byId.get(e.source)).filter((n): n is GraphNode => Boolean(n));
  const outgoing = graph.edges.filter((e) => e.source === path).map((e) => byId.get(e.target)).filter((n): n is GraphNode => Boolean(n));
  return { incoming, outgoing };
}

export { categoryById, OTHER };
