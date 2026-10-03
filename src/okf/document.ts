import { basename } from 'node:path';
import YAML from 'yaml';
import { OkbError } from '../util/errors.js';
import { readText, writeTextAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';
import { RESERVED_FILENAMES, type OkfFrontmatter } from './types.js';

export type OkfDocument = {
  /** Path inside the bundle, POSIX, no leading slash. */
  readonly path: BundlePath;
  /** Concept ID per spec §2: the path minus `.md`. */
  readonly conceptId: string;
  readonly raw: string;
  readonly sha256: string;
  readonly hasFrontmatter: boolean;
  readonly frontmatterRaw: string;
  readonly body: string;
  /** Offset of the first body character inside `raw`; link splicing relies on it. */
  readonly bodyOffset: number;
  readonly data: OkfFrontmatter;
  readonly eol: '\n' | '\r\n';
  readonly reserved: boolean;
};

const FM_OPEN = /^\uFEFF?---\r?\n/;

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function isReservedFilename(path: string): boolean {
  return (RESERVED_FILENAMES as readonly string[]).includes(basename(path));
}

/**
 * Split a markdown file into frontmatter + body without reformatting either.
 * The body is handed back byte-identical so downstream edits can splice it.
 */
export function parseOkf(path: string, raw: string): OkfDocument {
  const bundlePath = asBundlePath(path);
  const eol = detectEol(raw);
  const reserved = isReservedFilename(bundlePath);

  const open = FM_OPEN.exec(raw);
  if (!open) {
    return {
      path: bundlePath,
      conceptId: bundlePath.replace(/\.md$/, ''),
      raw,
      sha256: sha256(raw),
      hasFrontmatter: false,
      frontmatterRaw: '',
      body: raw,
      bodyOffset: 0,
      data: {},
      eol,
      reserved,
    };
  }

  const afterOpen = open[0].length;
  const closeRe = /\r?\n---[ \t]*(?:\r?\n|$)/g;
  closeRe.lastIndex = afterOpen;
  const close = closeRe.exec(raw);
  if (!close) {
    throw new OkbError('E_INVALID', `unterminated YAML frontmatter in ${bundlePath}`, {
      detail: { path: bundlePath },
      hint: 'A frontmatter block opened with `---` must be closed with `---` on its own line.',
    });
  }

  const frontmatterRaw = raw.slice(afterOpen, close.index);
  const bodyOffset = close.index + close[0].length;
  const body = raw.slice(bodyOffset);

  let data: OkfFrontmatter;
  try {
    data = (YAML.parse(frontmatterRaw, { version: '1.2' }) as OkfFrontmatter) ?? {};
  } catch (cause) {
    throw new OkbError('E_INVALID', `malformed YAML frontmatter in ${bundlePath}`, {
      cause,
      detail: { path: bundlePath },
    });
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new OkbError('E_INVALID', `frontmatter of ${bundlePath} is not a mapping`, {
      detail: { path: bundlePath },
    });
  }

  return {
    path: bundlePath,
    conceptId: bundlePath.replace(/\.md$/, ''),
    raw,
    sha256: sha256(raw),
    hasFrontmatter: true,
    frontmatterRaw,
    body,
    bodyOffset,
    data,
    eol,
    reserved,
  };
}

export async function readOkf(root: string, path: string): Promise<OkfDocument> {
  const abs = bundlePathToAbsolute(root, path);
  return parseOkf(asBundlePath(path), await readText(abs));
}

/**
 * Re-emit frontmatter.
 *
 * `yaml`'s round-trip document keeps comments, key order and unknown keys. We
 * only touch the keys that actually changed, so an untouched file re-serializes
 * byte-for-byte.
 */
export function serializeOkf(doc: OkfDocument, nextData?: OkfFrontmatter): string {
  const data = nextData ?? doc.data;

  // Nothing changed: hand back the original bytes rather than a re-rendered copy.
  if (nextData === undefined || deepEqual(doc.data, data)) return doc.raw;
  if (!doc.hasFrontmatter && Object.keys(data).length === 0) return doc.body;

  let yamlText: string;
  if (doc.hasFrontmatter) {
    const parsed = YAML.parseDocument(doc.frontmatterRaw, { version: '1.2' });
    const before = YAML.parse(doc.frontmatterRaw, { version: '1.2' }) ?? {};
    applyPatch(parsed, before as Record<string, unknown>, data as Record<string, unknown>);
    yamlText = parsed.toString(YAML_OUT).replace(/\n$/, '');
  } else {
    yamlText = YAML.stringify(data, YAML_OUT).replace(/\n$/, '');
  }

  const nl = doc.eol;
  return `---${nl}${yamlText.split('\n').join(nl)}${nl}---${nl}${doc.body}`;
}

/** `flowCollectionPadding: false` keeps `[a, b]` instead of turning it into `[ a, b ]`. */
const YAML_OUT = { lineWidth: 0, flowCollectionPadding: false } as const;

function applyPatch(
  target: YAML.Document.Parsed,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  for (const key of Object.keys(after)) {
    if (!deepEqual(before[key], after[key])) target.set(key, after[key]);
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) target.delete(key);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export async function writeOkf(
  root: string,
  doc: OkfDocument,
  nextData?: OkfFrontmatter,
): Promise<void> {
  await writeTextAtomic(bundlePathToAbsolute(root, doc.path), serializeOkf(doc, nextData));
}

/** Replace the body while keeping the frontmatter block untouched. */
export function withBody(doc: OkfDocument, body: string): OkfDocument {
  const raw = doc.hasFrontmatter ? doc.raw.slice(0, doc.bodyOffset) + body : body;
  return { ...doc, raw, body, sha256: sha256(raw) };
}
