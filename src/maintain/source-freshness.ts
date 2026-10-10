import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { statePaths } from '../state/paths.js';
import { assertInsideRoot } from '../util/paths.js';
import type { MaintainIssue } from './maintain.js';

export type Freshness =
  | { state: 'unchanged' | 'changed' | 'missing' }
  | { state: 'unknown'; reason: string };

const FINGERPRINT = /^[a-f0-9]{64}$/i;
const RESOURCE = /^urn:sha256:([a-f0-9]{64})$/i;

/**
 * Compare local acquired bytes, never truth. The KB deliberately stores an URN
 * instead of a private pathname; only already-recorded operational metadata can
 * recover that pathname. No URL is fetched, snapshot updated or copy retained.
 */
export async function checkSourceFreshness(config: OkbConfig, bundle: Bundle): Promise<MaintainIssue[]> {
  const references = new Map<string, Set<string>>();
  const out: MaintainIssue[] = [];
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved || !Array.isArray(doc.data.sources)) continue;
    for (const source of doc.data.sources) {
      const hash = typeof source?.resource === 'string' ? RESOURCE.exec(source.resource)?.[1]?.toLowerCase() : undefined;
      if (!hash) {
        if (typeof source?.resource === 'string' && /^(?:file:|urn:sha256:)/i.test(source.resource) && !out.some(i => i.path === path)) {
          out.push({ code: 'SOURCE_FRESHNESS_UNKNOWN', level: 'info', path,
            message: 'a local source reference has no usable acquired-byte fingerprint',
            hint: 'No file was read and no freshness verdict was inferred.' });
        }
        continue;
      }
      const notes = references.get(hash) ?? new Set<string>();
      notes.add(path);
      references.set(hash, notes);
    }
  }
  if (references.size === 0) return out;
  const states = await localSourceStates(config, references.keys());
  for (const [hash, notes] of references) {
    const result = states.get(hash)!;
    if (result.state === 'unchanged') continue;
    const source = `urn:sha256:${hash}`;
    for (const path of notes) {
      if (result.state === 'changed') {
        out.push({ code: 'SOURCE_CHANGED', level: 'warning', path,
          message: `the acquired bytes of a recorded local source changed (${source})`,
          hint: 'A changed fingerprint does not make the note false. Review the source, then prepare a proposal if the knowledge needs updating.' });
      } else if (result.state === 'missing') {
        out.push({ code: 'SOURCE_MISSING', level: 'warning', path,
          message: `a recorded local source is missing (${source})`,
          hint: 'The knowledge and retained evidence stay unchanged. Locate the source before deciding whether the note needs revision.' });
      } else if (result.state === 'unknown') {
        out.push({ code: 'SOURCE_FRESHNESS_UNKNOWN', level: 'info', path,
          message: `cannot compare a local source (${source}): ${result.reason}`,
          hint: 'No freshness verdict was inferred. Only referenced local files with recorded fingerprints can be checked; web sources are never fetched.' });
      }
    }
  }
  return out;
}

/**
 * The state of local sources by fingerprint: unchanged, changed, missing, or
 * unknown with its reason. Nothing is fetched and nothing is kept.
 */
export async function localSourceStates(config: OkbConfig, hashes: Iterable<string>): Promise<Map<string, Freshness>> {
  const wanted = new Set([...hashes].map((h) => h.toLowerCase()));
  const out = new Map<string, Freshness>();
  if (!wanted.size) return out;
  const locations = await recordedLocalSources(config, wanted);
  const current = new Map<string, Promise<Freshness | string>>();
  for (const hash of wanted) {
    const paths = locations.get(hash);
    let result: Freshness;
    if (!paths?.size) {
      result = { state: 'unknown', reason: 'no local file reference is available in the private operational state' };
    } else if (paths.size > 1) {
      result = { state: 'unknown', reason: 'several local file references share this fingerprint; the original source is ambiguous' };
    } else {
      const path = [...paths][0]!;
      // A single file may be cited through several historical fingerprints.
      const value = await rawFingerprint(path, config.sources.limits.maxBytes, current);
      result = typeof value === 'string' ? { state: value === hash ? 'unchanged' : 'changed' } : value;
    }
    out.set(hash, result);
  }
  return out;
}

// Fingerprints live only in this invocation; no current contents are persisted.
async function rawFingerprint(
  path: string, maxBytes: number, cache: Map<string, Promise<Freshness | string>>,
): Promise<Freshness | string> {
  let value = cache.get(path);
  if (!value) { value = fingerprintFile(path, maxBytes); cache.set(path, value); }
  return value;
}

async function recordedLocalSources(config: OkbConfig, wanted: ReadonlySet<string>): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const add = (hash: unknown, uri: unknown) => {
    if (typeof hash !== 'string' || !FINGERPRINT.test(hash) || !wanted.has(hash.toLowerCase()) || typeof uri !== 'string') return;
    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return;
      const path = fileURLToPath(url);
      const paths = result.get(hash.toLowerCase()) ?? new Set<string>();
      paths.add(path);
      result.set(hash.toLowerCase(), paths);
    } catch { /* Invalid metadata is not permission to read another location. */ }
  };

  const runs = statePaths(config).runs;
  const entries = await readdir(runs, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // symlinked run directories are skipped
    for (const name of ['checkpoint.json', 'source.json']) {
      const relative = `runs/${entry.name}/${name}`;
      const record = await metadata(config, relative, name === 'checkpoint.json' ? 64_000 : Math.min(50_000_000, config.sources.limits.maxBytes * 3 + 64_000));
      if (!record) continue;
      if (name === 'checkpoint.json') add(record.sourceSha256, record.sourceUri);
      else if (record.source && typeof record.source === 'object') {
        const source = record.source as Record<string, unknown>;
        add(source.sha256, source.uri);
      }
    }
  }
  // Optional copy archives may survive when a working run has been removed.
  // Compare the original sourceHash, never a redacted artifactHash.
  if (config.sources.retention.mode === 'copy') {
    try {
      await assertInsideRoot(config.stateHome, config.sources.retention.dir);
      const archive = await readdir(resolve(config.stateHome, config.sources.retention.dir), { withFileTypes: true });
      for (const entry of archive) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const record = await metadata(config, `${config.sources.retention.dir}/${entry.name}`, 64_000);
        if (record) add(record.sourceHash, record.uri);
      }
    } catch { /* A missing/unreadable archive cannot prove freshness. */ }
  }
  return result;
}

async function metadata(config: OkbConfig, relative: string, maxBytes: number): Promise<Record<string, unknown> | null> {
  try {
    await assertInsideRoot(config.stateHome, relative);
    const file = resolve(config.stateHome, relative);
    const info = await lstat(file);
    if (!info.isFile() || info.size > maxBytes) return null;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > maxBytes) return null;
      const bytes = Buffer.alloc(current.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > maxBytes || bytesRead !== current.size) return null;
      const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } finally { await handle.close(); }
  } catch { return null; }
}

async function fingerprintFile(path: string, maxBytes: number): Promise<string | Freshness> {
  try {
    // The old metadata did not record a physical target. Refuse symlink paths
    // rather than following a target that may have been redirected since ingest.
    if (await realpath(path) !== resolve(path)) return { state: 'unknown', reason: 'the recorded source path contains a symbolic link' };
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile()) return { state: 'unknown', reason: 'the recorded source is not a regular file' };
      if (before.size > maxBytes) return { state: 'unknown', reason: 'the source exceeds sources.limits.maxBytes' };
      const hash = createHash('sha256');
      let bytes = 0;
      const stream = handle.createReadStream({ autoClose: false });
      for await (const chunk of stream) {
        bytes += (chunk as Buffer).length;
        if (bytes > maxBytes) { stream.destroy(); return { state: 'unknown', reason: 'the source exceeds sources.limits.maxBytes' }; }
        hash.update(chunk as Buffer);
      }
      const after = await handle.stat();
      const target = await lstat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
          target.dev !== before.dev || target.ino !== before.ino || await realpath(path) !== resolve(path)) {
        return { state: 'unknown', reason: 'the source changed while it was being checked' };
      }
      return hash.digest('hex');
    } finally { await handle.close(); }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { state: 'missing' }
      : { state: 'unknown', reason: 'the recorded source cannot be safely read' };
  }
}
