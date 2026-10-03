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

const PDF_MAGIC = '%PDF-';

/** Below this, a page is treated as having no text layer rather than as text. */
const MIN_CHARS_PER_PAGE = 12;

export const pdfAdapter: Adapter = {
  name: 'pdf',
  version: '1',
  kind: 'pdf',

  matches(input: Acquired): boolean {
    const head = Buffer.from(input.bytes.slice(0, 8)).toString('latin1');
    return head.startsWith(PDF_MAGIC) || /\.pdf$/i.test(input.filename ?? '');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    const head = Buffer.from(input.bytes.slice(0, 8)).toString('latin1');
    if (!head.startsWith(PDF_MAGIC)) {
      throw new OkbError('E_EXTRACTION', 'file does not carry the %PDF- signature', {
        detail: { uri: input.uri },
      });
    }

    let pages: string[];
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const proxy = await getDocumentProxy(new Uint8Array(input.bytes));
      const result = await extractText(proxy, { mergePages: false });
      pages = (result.text as unknown as string[]) ?? [];
    } catch (cause) {
      throw new OkbError('E_EXTRACTION', 'the PDF could not be parsed', {
        cause,
        detail: { uri: input.uri },
        hint: 'The file may be encrypted, truncated or not a real PDF.',
      });
    }

    const blocks: Block[] = [];
    const limitations: string[] = [];
    const emptyPages: number[] = [];
    let index = 0;

    for (const [i, pageText] of pages.entries()) {
      const page = i + 1;
      const cleaned = (pageText ?? '').replace(/\u0000/g, '').trim();
      if (cleaned.length < MIN_CHARS_PER_PAGE) {
        emptyPages.push(page);
        continue;
      }
      for (const para of cleaned.split(/\n\s*\n+/)) {
        const text = para.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
        if (text === '') continue;
        blocks.push(makeBlock(sourceId, index++, 'paragraph', text, { kind: 'page', page }));
      }
    }

    if (emptyPages.length > 0) {
      limitations.push(
        `page(s) ${summarizeRanges(emptyPages)} carry no extractable text layer (likely scanned images); no OCR is bundled, so their content is absent — not empty`,
      );
    }
    if (blocks.length === 0) {
      limitations.push('no page carried an extractable text layer');
      const source = makeSource(input, sourceId, 'unsupported', limitations, pages.length);
      return { source, blocks, outline: [] };
    }
    limitations.push('reading order and column handling follow the PDF text layer, which can differ from the visual layout');

    const support = emptyPages.length > 0 ? 'partial' : 'full';
    return {
      source: makeSource(input, sourceId, support, limitations, pages.length),
      blocks,
      outline: buildOutline(blocks),
    };
  },
};

function makeSource(
  input: Acquired,
  sourceId: string,
  support: SourceRecord['support'],
  limitations: string[],
  pageCount: number,
): SourceRecord {
  return {
    id: sourceId,
    uri: input.uri,
    kind: 'pdf',
    adapter: pdfAdapter.name,
    adapterVersion: pdfAdapter.version,
    sha256: sha256(input.bytes),
    bytes: input.bytes.byteLength,
    acquiredAt: new Date().toISOString(),
    support,
    limitations: [...limitations, `${pageCount} page(s) seen`],
    ...(input.filename ? { title: input.filename.replace(/\.pdf$/i, '') } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
  };
}

function summarizeRanges(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}
