import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';
import type { OkbConfig, SourceKind } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { sha256, shortId } from '../util/hash.js';
import { codeAdapter } from './adapters/code.js';
import { docxAdapter } from './adapters/docx.js';
import { htmlAdapter } from './adapters/html.js';
import { markdownAdapter } from './adapters/markdown.js';
import { pdfAdapter } from './adapters/pdf.js';
import { vttAdapter } from './adapters/vtt.js';
import type { Acquired, Adapter, NormalizedDoc } from './types.js';

/** Order matters: the first adapter whose signature matches wins. */
export const ADAPTERS: readonly Adapter[] = [
  vttAdapter,
  pdfAdapter,
  docxAdapter,
  htmlAdapter,
  codeAdapter,
  markdownAdapter,
];

export function adapterFor(kind: SourceKind): Adapter | undefined {
  return ADAPTERS.find((a) => a.kind === kind);
}

export type SupportMatrixEntry = {
  readonly kind: SourceKind;
  readonly adapter: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly notes: string;
};

/** What the product actually claims to handle, printed by `okb doctor`. */
export function supportMatrix(config: OkbConfig): SupportMatrixEntry[] {
  const notes: Record<SourceKind, string> = {
    vtt: 'cues with timecodes and speaker attribution; no audio re-transcription',
    markdown: 'headings, paragraphs, lists, code and tables; OKF frontmatter recognised',
    html: 'heuristic boilerplate removal; JavaScript-rendered pages are not executed',
    pdf: 'text layer only; a scanned PDF reports "unsupported", no OCR is bundled',
    docx: 'body text via DOCX→HTML; comments, tracked changes and text boxes are skipped',
    code: 'source/config files read as text with line ranges and top-level symbols; nothing is executed or type-checked',
  };
  return ADAPTERS.map((a) => ({
    kind: a.kind,
    adapter: a.name,
    version: a.version,
    enabled: config.sources.enabled.includes(a.kind),
    notes: notes[a.kind],
  }));
}

export async function acquireFile(path: string, maxBytes = 20_000_000): Promise<Acquired> {
  const abs = resolve(path);
  let info;
  try {
    info = await stat(abs);
  } catch (cause) {
    throw new OkbError('E_NOT_FOUND', `source file not found: ${abs}`, { cause, detail: { path: abs } });
  }
  if (!info.isFile()) {
    throw new OkbError('E_INVALID', `source is not a regular file: ${abs}`, { detail: { path: abs } });
  }
  if (info.size > maxBytes) throw new OkbError('E_UNSUPPORTED', 'source exceeds configured size limit before acquisition');
  return { uri: pathToFileURL(abs).href, bytes: await readFile(abs), filename: basename(abs) };
}

export async function acquireUrl(url: string, config: OkbConfig): Promise<Acquired> {
  if (!config.connectors.web.enabled) {
    throw new OkbError('E_UNSUPPORTED', 'the web connector is disabled in this configuration', {
      detail: { url },
      hint: 'Enable it with `connectors.web.enabled: true` and list the domain in connectors.web.allowDomains.',
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new OkbError('E_INVALID', `not a valid URL: ${url}`, { cause });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new OkbError('E_UNSUPPORTED', `unsupported URL scheme: ${parsed.protocol}`, { detail: { url } });
  }
  const allow = config.connectors.web.allowDomains.map(d => d.toLowerCase());
  if (!allow.length) throw new OkbError('E_CONFIG', 'web access requires explicit connectors.web.allowDomains');
  const max = config.sources.limits.maxBytes;
  for (let hops = 0; hops <= 5; hops++) {
    const host = parsed.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || !allow.some(d => host === d || host.endsWith(`.${d}`))) {
      throw new OkbError('E_FORBIDDEN_PATH', `URL or redirect is outside the configured domain allow-list: ${host}`);
    }
    let response: Response;
    try { response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'okb/0.3' } }); }
    catch (cause) { throw new OkbError('E_EXTRACTION', 'page could not be fetched; no content assumed', { cause }); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new OkbError('E_EXTRACTION', 'redirect has no Location');
      parsed = new URL(location, parsed); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new OkbError('E_EXTRACTION', `page returned HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new OkbError('E_UNSUPPORTED', 'web source exceeds configured size limit'); }
    const reader = response.body?.getReader();
    if (!reader) throw new OkbError('E_EXTRACTION', 'page has no response body');
    const chunks: Uint8Array[] = []; let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        count += value.byteLength;
        if (count > max) { await reader.cancel(); throw new OkbError('E_UNSUPPORTED', 'web source exceeds configured size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return { uri: parsed.href, bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') ?? undefined, filename: basename(parsed.pathname) || undefined };
  }
  throw new OkbError('E_EXTRACTION', 'too many web redirects');
}

export async function acquire(uriOrPath: string, config: OkbConfig): Promise<Acquired> {
  return /^https?:\/\//i.test(uriOrPath)
    ? acquireUrl(uriOrPath, config)
    : acquireFile(uriOrPath.startsWith('file:') ? fileURLToPath(uriOrPath) : uriOrPath, config.sources.limits.maxBytes);
}

export type ExtractOptions = {
  /** Force a specific adapter instead of signature routing. */
  readonly kind?: SourceKind;
  readonly sourceId?: string;
};

export async function extractSource(
  input: Acquired,
  config: OkbConfig,
  options: ExtractOptions = {},
): Promise<NormalizedDoc> {
  if (input.bytes.byteLength > config.sources.limits.maxBytes) {
    throw new OkbError('E_UNSUPPORTED', 'source exceeds the configured size limit', {
      detail: { bytes: input.bytes.byteLength, limit: config.sources.limits.maxBytes },
      hint: 'Raise sources.limits.maxBytes, or split the source.',
    });
  }

  const adapter = options.kind
    ? adapterFor(options.kind)
    : ADAPTERS.find((a) => a.matches(input));

  if (!adapter) {
    throw new OkbError('E_UNSUPPORTED', `no adapter recognises this source`, {
      detail: {
        uri: input.uri,
        filename: input.filename,
        contentType: input.contentType,
        supported: ADAPTERS.map((a) => a.kind),
      },
      hint: 'Supported kinds: vtt, markdown/text, html, pdf (text layer), docx, code (source/config files as text).',
    });
  }
  if (!config.sources.enabled.includes(adapter.kind)) {
    throw new OkbError('E_UNSUPPORTED', `source kind "${adapter.kind}" is disabled`, {
      detail: { enabled: config.sources.enabled },
      hint: 'Add it to sources.enabled, unless the organisation policy forbids it.',
    });
  }

  const sourceId = options.sourceId ?? shortId(`${input.uri}:${sha256(input.bytes)}`);
  const extracted = await adapter.extract(input, sourceId);
  // Bound a single block as well as the number of blocks. No tail is discarded.
  const maxChars = Math.max(256, Math.min(4000, Math.floor(config.context.budgets.ingestOutputTokens * 1.2)));
  const blocks: import('./types.js').Block[] = [];
  for (const block of extracted.blocks) {
    const parts = Math.max(1, Math.ceil(block.text.length / maxChars));
    for (let part = 0; part < parts; part++) {
      const index = blocks.length;
      blocks.push({ ...block, id: `${sourceId}#${index}`, index, text: block.text.slice(part * maxChars, (part + 1) * maxChars), ...(parts > 1 ? { part: { index: part + 1, total: parts } } : {}) });
    }
  }
  const doc: NormalizedDoc = { ...extracted, source: { ...extracted.source, adapterVersion: `${extracted.source.adapterVersion}:bounded-1` }, blocks,
    outline: blocks.filter(b => b.kind === 'heading').map(b => ({ depth: b.section?.length ?? 1, text: b.text, blockId: b.id })) };


  if (doc.blocks.length > config.sources.limits.maxBlocks) {
    throw new OkbError('E_UNSUPPORTED', 'source produced more blocks than the configured limit', {
      detail: { blocks: doc.blocks.length, limit: config.sources.limits.maxBlocks },
    });
  }
  return doc;
}
