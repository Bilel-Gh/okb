import { resolve } from 'node:path';
import { headingSlugs, parseMarkdown, textOf } from '../markdown/ast.js';
import { parseOkf, type OkfDocument } from '../okf/document.js';
import { getExtension, type OkbExtension } from '../okf/extensions.js';
import { effectiveStatus, trustTier, type TrustTier } from '../okf/types.js';
import { readText, walkFiles } from '../util/fsx.js';
import { asBundlePath, matchesAny, type BundlePath } from '../util/paths.js';
import { snapshotFromEntries, type BundleSnapshot } from '../links/check.js';

export type KbEntry = {
  readonly path: BundlePath;
  readonly conceptId: string;
  readonly reserved: boolean;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly status: 'draft' | 'stable' | 'deprecated';
  readonly trust: TrustTier;
  readonly sha256: string;
  readonly ext: OkbExtension;
  readonly headings: readonly string[];
  readonly anchors: ReadonlySet<string>;
  readonly bodyLength: number;
};

export type Bundle = {
  readonly root: string;
  readonly snapshot: BundleSnapshot;
  readonly docs: ReadonlyMap<BundlePath, OkfDocument>;
  readonly entries: readonly KbEntry[];
  readonly byPath: ReadonlyMap<BundlePath, KbEntry>;
  /** Files that could not be parsed, kept visible instead of silently skipped. */
  readonly unreadable: readonly { path: string; reason: string }[];
};

export async function loadBundle(
  root: string,
  options: { exclude?: readonly string[] } = {},
): Promise<Bundle> {
  const absRoot = resolve(root);
  const exclude = options.exclude ?? [];
  const allFiles = (await walkFiles(absRoot)).filter(f => !matchesAny(f, exclude));
  const files = allFiles.filter(f => f.endsWith('.md')); 
  const snapshotEntries: [string, string][] = allFiles.filter(f => !f.endsWith('.md')).map(f => [f, '']);
  const docs = new Map<BundlePath, OkfDocument>();
  const entries: KbEntry[] = [];
  const unreadable: { path: string; reason: string }[] = [];

  for (const rel of files) {
    const text = await readText(resolve(absRoot, rel));
    snapshotEntries.push([rel, text]);
    let doc: OkfDocument;
    try {
      doc = parseOkf(rel, text);
    } catch (error) {
      unreadable.push({ path: rel, reason: (error as Error).message });
      continue;
    }
    docs.set(doc.path, doc);
    entries.push(toEntry(doc));
  }

  const byPath = new Map(entries.map((e) => [e.path, e]));
  return {
    root: absRoot,
    snapshot: snapshotFromEntries(snapshotEntries),
    docs,
    entries,
    byPath,
    unreadable,
  };
}

function toEntry(doc: OkfDocument): KbEntry {
  const fm = doc.data;
  const tree = parseMarkdown(doc.body);
  const headings: string[] = [];
  for (const node of tree.children) {
    if (node.type === 'heading') headings.push(textOf(node).trim());
  }
  return {
    path: doc.path,
    conceptId: doc.conceptId,
    reserved: doc.reserved,
    type: typeof fm.type === 'string' ? fm.type : '',
    title: typeof fm.title === 'string' ? fm.title : deriveTitle(doc),
    description: typeof fm.description === 'string' ? fm.description : '',
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status: effectiveStatus(fm),
    trust: trustTier(fm),
    sha256: doc.sha256,
    ext: getExtension(fm),
    headings,
    anchors: headingSlugs(doc.body),
    bodyLength: doc.body.length,
  };
}

function deriveTitle(doc: OkfDocument): string {
  const first = /^\s*#\s+(.+)$/m.exec(doc.body);
  if (first) return first[1]!.trim();
  return doc.path.split('/').pop()!.replace(/\.md$/, '').replace(/-/g, ' ');
}

export function conceptsFolderEntries(bundle: Bundle, folder: string): KbEntry[] {
  const prefix = `${asBundlePath(folder)}/`;
  return bundle.entries.filter((e) => !e.reserved && e.path.startsWith(prefix));
}

/** Convenience wrapper so every caller honours `kb.exclude` without repeating it. */
export async function loadBundleFor(config: {
  kb: { root: string; exclude: readonly string[] };
}): Promise<Bundle> {
  return loadBundle(config.kb.root, { exclude: config.kb.exclude });
}
