import type { Bundle } from '../kb/bundle.js';
import type { BundlePath } from '../util/paths.js';

export type PrereqChain = {
  readonly order: readonly BundlePath[];
  /** Edges dropped because following them would loop. */
  readonly cycles: readonly (readonly BundlePath[])[];
  readonly truncatedAtDepth: boolean;
};

/**
 * Walk `x_okb.prereqs` breadth-first, deepest-first in the output so a reader
 * meets foundations before what builds on them.
 *
 * Depth is capped and cycles are reported rather than followed: "A requires B
 * requires A" is a real modelling mistake and must surface, not hang.
 */
export function buildPrereqChain(
  bundle: Bundle,
  start: BundlePath,
  options: { maxDepth: number; maxNodes?: number },
): PrereqChain {
  const maxNodes = options.maxNodes ?? 12;
  const cycles: BundlePath[][] = [];
  const depthOf = new Map<BundlePath, number>();
  const order: BundlePath[] = [];
  let truncatedAtDepth = false;

  const queue: { path: BundlePath; depth: number; trail: BundlePath[] }[] = [
    { path: start, depth: 0, trail: [start] },
  ];
  const seen = new Set<BundlePath>([start]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entry = bundle.byPath.get(current.path);
    const prereqs = (entry?.ext.prereqs ?? []) as BundlePath[];

    for (const next of prereqs) {
      if (current.trail.includes(next)) {
        cycles.push([...current.trail, next]);
        continue;
      }
      const depth = current.depth + 1;
      if (depth > options.maxDepth) {
        truncatedAtDepth = true;
        continue;
      }
      if (!bundle.byPath.has(next)) continue;

      if (!seen.has(next)) {
        seen.add(next);
        order.push(next);
        if (order.length >= maxNodes) {
          depthOf.set(next, depth);
          return { order: sortByDepth(order, depthOf), cycles, truncatedAtDepth: true };
        }
      }
      // A node reachable by several paths takes its deepest position, so a
      // foundation shared by two documents still reads before both of them.
      const known = depthOf.get(next) ?? 0;
      if (depth <= known) continue;
      depthOf.set(next, depth);
      queue.push({ path: next, depth, trail: [...current.trail, next] });
    }
  }

  return { order: sortByDepth(order, depthOf), cycles, truncatedAtDepth };
}

function sortByDepth(
  paths: readonly BundlePath[],
  depthOf: ReadonlyMap<BundlePath, number>,
): BundlePath[] {
  return [...paths].sort(
    (a, b) => (depthOf.get(b) ?? 0) - (depthOf.get(a) ?? 0) || a.localeCompare(b),
  );
}

/** Detect every prerequisite cycle reachable from the whole bundle. */
export function findAllPrereqCycles(bundle: Bundle): BundlePath[][] {
  const cycles: BundlePath[][] = [];
  const state = new Map<BundlePath, 'visiting' | 'done'>();

  const visit = (node: BundlePath, trail: BundlePath[]): void => {
    const current = state.get(node);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = trail.indexOf(node);
      cycles.push([...trail.slice(start), node]);
      return;
    }
    state.set(node, 'visiting');
    for (const next of (bundle.byPath.get(node)?.ext.prereqs ?? []) as BundlePath[]) {
      if (bundle.byPath.has(next)) visit(next, [...trail, node]);
    }
    state.set(node, 'done');
  };

  for (const entry of bundle.entries) visit(entry.path, []);
  return cycles;
}
