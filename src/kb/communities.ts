/**
 * Communities of the KB graph (Louvain method, Blondel et al. 2008): groups of
 * notes far more linked to each other than to the rest — the themes of a KB,
 * found without reading a word. Deterministic (nodes visited in a fixed order),
 * so the same KB always gives the same themes, colours and layout.
 *
 * Modularity Q = Σ_c [ L_c / m − γ (d_c / 2m)² ], with L_c the weight of links
 * inside community c, d_c the sum of its degrees, m the total link weight.
 */
export type Communities = {
  /** Community per node id; -1 for a note with no link (it belongs to no theme). */
  readonly of: ReadonlyMap<string, number>;
  /** Communities by decreasing size; ids are their index here. */
  readonly list: readonly { readonly id: number; readonly members: readonly string[] }[];
  readonly modularity: number;
};

type Edge = { u: number; v: number; w: number };

export function louvain(ids: readonly string[], links: readonly { source: string; target: string; weight?: number }[], resolution = 1): Communities {
  const index = new Map(ids.map((id, i) => [id, i] as const));
  // Undirected, merged: a→b and b→a are one link of summed weight.
  const merged = new Map<string, Edge>();
  for (const l of links) {
    const a = index.get(l.source), b = index.get(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    const u = Math.min(a, b), v = Math.max(a, b);
    const key = `${u}:${v}`;
    const e = merged.get(key);
    if (e) e.w += l.weight ?? 1; else merged.set(key, { u, v, w: l.weight ?? 1 });
  }
  let edges = [...merged.values()];
  const m = edges.reduce((s, e) => s + e.w, 0);
  const degreeOf = new Array(ids.length).fill(0) as number[];
  for (const e of edges) { degreeOf[e.u]! += e.w; degreeOf[e.v]! += e.w; }
  if (m === 0) return finish(ids, ids.map((_, i) => i), degreeOf, edges, m, resolution);

  // membership[i]: the community of original node i, refined level by level.
  let membership = ids.map((_, i) => i);
  let n = ids.length;
  for (let level = 0; level < 20; level++) {
    const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
    const k = new Array(n).fill(0) as number[];
    for (const e of edges) {
      if (e.u === e.v) { k[e.u]! += 2 * e.w; adj[e.u]!.set(e.u, (adj[e.u]!.get(e.u) ?? 0) + e.w); continue; }
      adj[e.u]!.set(e.v, (adj[e.u]!.get(e.v) ?? 0) + e.w);
      adj[e.v]!.set(e.u, (adj[e.v]!.get(e.u) ?? 0) + e.w);
      k[e.u]! += e.w; k[e.v]! += e.w;
    }
    const comm = Array.from({ length: n }, (_, i) => i);
    const tot = [...k];
    let movedThisLevel = false;
    for (let pass = 0; pass < 50; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const own = comm[i]!;
        // Weight from i to each neighbouring community (self-loops excluded).
        const toComm = new Map<number, number>();
        for (const [j, w] of adj[i]!) if (j !== i) toComm.set(comm[j]!, (toComm.get(comm[j]!) ?? 0) + w);
        tot[own]! -= k[i]!;
        let best = own;
        let bestGain = (toComm.get(own) ?? 0) - resolution * (tot[own]! * k[i]!) / (2 * m);
        for (const [c, w] of toComm) {
          const gain = w - resolution * (tot[c]! * k[i]!) / (2 * m);
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best && c !== own && gain > 0)) { best = c; bestGain = gain; }
        }
        tot[best]! += k[i]!;
        if (best !== own) { comm[i] = best; moved = true; movedThisLevel = true; }
      }
      if (!moved) break;
    }
    if (!movedThisLevel) break;
    // Renumber, then fold each community into one node of the next level.
    const renumber = new Map<number, number>();
    for (const c of comm) if (!renumber.has(c)) renumber.set(c, renumber.size);
    membership = membership.map((c) => renumber.get(comm[c]!)!);
    const folded = new Map<string, Edge>();
    for (const e of edges) {
      const a = renumber.get(comm[e.u]!)!, b = renumber.get(comm[e.v]!)!;
      const u = Math.min(a, b), v = Math.max(a, b);
      const key = `${u}:${v}`;
      const f = folded.get(key);
      if (f) f.w += e.w; else folded.set(key, { u, v, w: e.w });
    }
    edges = [...folded.values()];
    n = renumber.size;
  }
  return finish(ids, membership, degreeOf, [...merged.values()], m, resolution);
}

function finish(ids: readonly string[], membership: readonly number[], degree: readonly number[], edges: readonly Edge[], m: number, resolution: number): Communities {
  const groups = new Map<number, string[]>();
  ids.forEach((id, i) => {
    if (degree[i] === 0) return;
    const list = groups.get(membership[i]!) ?? [];
    list.push(id);
    groups.set(membership[i]!, list);
  });
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  const of = new Map<string, number>(ids.map((id) => [id, -1] as const));
  ordered.forEach((members, c) => { for (const id of members) of.set(id, c); });
  // Modularity of the final partition, on the original graph.
  let q = 0;
  if (m > 0) {
    const inside = new Map<number, number>();
    const degSum = new Map<number, number>();
    for (const e of edges) if (of.get(ids[e.u]!) === of.get(ids[e.v]!)) inside.set(of.get(ids[e.u]!)!, (inside.get(of.get(ids[e.u]!)!) ?? 0) + e.w);
    ids.forEach((id, i) => { const c = of.get(id)!; if (c >= 0) degSum.set(c, (degSum.get(c) ?? 0) + degree[i]!); });
    for (const [c, d] of degSum) q += (inside.get(c) ?? 0) / m - resolution * (d / (2 * m)) ** 2;
  }
  return { of, list: ordered.map((members, id) => ({ id, members })), modularity: Math.round(q * 1000) / 1000 };
}
