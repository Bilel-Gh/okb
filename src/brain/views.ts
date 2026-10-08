import { oneLiner } from '../concepts/one-liner.js';
import { posix } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle, KbEntry } from '../kb/bundle.js';
import { getExtension } from '../okf/extensions.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { DRAWERS, drawerFolder, drawerLabel, layoutOf, rootFile, type BrainLayout, type DrawerId } from './layout.js';
import { childrenOf, hubOf, positionOf } from './tree.js';

/**
 * Views of a brain, computed without AI and without writing anything: the
 * index of a subject, the glossary, the shape of the drawers. The web app, the
 * terminal and Claude read them; with `kb.brain.views: files` they can also be
 * proposed as files (a proposal the person approves).
 */
export type IndexItem = {
  readonly path: BundlePath;
  readonly title: string;
  readonly description: string;
  readonly type: string;
  readonly status: string;
  /** Sub-folder inside the subject (`Fonctionnel`, `Tickets/2026`…), '' at its root. */
  readonly group: string;
  readonly hub: boolean;
};

export type SubjectIndex = {
  readonly folder: string;
  readonly hub: BundlePath | null;
  readonly title: string;
  readonly items: readonly IndexItem[];
  readonly groups: readonly { readonly name: string; readonly items: readonly IndexItem[] }[];
};

function typeOf(entry: KbEntry): string {
  const ext = getExtension({ x_okb: entry.ext } as never);
  return ext.brain?.type ?? ext.template ?? entry.type;
}

function item(entry: KbEntry, folder: string, hub: boolean): IndexItem {
  const rel = posix.dirname(entry.path).slice(folder ? folder.length + 1 : 0);
  return {
    path: entry.path, title: entry.title, description: entry.description, type: typeOf(entry),
    status: entry.status, group: rel === '.' || posix.dirname(entry.path) === folder ? '' : rel, hub,
  };
}

/** Everything a subject holds: its notes, and the pages of the subjects inside it. */
export function subjectIndex(bundle: Bundle, folder: string): SubjectIndex {
  const paths = new Set<string>(bundle.entries.filter((e) => !e.reserved).map((e) => e.path));
  const hub = hubOf(folder);
  const items: IndexItem[] = [];
  for (const p of childrenOf(folder, paths)) {
    const entry = bundle.byPath.get(p);
    if (!entry) continue;
    const isSubHub = hubOf(posix.dirname(p)) === p;
    items.push(item(entry, folder, isSubHub));
  }
  // Newest first inside dated groups (`Tickets/2026`), by title elsewhere.
  items.sort((a, b) => a.group.localeCompare(b.group) || (/\d{4}$/.test(a.group) ? b.path.localeCompare(a.path) : a.title.localeCompare(b.title)));
  const groups = new Map<string, IndexItem[]>();
  for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  return {
    folder, hub: hub && bundle.byPath.has(hub) ? hub : null,
    title: hub && bundle.byPath.get(hub)?.title ? bundle.byPath.get(hub)!.title : posix.basename(folder),
    items, groups: [...groups.entries()].map(([name, list]) => ({ name, items: list })),
  };
}

export type DrawerSummary = { readonly drawer: DrawerId; readonly folder: string; readonly label: string; readonly notes: number; readonly subjects: readonly { readonly name: string; readonly folder: string; readonly notes: number }[] };

/** The shape of a brain: each drawer, its subjects and how many notes each holds. */
export function brainShape(layout: BrainLayout, bundle: Bundle): { drawers: DrawerSummary[]; outside: BundlePath[] } {
  const drawers: DrawerSummary[] = DRAWERS.map((d) => ({ drawer: d, folder: drawerFolder(layout, d), label: drawerLabel(layout, d), notes: 0, subjects: [] }));
  const counts = new Map<string, number>();
  const outside: BundlePath[] = [];
  const roots = new Set([rootFile(layout, 'home'), rootFile(layout, 'now'), rootFile(layout, 'glossary')]);
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    const pos = positionOf(layout, e.path);
    if (!pos.drawer) { if (!roots.has(e.path)) outside.push(e.path); continue; }
    const d = drawers.find((x) => x.drawer === pos.drawer)!;
    (d as { notes: number }).notes += 1;
    const parts = e.path.split('/');
    if (parts.length > 2) {
      const subject = parts.slice(0, 2).join('/');
      counts.set(subject, (counts.get(subject) ?? 0) + 1);
    }
  }
  for (const d of drawers) {
    (d as { subjects: DrawerSummary['subjects'] }).subjects = [...counts.entries()]
      .filter(([f]) => f.startsWith(`${d.folder}/`))
      .map(([f, n]) => ({ name: f.slice(d.folder.length + 1), folder: f, notes: n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { drawers, outside: outside.sort() };
}

export type GlossaryEntry = {
  readonly term: string; readonly path: BundlePath; readonly description: string; readonly aliases: readonly string[]; readonly theme: string | null;
  /** The card's checked one-line definition (src/concepts/one-liner.ts): the only text shown on hover, null without one. */
  readonly oneLiner: string | null;
};

const CONCEPT_TYPES = new Set(['concept', 'acronym', 'Concept', 'Glossary']);

/** Every concept card of the brain, A→Z, with its theme when it lives in a domain. */
export function glossary(layout: BrainLayout | null, bundle: Bundle): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    const t = typeOf(e);
    if (!CONCEPT_TYPES.has(t) && !CONCEPT_TYPES.has(e.type)) continue;
    out.push({
      term: e.title, path: e.path, description: e.description, aliases: e.ext.aliases ?? [],
      oneLiner: oneLiner(bundle.docs.get(e.path)?.body ?? '', e.title).text,
      theme: layout ? positionOf(layout, e.path).theme : null,
    });
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
}

/** An index as Markdown: what a subject's page shows below its summary. */
export function renderIndex(index: SubjectIndex, from: string, lang: 'fr' | 'en', link: (from: string, to: string, text: string) => string): string {
  const fr = lang === 'fr';
  const lines: string[] = [];
  for (const g of index.groups) {
    lines.push(`### ${g.name || (fr ? 'À la racine' : 'At the root')}`, '');
    for (const it of g.items) lines.push(`- ${it.hub ? '📌 ' : ''}${link(from, it.path, it.title)}${it.description ? ` — ${it.description}` : ''}${it.status === 'draft' ? (fr ? ' *(brouillon)*' : ' *(draft)*') : ''}`);
    lines.push('');
  }
  if (!index.items.length) lines.push(fr ? '_Rien encore dans ce sujet._' : '_Nothing in this subject yet._', '');
  return lines.join('\n').trimEnd();
}

/** The folder whose index a path asks for: a folder, or the folder of a hub page. */
export function folderForIndex(config: OkbConfig, target: string): string {
  const layout = layoutOf(config);
  const clean = target.replace(/\/+$/, '');
  if (clean.endsWith('.md')) return posix.dirname(asBundlePath(clean));
  if (layout && /^\d$/.test(clean)) return drawerFolder(layout, DRAWERS[Number(clean)]!);
  return clean;
}
