import { describe, expect, it } from 'vitest';
import { ancestors, drawerOf, flattenGroups, folderTree, groupNotes } from '../../web-app/src/pages/brain-tree.js';

const note = (path: string, category = 'concept', title = path.split('/').pop()!.replace(/\.md$/, '')) => ({ path, title, category, description: '', type: '', status: 'stable' });

describe('the folders of a brain, as a tree that unfolds level by level', () => {
  const notes = [
    note('1 Écosystème/Domaines/Logistique/Idempotence.md'),
    note('1 Écosystème/Domaines/Logistique/Webhook.md'),
    note('1 Écosystème/Domaines/Facturation/TVA.md'),
    note('1 Écosystème/Écosystème.md', 'guide'),
    note('10 Archives/Vieux.md'),
    note('2 Produits/Atlas/Code/atlas-api/Tickets/ABC-1.md', 'ticket'),
    note('Accueil.md', 'other'),
  ];

  it('counts every note under a folder, sub-folders included, and sorts drawers by their number', () => {
    const tree = folderTree(notes.map((n) => n.path));
    expect(tree.map((n) => n.name)).toEqual(['1 Écosystème', '2 Produits', '10 Archives']);
    const eco = tree[0]!;
    expect(eco.count).toBe(4);
    expect(eco.children.map((c) => c.name)).toEqual(['Domaines']);
    const domaines = eco.children[0]!;
    expect(domaines.path).toBe('1 Écosystème/Domaines');
    expect(domaines.children.map((c) => [c.name, c.count])).toEqual([['Facturation', 1], ['Logistique', 2]]);
    const deep = tree[1]!.children[0]!.children[0]!.children[0]!.children[0]!;
    expect(deep.path).toBe('2 Produits/Atlas/Code/atlas-api/Tickets');
    expect(deep.children).toEqual([]);
  });

  it('reads the number of a drawer and its name without it', () => {
    expect(drawerOf('1 Écosystème')).toEqual({ n: 1, label: 'Écosystème' });
    expect(drawerOf('Notes')).toEqual({ n: null, label: 'Notes' });
  });

  it('opens the folders that lead to a place', () => {
    expect(ancestors('a/b/c.md', true)).toEqual(['a', 'a/b']);
    expect(ancestors('a/b')).toEqual(['a', 'a/b']);
    expect(ancestors('')).toEqual([]);
  });
});

describe('the list of notes, grouped and foldable', () => {
  const list = [note('a/x.md', 'concept'), note('a/y.md', 'case'), note('b/z.md', 'concept'), note('b/w.md', 'guide')];

  it('groups by type in the order of the categories, each group with its count', () => {
    const groups = groupNotes(list, 'type', { order: ['guide', 'concept', 'case'], label: (k) => k.toUpperCase() });
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([['guide', 'GUIDE', 1], ['concept', 'CONCEPT', 2], ['case', 'CASE', 1]]);
  });

  it('groups by folder, by the place under the current folder', () => {
    const groups = groupNotes([note('p/a/q/1.md'), note('p/a/2.md'), note('p/b/3.md'), note('p/4.md')], 'folder', { within: 'p' });
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([['p', 1], ['p/a', 2], ['p/b', 1]]);
    expect(groups.map((g) => g.label)).toEqual(['', 'a', 'b']);
  });

  it('turns groups into rows, hiding the notes of a folded group', () => {
    const groups = groupNotes(list, 'type', { order: ['concept', 'case', 'guide'] });
    const rows = flattenGroups(groups, new Set(['case']));
    expect(rows.map((r) => (r.kind === 'group' ? `#${r.key}${r.open ? '' : '+'}` : r.note.path))).toEqual(['#concept', 'a/x.md', 'b/z.md', '#case+', '#guide', 'b/w.md']);
  });
});
