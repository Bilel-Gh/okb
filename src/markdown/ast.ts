import type { Root, RootContent, Heading } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export type { Root, RootContent, Heading };

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(body: string): Root {
  return processor.parse(body) as Root;
}

export type Span = { start: number; end: number };

export type LinkRef = {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
  readonly span: Span;
  readonly line: number;
  readonly kind: 'inline' | 'image' | 'definition' | 'autolink';
};

export function extractLinks(body: string): LinkRef[] {
  const tree = parseMarkdown(body);
  const out: LinkRef[] = [];
  visit(tree, (node: any) => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return;
    const pos = node.position;
    if (pos?.start?.offset === undefined || pos?.end?.offset === undefined) return;
    const raw = body.slice(pos.start.offset, pos.end.offset);
    out.push({
      url: String(node.url ?? ''),
      title: node.title ?? null,
      text: node.type === 'definition' ? String(node.label ?? '') : textOf(node),
      span: { start: pos.start.offset, end: pos.end.offset },
      line: pos.start.line,
      kind:
        node.type === 'image'
          ? 'image'
          : node.type === 'definition'
            ? 'definition'
            : raw.startsWith('<')
              ? 'autolink'
              : 'inline',
    });
  });
  return out.sort((a, b) => a.span.start - b.span.start);
}

export function textOf(node: any): string {
  if (node == null) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
}

/**
 * Character ranges that must never be rewritten: code, existing links, verbatim
 * quotes, raw HTML, footnote definitions, YAML-ish tables of sources.
 *
 * Callers splice the *original* string using these ranges, so nothing outside an
 * approved edit is reformatted.
 */
export function protectedSpans(body: string, options: ProtectOptions = {}): Span[] {
  const tree = parseMarkdown(body);
  const spans: Span[] = [];
  const protectedTypes = new Set([
    'code',
    'heading',
    'inlineCode',
    'link',
    'linkReference',
    'image',
    'imageReference',
    'definition',
    'footnoteDefinition',
    'footnoteReference',
    'html',
    'yaml',
    'math',
    'inlineMath',
  ]);
  if (options.protectBlockquotes !== false) protectedTypes.add('blockquote');

  visit(tree, (node: any) => {
    if (!protectedTypes.has(node.type)) return;
    const pos = node.position;
    if (pos?.start?.offset === undefined || pos?.end?.offset === undefined) return;
    spans.push({ start: pos.start.offset, end: pos.end.offset });
  });

  for (const heading of options.protectSectionsTitled ?? []) {
    spans.push(...sectionSpansByHeading(body, tree, heading));
  }

  return mergeSpans(spans);
}

export type ProtectOptions = {
  protectBlockquotes?: boolean;
  /** Case-insensitive heading texts whose whole section is off-limits. */
  protectSectionsTitled?: readonly string[];
};

function sectionSpansByHeading(body: string, tree: Root, headingText: string): Span[] {
  const needle = headingText.trim().toLowerCase();
  const out: Span[] = [];
  const children = tree.children;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    if (node.type !== 'heading') continue;
    if (textOf(node).trim().toLowerCase() !== needle) continue;
    const start = node.position?.start?.offset;
    if (start === undefined) continue;
    let end = body.length;
    for (let j = i + 1; j < children.length; j += 1) {
      const next = children[j]!;
      if (next.type === 'heading' && (next as Heading).depth <= (node as Heading).depth) {
        end = next.position?.start?.offset ?? body.length;
        break;
      }
    }
    out.push({ start, end });
  }
  return out;
}

export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export function isProtected(spans: readonly Span[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

export type SectionWindow = {
  /** Heading text, or '' for the preamble before the first heading. */
  readonly heading: string;
  readonly depth: number;
  readonly span: Span;
};

/** Top-level section windows, used to cap "one link per term per section". */
export function sectionWindows(body: string): SectionWindow[] {
  const tree = parseMarkdown(body);
  const headings = tree.children.filter((n): n is Heading => n.type === 'heading');
  if (headings.length === 0) {
    return [{ heading: '', depth: 0, span: { start: 0, end: body.length } }];
  }
  const out: SectionWindow[] = [];
  const firstStart = headings[0]!.position?.start?.offset ?? 0;
  if (firstStart > 0) out.push({ heading: '', depth: 0, span: { start: 0, end: firstStart } });
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!;
    const start = h.position?.start?.offset ?? 0;
    const end = headings[i + 1]?.position?.start?.offset ?? body.length;
    out.push({ heading: textOf(h).trim(), depth: h.depth, span: { start, end } });
  }
  return out;
}

export type Edit = { start: number; end: number; replacement: string };

/** Apply non-overlapping edits right-to-left so earlier offsets stay valid. */
export function applyEdits(body: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = body;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of sorted) {
    if (e.end > lastStart) throw new Error('overlapping edits');
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

/** GitHub-flavoured heading slug, used to validate `#anchor` targets. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function headingSlugs(body: string): Set<string> {
  const tree = parseMarkdown(body);
  const counts = new Map<string, number>();
  const out = new Set<string>();
  visit(tree, 'heading', (node: any) => {
    const base = headingSlug(textOf(node));
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  });
  return out;
}
