import { useQuery } from '@tanstack/react-query';
import { get } from '../app/api';
import type { Category } from '../app/data';
import type { GraphCategory, GraphEdgeIn, GraphNodeIn, GraphTheme } from './GraphView';

/** The graph of the brain, as the server computes it (themes detected with the Louvain method). */
export type Workspace = {
  id: string; name: string;
  repos: { id: string; name: string; area: string; notes: number; ownKb: string | null }[];
  edges: { from: string; to: string; label: string }[];
  scope: { repo: string | null; tied: string[] };
  tickets: { ref: string; title: string; status: string; repos: string[] }[];
};
export type GraphNode = GraphNodeIn & { area: string; in: number; out: number; community: number; status: string; description: string; reserved: boolean };
export type GraphData = {
  nodes: GraphNode[]; edges: GraphEdgeIn[]; categories: (Category & { count: number })[]; areas: { id: string; count: number }[];
  unresolved: number; communities: GraphTheme[]; modularity: number; workspace: Workspace | null;
};

export function useGraphData(nav = false) {
  return useQuery({ queryKey: ['graph', nav], queryFn: () => get<GraphData>('/api/graph', nav ? { nav: 1 } : {}), staleTime: 30_000 });
}

export function graphCategories(categories: readonly Category[], lang: 'fr' | 'en'): GraphCategory[] {
  return categories.map((c) => ({ id: c.id, color: c.color, colorDark: c.colorDark, label: c.label[lang], emoji: c.emoji }));
}
