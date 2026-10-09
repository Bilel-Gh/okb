/**
 * The shape of the explorer: the brain's folders as a tree that unfolds level
 * by level, and the list of notes grouped by type or by folder, each group
 * foldable. Pure functions, so the page stays a thin layer on top.
 */
export type FolderNode = { name: string; path: string; count: number; children: FolderNode[] };
type Row = { path: string; title: string; category: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Every folder that holds notes, with the number of notes under it (sub-folders included). Notes at the root are left out. */
export function folderTree(paths: readonly string[]): FolderNode[] {
  const root: FolderNode = { name: '', path: '', count: 0, children: [] };
  const index = new Map<string, FolderNode>([['', root]]);
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let node = index.get(path);
      if (!node) {
        node = { name: parts[i]!, path, count: 0, children: [] };
        index.set(path, node);
        parent.children.push(node);
      }
      node.count++;
      parent = node;
    }
  }
  const sort = (nodes: FolderNode[]) => { nodes.sort((a, b) => collator.compare(a.name, b.name)); for (const n of nodes) sort(n.children); };
  sort(root.children);
  return root.children;
}

/** « 1 Écosystème » → drawer 1, « Écosystème ». */
export function drawerOf(name: string): { n: number | null; label: string } {
  const m = /^(\d{1,2})\s+(.+)$/.exec(name);
  return m ? { n: Number(m[1]), label: m[2]! } : { n: null, label: name };
}

/** The folders leading to a place (a folder, or a note's folder when `isFile`). */
export function ancestors(path: string, isFile = false): string[] {
  const parts = path.split('/').filter(Boolean);
  if (isFile) parts.pop();
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

export type NoteGroup<T> = { key: string; label: string; items: T[] };

/**
 * Group the notes by type (in the categories' order) or by the folder right
 * under `within` (the notes directly in it first, under an empty label).
 */
export function groupNotes<T extends Row>(list: readonly T[], by: 'type' | 'folder', opts: { order?: readonly string[]; label?: (key: string) => string; within?: string } = {}): NoteGroup<T>[] {
  const groups = new Map<string, T[]>();
  const keyOf = (n: T): string => {
    if (by === 'type') return n.category;
    const base = opts.within ? `${opts.within}/` : '';
    const rest = n.path.startsWith(base) ? n.path.slice(base.length) : n.path;
    const head = rest.includes('/') ? rest.split('/')[0]! : '';
    return head ? `${base}${head}` : (opts.within ?? '');
  };
  for (const n of list) { const k = keyOf(n); groups.set(k, [...(groups.get(k) ?? []), n]); }
  const order = opts.order ?? [];
  const rank = (k: string) => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
  const keys = [...groups.keys()].sort((a, b) => (by === 'type' ? rank(a) - rank(b) || collator.compare(a, b) : a === (opts.within ?? '') ? -1 : b === (opts.within ?? '') ? 1 : collator.compare(a, b)));
  return keys.map((key) => ({
    key,
    label: by === 'type' ? (opts.label?.(key) ?? key) : key === (opts.within ?? '') ? '' : key.split('/').pop()!,
    items: groups.get(key)!,
  }));
}

export type ListRow<T> = { kind: 'group'; key: string; label: string; count: number; open: boolean } | { kind: 'note'; note: T; group: string };

/** Groups as rows for a virtual list: a header per group, its notes unless it is folded. */
export function flattenGroups<T>(groups: readonly NoteGroup<T>[], closed: ReadonlySet<string>): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  for (const g of groups) {
    const open = !closed.has(g.key);
    rows.push({ kind: 'group', key: g.key, label: g.label, count: g.items.length, open });
    if (open) for (const note of g.items) rows.push({ kind: 'note', note, group: g.key });
  }
  return rows;
}
