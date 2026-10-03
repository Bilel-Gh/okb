import { posix } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle, type KbEntry } from '../kb/bundle.js';
import { markdownLink } from '../links/portable.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { labelsFor } from '../style/labels.js';

export type NavSection = {
  readonly heading: string;
  readonly entries: readonly { readonly path: BundlePath; readonly title: string; readonly description: string }[];
};

export type NavFile = {
  readonly path: BundlePath;
  readonly content: string;
  readonly status: 'missing' | 'outdated' | 'current';
};

/**
 * Generate the `index.md` tree.
 *
 * OKF §8 lets a producer generate index files, and they carry no frontmatter —
 * which is also why they are the right place for navigation and the wrong place
 * for knowledge. The grouping follows the configured layout so a reader lands on
 * home, then concepts, procedures and references.
 */
export async function buildNavigation(
  config: OkbConfig,
  options: { bundle?: Bundle } = {},
): Promise<NavFile[]> {
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const out: NavFile[] = [];

  const folders = new Map<string, KbEntry[]>();
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const dir = posix.dirname(entry.path);
    folders.set(dir, [...(folders.get(dir) ?? []), entry]);
  }

  for (const [dir, entries] of folders) {
    if (dir === '.') continue;
    const path = asBundlePath(posix.join(dir, 'index.md'));
    out.push(renderFile(bundle, path, [
      { heading: titleOfFolder(dir), entries: entries.map(describe).sort(byPath) },
    ]));
  }

  const home = asBundlePath(config.kb.layout.home);
  const sections: NavSection[] = [];
  const rootEntries = (folders.get('.') ?? []).map(describe).sort(byPath);
  if (rootEntries.length > 0) sections.push({ heading: labelsFor(config.writing.language ?? config.profile.answer.language).startHere, entries: rootEntries });

  for (const [dir, entries] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
    if (dir === '.') continue;
    sections.push({ heading: titleOfFolder(dir), entries: entries.map(describe).sort(byPath) });
  }
  out.push(renderFile(bundle, home, sections, { okfVersion: config.okf.version }));

  return out;
}

function renderFile(
  bundle: Bundle,
  path: BundlePath,
  sections: readonly NavSection[],
  options: { okfVersion?: string } = {},
): NavFile {
  const lines: string[] = [];
  if (options.okfVersion) lines.push('---', `okf_version: "${options.okfVersion}"`, '---', '');

  for (const section of sections) {
    if (section.entries.length === 0) continue;
    lines.push(`# ${section.heading}`, '');
    for (const entry of section.entries) {
      const link = markdownLink(path, entry.path, entry.title);
      lines.push(entry.description ? `* ${link} - ${entry.description}` : `* ${link}`);
    }
    lines.push('');
  }

  const content = `${lines.join('\n').trimEnd()}\n`;
  const existing = bundle.snapshot.files.get(path);
  return {
    path,
    content,
    status: existing === undefined ? 'missing' : existing === content ? 'current' : 'outdated',
  };
}

function describe(entry: KbEntry) {
  const suffix =
    entry.status === 'draft' ? ' *(draft)*' : entry.status === 'deprecated' ? ' *(deprecated)*' : '';
  return {
    path: entry.path,
    title: entry.title,
    description: `${entry.description}${suffix}`.trim(),
  };
}

/**
 * File order, as Obsidian's explorer shows it: a numbered prefix
 * (`01-…`, `02-…`) sets a reading order, and titles starting with an emoji do
 * not scramble it.
 */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

function titleOfFolder(dir: string): string {
  const name = dir.split('/').pop() ?? dir;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
}
