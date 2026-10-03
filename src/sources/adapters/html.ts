import { parse, type HTMLElement } from 'node-html-parser';
import { OkbError } from '../../util/errors.js';
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

const DROP = new Set([
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'svg',
  'iframe',
]);

const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'pre', 'blockquote', 'td', 'th', 'dd', 'dt', 'figcaption',
]);

/** Pick the densest plausible article container instead of the whole page chrome. */
function pickMain(root: HTMLElement): HTMLElement {
  const candidates = ['article', 'main', '[role=main]', '#content', '.content', '.post', 'body'];
  for (const selector of candidates) {
    const found = root.querySelector(selector);
    if (found && found.text.trim().length > 200) return found;
  }
  return root;
}

export function htmlToBlocks(
  html: string,
  sourceId: string,
  startIndex = 0,
): { blocks: Block[]; title?: string; limitations: string[] } {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false } });
  for (const tag of DROP) for (const el of root.querySelectorAll(tag)) el.remove();

  const title =
    root.querySelector('title')?.text.trim() ||
    root.querySelector('h1')?.text.trim() ||
    undefined;

  const main = pickMain(root);
  const blocks: Block[] = [];
  const limitations: string[] = [];
  const section: string[] = [];
  let index = startIndex;

  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      const node = child as HTMLElement;
      if (typeof node.tagName !== 'string') continue;
      const tag = node.tagName.toLowerCase();
      if (DROP.has(tag)) continue;

      if (BLOCK_TAGS.has(tag)) {
        const text = normalizeWhitespace(node.text);
        if (text === '') continue;
        if (/^h[1-6]$/.test(tag)) {
          const depth = Number.parseInt(tag.slice(1), 10);
          section.length = Math.max(0, depth - 1);
          section[depth - 1] = text;
          blocks.push(
            makeBlock(sourceId, index++, 'heading', text, {
              kind: 'section',
              path: [...section].filter(Boolean),
            }, { section: [...section].filter(Boolean) }),
          );
          continue;
        }
        const kind =
          tag === 'pre' ? 'code' : tag === 'blockquote' ? 'quote' : tag === 'li' ? 'list-item' : tag === 'td' || tag === 'th' ? 'table' : 'paragraph';
        blocks.push(
          makeBlock(sourceId, index++, kind, text, {
            kind: 'section',
            path: [...section].filter(Boolean),
          }, { section: [...section].filter(Boolean) }),
        );
        continue;
      }
      walk(node);
    }
  };

  walk(main);
  if (blocks.length === 0) limitations.push('no textual block survived boilerplate removal');
  return { blocks, ...(title ? { title } : {}), limitations };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export const htmlAdapter: Adapter = {
  name: 'html',
  version: '1',
  kind: 'html',

  matches(input: Acquired): boolean {
    if (/\.(html?|xhtml)$/i.test(input.filename ?? '')) return true;
    if ((input.contentType ?? '').includes('html')) return true;
    const head = Buffer.from(input.bytes.slice(0, 256)).toString('utf8').toLowerCase();
    return head.includes('<!doctype html') || head.includes('<html');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    const html = Buffer.from(input.bytes).toString('utf8');
    if (html.trim() === '') {
      throw new OkbError('E_EXTRACTION', 'the fetched document is empty', {
        detail: { uri: input.uri },
      });
    }
    const { blocks, title, limitations } = htmlToBlocks(html, sourceId);
    limitations.push('boilerplate removal is heuristic; a sidebar may survive or a figure may be dropped');

    const source: SourceRecord = {
      id: sourceId,
      uri: input.uri,
      kind: 'html',
      adapter: htmlAdapter.name,
      adapterVersion: htmlAdapter.version,
      sha256: sha256(input.bytes),
      bytes: input.bytes.byteLength,
      acquiredAt: new Date().toISOString(),
      support: blocks.length === 0 ? 'unsupported' : 'partial',
      limitations,
      ...(title ? { title } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };

    return { source, blocks, outline: buildOutline(blocks) };
  },
};
