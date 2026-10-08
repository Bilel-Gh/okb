import { posix } from 'node:path';
import type { Bundle } from '../kb/bundle.js';
import { extractLinks } from '../markdown/ast.js';
import { resolveInternal } from '../links/portable.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import type { BrainLayout } from './layout.js';
import { childrenOf, hubOf, positionOf } from './tree.js';

/**
 * The vertical context of a note or a subject: the pages of the subjects above
 * it (their 5-minute summaries), its children and its neighbours, and the
 * concept cards it cites — dosed to a token budget, so Claude writes and
 * answers knowing the whole subject without reading the whole brain.
 */
export type ContextItem = { readonly path: BundlePath; readonly title: string; readonly brief: string; readonly role: 'parent' | 'self' | 'child' | 'sibling' | 'linked' };
export type VerticalContext = { readonly items: readonly ContextItem[]; readonly tokens: number; readonly budget: number; readonly truncated: boolean };

const tokens = (text: string) => Math.ceil(text.length / 4);

/** « En bref »: a section of that name, else the description, else the first paragraph. */
export function briefOf(bundle: Bundle, path: BundlePath, max = 420): string {
  const doc = bundle.docs.get(path);
  if (!doc) return '';
  const body = doc.body;
  const section = /^#{2,3}\s+(?:\S+\s+)?(?:En bref|In short|En 30 secondes|In 30 seconds)\s*$/im.exec(body);
  let text = '';
  if (section) {
    const rest = body.slice(section.index + section[0].length);
    const end = rest.search(/^#{1,3}\s/m);
    text = (end >= 0 ? rest.slice(0, end) : rest).trim();
  }
  if (!text) text = typeof doc.data.description === 'string' ? doc.data.description : '';
  if (!text) {
    const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('🧭') && !p.startsWith('---') && !p.startsWith('>'));
    text = para ?? '';
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function verticalContext(layout: BrainLayout, bundle: Bundle, target: string, budget = 2_000): VerticalContext {
  const items: ContextItem[] = [];
  let used = 0;
  let truncated = false;
  const paths = new Set<string>(bundle.entries.filter((e) => !e.reserved).map((e) => e.path));
  const push = (path: BundlePath, role: ContextItem['role'], max: number) => {
    if (!bundle.byPath.has(path) || items.some((i) => i.path === path)) return;
    const entry = bundle.byPath.get(path)!;
    const brief = briefOf(bundle, path, max);
    const cost = tokens(`${entry.title} ${brief} ${path}`) + 6;
    if (used + cost > budget) { truncated = true; return; }
    used += cost;
    items.push({ path, title: entry.title, brief, role });
  };
  const isNote = target.endsWith('.md');
  const notePath = isNote ? asBundlePath(target) : null;
  const folder = isNote ? posix.dirname(asBundlePath(target)) : target.replace(/\/+$/, '');
  const self = notePath ?? hubOf(folder);
  const pos = positionOf(layout, self ?? `${folder}/x.md`);
  // Nearest parents first: they matter most when the budget is short.
  for (const hub of [...pos.ancestors].reverse()) push(hub, 'parent', 520);
  if (self) push(self, 'self', 600);
  const subjectFolder = notePath && hubOf(folder) !== notePath ? folder : folder;
  for (const child of childrenOf(subjectFolder, paths).slice(0, 30)) if (child !== self) push(child, 'child', 160);
  const parentFolder = posix.dirname(subjectFolder);
  if (parentFolder && parentFolder !== '.') {
    for (const sib of childrenOf(parentFolder, paths).filter((p) => hubOf(posix.dirname(p)) === p && posix.dirname(p) !== subjectFolder).slice(0, 12)) push(sib, 'sibling', 80);
  }
  if (notePath && bundle.docs.has(notePath)) {
    for (const link of extractLinks(bundle.docs.get(notePath)!.body)) {
      const to = resolveInternal(notePath, link.url);
      if (to && bundle.byPath.has(to)) push(to, 'linked', 200);
    }
  }
  return { items, tokens: used, budget, truncated };
}

export function renderContext(ctx: VerticalContext, root: string): string {
  const label: Record<ContextItem['role'], string> = { parent: '⬆️', self: '📍', child: '⬇️', sibling: '↔️', linked: '🔗' };
  return ctx.items.map((i) => `${label[i.role]} ${i.title} — ${root ? `${root}/` : ''}${i.path}${i.brief ? `\n   ${i.brief}` : ''}`).join('\n');
}
