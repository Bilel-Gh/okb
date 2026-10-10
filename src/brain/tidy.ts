import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import type { BundlePath } from '../util/paths.js';
import { layoutOf, rootFile } from './layout.js';
import { positionOf } from './tree.js';

export type TidyNote = { readonly path: BundlePath; readonly title: string };

/**
 * The notes to tidy, shown at a glance in the graph (F2.0-19):
 * - isolated: no other note links to it and it links to none, its breadcrumb aside;
 * - misplaced: it sits outside the drawers of the brain.
 */
export function toTidy(config: OkbConfig, bundle: Bundle): { isolated: TidyNote[]; misplaced: TidyNote[] } {
  const layout = layoutOf(config);
  const linked = new Set<string>();
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved) continue;
    const crumb = doc.body.split('\n').find((l) => l.startsWith('🧭')) ?? '';
    for (const link of extractLinks(doc.body)) {
      if (link.kind === 'image' || crumb.includes(link.url)) continue;
      const target = resolveInternal(path, link.url);
      if (!target || target === path || !bundle.byPath.has(target) || bundle.byPath.get(target)!.reserved) continue;
      linked.add(path);
      linked.add(target);
    }
  }
  const roots = layout ? [rootFile(layout, 'home'), rootFile(layout, 'now'), rootFile(layout, 'glossary')] : [];
  const isolated: TidyNote[] = [];
  const misplaced: TidyNote[] = [];
  for (const e of bundle.entries) {
    if (e.reserved || roots.includes(e.path) || /^readme\.md$/i.test(e.path)) continue;
    const note = { path: e.path, title: e.title };
    if (layout && !positionOf(layout, e.path).drawer) misplaced.push(note);
    if (!linked.has(e.path)) isolated.push(note);
  }
  return { isolated, misplaced };
}
