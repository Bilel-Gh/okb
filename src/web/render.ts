import { posix } from 'node:path';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * Markdown → safe HTML for the web app. Notes are data: raw HTML in a note is
 * dropped, every attribute goes through a sanitizer, scripts never run. Links
 * between notes become in-app links, Obsidian callouts become boxes, Mermaid
 * code stays text that the page draws locally.
 */
type MdNode = { type: string; url?: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

const CALLOUT = /^\[!(\w+)\]([+-]?)\s*(.*)$/;

function remarkOkb(options: { from: string }) {
  return (tree: MdNode) => {
    visit(tree as never, 'link', (node: MdNode) => {
      const url = node.url ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return;
      const [path, anchor] = url.split('#');
      if (!path || !path.endsWith('.md')) return;
      const target = posix.normalize(posix.join(posix.dirname(options.from), decodeURI(path)));
      if (target.startsWith('..')) return;
      node.url = `#/note/${encodeURIComponent(target)}${anchor ? `::${encodeURIComponent(anchor)}` : ''}`;
    });
    visit(tree as never, 'blockquote', (node: MdNode) => {
      const first = node.children?.[0];
      const text = first?.type === 'paragraph' ? first.children?.[0] : undefined;
      if (!text || text.type !== 'text' || !text.value) return;
      const [line, ...rest] = text.value.split('\n');
      const m = line!.match(CALLOUT);
      if (!m) return;
      const kind = m[1]!.toLowerCase();
      const folded = m[2] === '-';
      text.value = rest.join('\n');
      const title: MdNode = { type: 'paragraph', children: [{ type: 'text', value: m[3] || kind }], data: { hName: folded ? 'summary' : 'div', hProperties: { className: ['callout-title'] } } };
      node.children = [title, ...(node.children ?? [])];
      node.data = { hName: folded ? 'details' : 'div', hProperties: { className: ['callout', `callout-${kind.replace(/[^a-z]/g, '')}`] } };
    });
  };
}

const schema = {
  ...defaultSchema,
  // remark-rehype already prefixes footnote ids; a second prefix would break their links.
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-[\w-]+$/]],
    details: ['open'],
  },
};

/** Remove the YAML frontmatter block that opens a note. */
export function bodyOf(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

export async function renderMarkdown(markdown: string, from = 'note.md'): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkOkb, { from })
    .use(remarkRehype)
    .use(rehypeSanitize, schema as never)
    .use(rehypeStringify)
    .process(bodyOf(markdown));
  return String(file);
}
