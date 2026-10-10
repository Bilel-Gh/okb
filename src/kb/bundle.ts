import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bodyFacts } from '../markdown/ast.js';
import { parseOkf, type OkfDocument } from '../okf/document.js';
import { getExtension, type OkbExtension } from '../okf/extensions.js';
import { effectiveStatus, trustTier, type TrustTier } from '../okf/types.js';
import { readText, walkFiles } from '../util/fsx.js';
import { asBundlePath, matchesAny, type BundlePath } from '../util/paths.js';
import { snapshotFromEntries, type BundleSnapshot } from '../links/check.js';
import { OkbError } from '../util/errors.js';

export type KbEntry = {
  readonly path: BundlePath;
  readonly conceptId: string;
  readonly reserved: boolean;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly status: 'draft' | 'stable' | 'deprecated';
  readonly trust: TrustTier;
  readonly sha256: string;
  readonly ext: OkbExtension;
  readonly headings: readonly string[];
  readonly anchors: ReadonlySet<string>;
  readonly bodyLength: number;
};

export type Bundle = {
  readonly root: string;
  readonly snapshot: BundleSnapshot;
  readonly docs: ReadonlyMap<BundlePath, OkfDocument>;
  readonly entries: readonly KbEntry[];
  readonly byPath: ReadonlyMap<BundlePath, KbEntry>;
  /** Files that could not be parsed, kept visible instead of silently skipped. */
  readonly unreadable: readonly { path: string; reason: string }[];
};

/**
 * How a KB is read (F2.0-22). Each root keeps what it last read: per file, a
 * stamp (inode, size, change and modification times) and the parsed note. A
 * new read lists the files and stats them, then reads again only the files
 * whose stamp changed; if nothing changed, the same Bundle object comes back,
 * so indexes and views derived from it stay valid. A file changed less than
 * SETTLE_MS before it was stamped is re-read every time until it settles:
 * file systems with coarse timestamps can give two quick writes the same one.
 * `fresh` reads every file again (the apply checks), reusing a parse only when
 * the text is the same.
 */
type Parsed = { readonly text: string; readonly doc: OkfDocument | null; readonly entry: KbEntry | null; readonly error: string | null };
type Slot = { readonly stamp: string; readonly settled: boolean; readonly parsed: Promise<Parsed> };
type View = { readonly bundle: Bundle; readonly parts: ReadonlyMap<string, Parsed | null> };
type RootCache = { readonly files: Map<string, Promise<Slot>>; readonly views: Map<string, View> };

const SETTLE_MS = 2000;
const MAX_ROOTS = 8;
const roots = new Map<string, RootCache>();

/** True when a file stamped at `seenAt` cannot share its stamp with a later write. */
export function isSettled(st: { mtimeMs: number; ctimeMs: number }, seenAt: number): boolean {
  return seenAt - Math.max(st.mtimeMs, st.ctimeMs) > SETTLE_MS;
}

function cacheFor(absRoot: string): RootCache {
  let hit = roots.get(absRoot);
  if (hit) {
    roots.delete(absRoot);
  } else {
    hit = { files: new Map(), views: new Map() };
    if (roots.size >= MAX_ROOTS) roots.delete(roots.keys().next().value!);
  }
  roots.set(absRoot, hit);
  return hit;
}

function parse(rel: string, text: string): Parsed {
  try {
    const doc = parseOkf(rel, text);
    return { text, doc, entry: toEntry(doc), error: null };
  } catch (error) {
    return { text, doc: null, entry: null, error: (error as Error).message };
  }
}

async function readSlot(abs: string, rel: string, previous: Slot | undefined, fresh: boolean): Promise<Slot> {
  let st;
  try {
    st = await stat(abs, { bigint: true });
  } catch (cause) {
    throw new OkbError('E_IO', `cannot read ${rel}`, { cause });
  }
  const seenAt = Date.now();
  const stamp = `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  if (!fresh && previous && previous.settled && previous.stamp === stamp) return previous;
  const settled = isSettled({ mtimeMs: Number(st.mtimeMs), ctimeMs: Number(st.ctimeMs) }, seenAt);
  const parsed = (async () => {
    const text = await readText(abs);
    const before = previous ? await previous.parsed.catch(() => null) : null;
    return before && before.text === text ? before : parse(rel, text);
  })();
  return { stamp, settled, parsed };
}

export async function loadBundle(
  root: string,
  options: { exclude?: readonly string[]; fresh?: boolean } = {},
): Promise<Bundle> {
  const absRoot = resolve(root);
  const exclude = options.exclude ?? [];
  const cache = cacheFor(absRoot);
  const allFiles = (await walkFiles(absRoot)).filter(f => !matchesAny(f, exclude));
  const files = allFiles.filter(f => f.endsWith('.md'));
  // Each file's reading waits for the one already under way, then checks its
  // own stamp: requests that arrive together share one parse of each note.
  const slots = await Promise.all(files.map((rel) => {
    const before = cache.files.get(rel);
    const slot = (async () => readSlot(resolve(absRoot, rel), rel, before ? await before.catch(() => undefined) : undefined, options.fresh === true))();
    cache.files.set(rel, slot);
    return slot;
  }));
  const parsed = await Promise.all(slots.map((s) => s.parsed));

  const viewKey = JSON.stringify(exclude);
  const parts = new Map<string, Parsed | null>(allFiles.map((f) => [f, null]));
  files.forEach((rel, i) => parts.set(rel, parsed[i]!));
  const previous = cache.views.get(viewKey);
  if (previous && sameParts(previous.parts, parts)) return previous.bundle;
  const live = new Set(allFiles);
  for (const rel of cache.files.keys()) if (!live.has(rel) && !anyViewHolds(cache, viewKey, rel)) cache.files.delete(rel);

  const snapshotEntries: [string, string][] = allFiles.filter(f => !f.endsWith('.md')).map(f => [f, '']);
  const docs = new Map<BundlePath, OkfDocument>();
  const entries: KbEntry[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  files.forEach((rel, i) => {
    const part = parsed[i]!;
    snapshotEntries.push([rel, part.text]);
    if (part.error !== null || !part.doc || !part.entry) {
      unreadable.push({ path: rel, reason: part.error ?? 'unreadable' });
      return;
    }
    docs.set(part.doc.path, part.doc);
    entries.push(part.entry);
  });

  const byPath = new Map(entries.map((e) => [e.path, e]));
  const bundle: Bundle = {
    root: absRoot,
    snapshot: snapshotFromEntries(snapshotEntries),
    docs,
    entries,
    byPath,
    unreadable,
  };
  cache.views.set(viewKey, { bundle, parts });
  return bundle;
}

function sameParts(a: ReadonlyMap<string, Parsed | null>, b: ReadonlyMap<string, Parsed | null>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) {
    if (!a.has(k) || a.get(k) !== v) return false;
  }
  return true;
}

function anyViewHolds(cache: RootCache, except: string, rel: string): boolean {
  for (const [key, view] of cache.views) if (key !== except && view.parts.has(rel)) return true;
  return false;
}

function toEntry(doc: OkfDocument): KbEntry {
  const fm = doc.data;
  const facts = bodyFacts(doc.body);
  return {
    path: doc.path,
    conceptId: doc.conceptId,
    reserved: doc.reserved,
    type: typeof fm.type === 'string' ? fm.type : '',
    title: typeof fm.title === 'string' ? fm.title : deriveTitle(doc),
    description: typeof fm.description === 'string' ? fm.description : '',
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status: effectiveStatus(fm),
    trust: trustTier(fm),
    sha256: doc.sha256,
    ext: getExtension(fm),
    headings: facts.topHeadings,
    anchors: facts.anchors,
    bodyLength: doc.body.length,
  };
}

function deriveTitle(doc: OkfDocument): string {
  const first = /^\s*#\s+(.+)$/m.exec(doc.body);
  if (first) return first[1]!.trim();
  return doc.path.split('/').pop()!.replace(/\.md$/, '').replace(/-/g, ' ');
}

/**
 * The bundle as it will be once notes from other prepared proposals exist.
 * In memory only: it lets a new proposal link to them, and the apply-time link
 * check still refuses the result until those notes really exist.
 */
export function withPendingFiles(bundle: Bundle, files: ReadonlyMap<BundlePath, string>): Bundle {
  if (files.size === 0) return bundle;
  const docs = new Map(bundle.docs);
  const entries = [...bundle.entries];
  const snapshot: [string, string][] = [...bundle.snapshot.files];
  for (const [path, text] of files) {
    if (bundle.snapshot.files.has(path)) throw new OkbError('E_CONFLICT', `${path} already exists; the pending proposal that creates it is stale`);
    const doc = parseOkf(path, text);
    docs.set(doc.path, doc);
    entries.push(toEntry(doc));
    snapshot.push([path, text]);
  }
  return { ...bundle, docs, entries, byPath: new Map(entries.map((e) => [e.path, e])), snapshot: snapshotFromEntries(snapshot) };
}

export function conceptsFolderEntries(bundle: Bundle, folder: string): KbEntry[] {
  const prefix = `${asBundlePath(folder)}/`;
  return bundle.entries.filter((e) => !e.reserved && e.path.startsWith(prefix));
}

/** Convenience wrapper so every caller honours `kb.exclude` without repeating it. */
export async function loadBundleFor(config: {
  kb: { root: string; exclude: readonly string[] };
}, options: { fresh?: boolean } = {}): Promise<Bundle> {
  return loadBundle(config.kb.root, { exclude: config.kb.exclude, fresh: options.fresh });
}
