import { OkbError } from '../../util/errors.js';
import { sha256 } from '../../util/hash.js';
import {
  buildOutline,
  type Acquired,
  type Adapter,
  type NormalizedDoc,
  type SourceRecord,
} from '../types.js';
import { htmlToBlocks } from './html.js';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export const docxAdapter: Adapter = {
  name: 'docx',
  version: '1',
  kind: 'docx',

  matches(input: Acquired): boolean {
    if (/\.docx$/i.test(input.filename ?? '')) return true;
    return ZIP_MAGIC.every((b, i) => input.bytes[i] === b) &&
      (input.contentType ?? '').includes('wordprocessingml');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    if (!ZIP_MAGIC.every((b, i) => input.bytes[i] === b)) {
      throw new OkbError('E_EXTRACTION', 'file is not a DOCX container (missing ZIP header)', {
        detail: { uri: input.uri },
        hint: 'Legacy .doc is a different, unsupported format — save as .docx first.',
      });
    }

    let html: string;
    let messages: { message?: string }[] = [];
    try {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.convertToHtml({ buffer: Buffer.from(input.bytes) });
      html = result.value;
      messages = result.messages ?? [];
    } catch (cause) {
      throw new OkbError('E_EXTRACTION', 'the DOCX could not be converted', {
        cause,
        detail: { uri: input.uri },
      });
    }

    // DOCX conversion yields HTML, so block extraction is shared with the HTML adapter.
    const { blocks, title, limitations } = htmlToBlocks(`<body>${html}</body>`, sourceId);
    for (const m of messages.slice(0, 10)) {
      if (m.message) limitations.push(`converter notice: ${m.message}`);
    }
    limitations.push('comments, tracked changes, headers/footers and floating text boxes are not extracted');

    const source: SourceRecord = {
      id: sourceId,
      uri: input.uri,
      kind: 'docx',
      adapter: docxAdapter.name,
      adapterVersion: docxAdapter.version,
      sha256: sha256(input.bytes),
      bytes: input.bytes.byteLength,
      acquiredAt: new Date().toISOString(),
      support: blocks.length === 0 ? 'unsupported' : 'partial',
      limitations,
      ...(title ? { title } : input.filename ? { title: input.filename.replace(/\.docx$/i, '') } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };

    return { source, blocks, outline: buildOutline(blocks) };
  },
};
