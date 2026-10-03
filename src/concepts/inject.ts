import {
  extractLinks,
  isProtected,
  mergeSpans,
  protectedSpans,
  sectionWindows,
  type Span,
} from '../markdown/ast.js';
import { parseOkf } from '../okf/document.js';
import { hasLinked } from '../okf/extensions.js';
import { classifyLink, markdownLink } from '../links/portable.js';
import type { BundlePath } from '../util/paths.js';

export type LinkTarget = {
  readonly surfaces: readonly string[];
  readonly canonical: string;
  readonly target: BundlePath;
  /** Id of the change that creates the target, when it does not exist yet. */
  readonly dependsOn?: string;
};

export type LinkInsertion = {
  readonly file: BundlePath;
  /** Offsets in the *full* file text, frontmatter included. */
  readonly span: Span;
  readonly original: string;
  readonly replacement: string;
  readonly canonical: string;
  readonly target: BundlePath;
  readonly section: string;
  readonly linkKey: string;
  readonly dependsOn?: string;
};

export type InjectLimits = {
  readonly maxLinksPerDocument: number;
  readonly maxLinksPerTermPerSection: number;
  readonly explicitDotSlash?: boolean;
};

export type InjectReport = {
  readonly insertions: readonly LinkInsertion[];
  readonly skipped: readonly { term: string; reason: string }[];
};

const SOURCE_SECTION_TITLES = [
  'sources',
  'source',
  'références',
  'references',
  'citations',
  'bibliographie',
  'verbatim',
];

/**
 * Plan link insertions without touching anything else.
 *
 * The planner only *locates* character ranges; the caller splices the original
 * text. Code fences, existing links, block quotes, footnote definitions and the
 * sources section are hard exclusions, so verbatim material is never rewritten.
 */
export function planLinkInjection(
  filePath: BundlePath,
  fileText: string,
  targets: readonly LinkTarget[],
  limits: InjectLimits,
): InjectReport {
  const insertions: LinkInsertion[] = [];
  const skipped: { term: string; reason: string }[] = [];
  if (limits.maxLinksPerDocument <= 0 || targets.length === 0) {
    return { insertions, skipped: targets.map((t) => ({ term: t.canonical, reason: 'limit is zero' })) };
  }

  let body = fileText;
  let base = 0;
  let already: (key: string) => boolean = () => false;
  try {
    const doc = parseOkf(filePath, fileText);
    body = doc.body;
    base = doc.bodyOffset;
    already = (key: string) => hasLinked(doc.data, key);
  } catch {
    // An unparseable frontmatter is reported elsewhere; link planning still works on raw text.
  }

  const forbidden = mergeSpans([
    ...protectedSpans(body, {
      protectBlockquotes: true,
      protectSectionsTitled: SOURCE_SECTION_TITLES,
    }),
  ]);
  const sections = sectionWindows(body);
  const perSection = new Map<string, number>();
  const taken: Span[] = [];
  for (const link of extractLinks(body)) {
    const c = classifyLink(link.url, filePath);
    if (c.kind !== 'internal') continue;
    const section = sections.find(s => link.span.start >= s.span.start && link.span.start < s.span.end);
    const key = `${c.target}@${section?.span.start ?? 0}`;
    perSection.set(key, (perSection.get(key) ?? 0) + 1);
  }

  // Longest surface first: "Delivery Routing Exchange" must win over "Delivery".
  const ordered = targets
    .flatMap((t) => t.surfaces.map((surface) => ({ ...t, surface })))
    .sort((a, b) => b.surface.length - a.surface.length);

  for (const item of ordered) {
    if (insertions.length >= limits.maxLinksPerDocument) {
      skipped.push({ term: item.canonical, reason: 'maxLinksPerDocument reached' });
      continue;
    }
    if (item.target === filePath) {
      skipped.push({ term: item.canonical, reason: 'a document does not link to itself' });
      continue;
    }
    const linkKey = `${item.canonical}@${item.target}`;


    const re = surfaceRegex(item.surface);
    let placed = false;
    for (const match of body.matchAll(re)) {
      const start = match.index! + match[1]!.length;
      const end = start + match[2]!.length;
      if (isProtected(forbidden, start, end)) continue;
      if (isProtected(taken, start, end)) continue;

      const section = sections.find((s) => start >= s.span.start && start < s.span.end);
      const sectionKey = `${item.target}@${section?.span.start ?? 0}`;
      if ((perSection.get(sectionKey) ?? 0) >= limits.maxLinksPerTermPerSection) continue;

      const original = body.slice(start, end);
      insertions.push({
        file: filePath,
        span: { start: start + base, end: end + base },
        original,
        replacement: markdownLink(filePath, item.target, original, {
          ...(limits.explicitDotSlash ? { explicitDotSlash: true } : {}),
        }),
        canonical: item.canonical,
        target: item.target,
        section: section?.heading ?? '',
        linkKey,
        ...(item.dependsOn ? { dependsOn: item.dependsOn } : {}),
      });
      perSection.set(sectionKey, (perSection.get(sectionKey) ?? 0) + 1);
      taken.push({ start, end });
      placed = true;
      if (insertions.length >= limits.maxLinksPerDocument) break;
    }
    if (!placed) skipped.push({ term: item.canonical, reason: 'no unprotected occurrence found' });
  }

  insertions.sort((a, b) => a.span.start - b.span.start);
  return { insertions, skipped };
}

function surfaceRegex(surface: string): RegExp {
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`([^\\p{L}\\p{N}_]|^)(${escaped})(?=[^\\p{L}\\p{N}_]|$)`, 'giu');
}

/** Render a "Prérequis utiles" section, ready to be appended after the intro. */
export function renderPrereqSection(
  filePath: BundlePath,
  items: readonly { path: BundlePath; title: string }[],
  heading = 'Prérequis utiles',
): string {
  if (items.length === 0) return '';
  const lines = items.map((it, i) => `${i + 1}. ${markdownLink(filePath, it.path, it.title)}`);
  return `# ${heading}\n\n${lines.join('\n')}\n`;
}
