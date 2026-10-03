import { parseMarkdown, textOf } from '../../markdown/ast.js';
import { parseOkf } from '../../okf/document.js';
import { sha256 } from '../../util/hash.js';
import {
  buildOutline,
  makeBlock,
  type Acquired,
  type Adapter,
  type Block,
  type NormalizedDoc,
  type SourceRecord,
} from '../types.js';

const MD_EXT = /\.(md|markdown|mdx|txt|text)$/i;

export const markdownAdapter: Adapter = {
  name: 'markdown',
  version: '3',
  kind: 'markdown',

  matches(input: Acquired): boolean {
    if (MD_EXT.test(input.filename ?? '')) return true;
    return (input.contentType ?? '').startsWith('text/');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    const raw = Buffer.from(input.bytes).toString('utf8');
    const limitations: string[] = [];

    let body = raw;
    let title: string | undefined;
    let frontmatterLines = 0;
    try {
      const doc = parseOkf('source.md', raw);
      if (doc.hasFrontmatter) {
        body = doc.body;
        frontmatterLines = raw.slice(0, doc.bodyOffset).split('\n').length - 1;
        if (typeof doc.data.title === 'string') title = doc.data.title;
        // Skills and agents name themselves in frontmatter; their first H1 is
        // often an inner section such as "Output", which would mislabel citations.
        else if (typeof doc.data.name === 'string') title = doc.data.name;
      }
    } catch {
      limitations.push('a frontmatter block was present but could not be parsed; treated as body text');
    }

    const tree = parseMarkdown(body);
    const blocks: Block[] = [];
    const section: string[] = [];
    let index = 0;

    for (const node of tree.children) {
      const line = (node.position?.start?.line ?? 1) + frontmatterLines;
      if (node.type === 'heading') {
        const text = textOf(node).trim();
        section.length = Math.max(0, node.depth - 1);
        section[node.depth - 1] = text;
        if (!title && node.depth === 1) title = text;
        blocks.push(
          makeBlock(sourceId, index++, 'heading', text, { kind: 'section', path: [...section].filter(Boolean), line }, {
            section: [...section].filter(Boolean),
          }),
        );
        continue;
      }
      if (node.type === 'code') {
        const value = (node as { value?: string }).value ?? '';
        if (value.trim() === '') continue;
        blocks.push(
          makeBlock(sourceId, index++, 'code', value, { kind: 'section', path: [...section].filter(Boolean), line }, {
            section: [...section].filter(Boolean),
          }),
        );
        continue;
      }
      if (node.type === 'list') {
        for (const item of (node as { children?: unknown[] }).children ?? []) {
          const text = textOf(item).trim();
          if (!text) continue;
          const itemLine = ((item as { position?: { start?: { line?: number } } }).position?.start?.line ?? line) + frontmatterLines;
          blocks.push(
            makeBlock(sourceId, index++, 'list-item', text, { kind: 'section', path: [...section].filter(Boolean), line: itemLine }, {
              section: [...section].filter(Boolean),
            }),
          );
        }
        continue;
      }
      const kind =
        node.type === 'blockquote' ? 'quote' : node.type === 'table' ? 'table' : 'paragraph';
      // Table cells keep a visible separator: "a | b", one row per line.
      const text = (node.type === 'table' ? tableText(node) : textOf(node)).trim();
      if (text === '') continue;
      blocks.push(
        makeBlock(sourceId, index++, kind, text, { kind: 'section', path: [...section].filter(Boolean), line }, {
          section: [...section].filter(Boolean),
        }),
      );
    }

    if (blocks.length === 0) limitations.push('the document contained no textual block');

    const source: SourceRecord = {
      id: sourceId,
      uri: input.uri,
      kind: 'markdown',
      adapter: markdownAdapter.name,
      adapterVersion: markdownAdapter.version,
      sha256: sha256(input.bytes),
      bytes: input.bytes.byteLength,
      acquiredAt: new Date().toISOString(),
      support: blocks.length === 0 ? 'unsupported' : limitations.length > 0 ? 'partial' : 'full',
      limitations,
      ...(title ? { title } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };

    return { source, blocks, outline: buildOutline(blocks) };
  },
};

function tableText(table: unknown): string {
  const rows = (table as { children?: { children?: unknown[] }[] }).children ?? [];
  return rows.map((row) => (row.children ?? []).map((cell) => textOf(cell).trim()).join(' | ')).join('\n');
}
