import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Receipt } from '../apply/apply.js';
import type { OkbConfig } from '../config/schema.js';
import { localSourceStates } from '../maintain/source-freshness.js';
import { isStale } from '../okf/types.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists } from '../util/fsx.js';
import type { BundlePath } from '../util/paths.js';
import type { Bundle } from './bundle.js';

/**
 * Sources and validity of a note (F2.0-27): where what it says comes from,
 * who wrote it and when, when the person approved it, and until when it holds.
 * Read from the note's own front matter and the receipts; nothing is guessed.
 */
export type SourceRef = { readonly title: string; readonly resource: string | null; readonly kind: 'local' | 'web' | 'other'; /** Sentences of the note that cite it. */ readonly claims: number };
export type Provenance = {
  readonly writtenBy: 'ai' | 'person' | 'unknown';
  readonly writtenAt: string | null;
  readonly updatedAt: string | null;
  /** The last change to this note the person approved and that was not undone. */
  readonly approved: { readonly at: string } | null;
  readonly sources: readonly SourceRef[];
  readonly verified: boolean;
  readonly staleAfter: string | null;
  readonly stale: boolean;
};

const LOCAL = /^urn:sha256:([a-f0-9]{64})$/i;
const iso = (value: unknown): string | null => {
  const text = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
  if (!text) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
};

async function approvalOf(config: OkbConfig, path: string): Promise<{ at: string } | null> {
  const dir = statePaths(config).receipts;
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  let best: string | null = null;
  for (const name of names) {
    const r = await readJsonIfExists<Receipt>(resolve(dir, name)).catch(() => null);
    if (!r || !r.complete || r.rolledBack || !Array.isArray(r.results) || resolve(r.kbRoot) !== resolve(config.kb.root)) continue;
    if (!r.results.some((x) => x.path === path && x.action !== 'skipped' && x.action !== 'deleted')) continue;
    const at = iso(r.approval?.approvedAt ?? r.appliedAt);
    if (at && (!best || at > best)) best = at;
  }
  return best ? { at: best } : null;
}

export async function provenanceOf(config: OkbConfig, bundle: Bundle, path: BundlePath, now = new Date()): Promise<Provenance> {
  const doc = bundle.docs.get(path);
  if (!doc) throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.', { key: 'noteNotFound' });
  const fm = doc.data as { generated?: { by?: unknown; at?: unknown }; updated?: unknown; sources?: unknown; verified?: unknown; stale_after?: unknown };
  const by = typeof fm.generated?.by === 'string' ? fm.generated.by : '';
  const sources = new Map<string, { title: string; resource: string | null; kind: SourceRef['kind']; claims: number }>();
  for (const s of Array.isArray(fm.sources) ? fm.sources as Record<string, unknown>[] : []) {
    if (!s || typeof s !== 'object') continue;
    const resource = typeof s.resource === 'string' ? s.resource : null;
    const title = typeof s.title === 'string' && s.title ? s.title : resource ?? String(s.id ?? '');
    const key = `${resource ?? ''}\u0000${title}`;
    const known = sources.get(key) ?? { title, resource, kind: resource && LOCAL.test(resource) ? 'local' as const : resource && /^https?:/i.test(resource) ? 'web' as const : 'other' as const, claims: 0 };
    // One entry per source, then one per sentence that cites it (x_okb_claim_kind).
    if (s.x_okb_claim_kind !== undefined) known.claims += 1;
    sources.set(key, known);
  }
  return {
    writtenBy: by.startsWith('human:') ? 'person' : by ? 'ai' : 'unknown',
    writtenAt: iso(fm.generated?.at),
    updatedAt: iso(fm.updated),
    approved: await approvalOf(config, path),
    sources: [...sources.values()],
    verified: fm.verified !== undefined && fm.verified !== null,
    staleAfter: fm.stale_after === undefined || fm.stale_after === null ? null : fm.stale_after instanceof Date ? fm.stale_after.toISOString().slice(0, 10) : String(fm.stale_after),
    stale: isStale(doc.data, now),
  };
}

export type SourceState = 'unchanged' | 'changed' | 'missing' | 'unknown';

/** Whether local sources changed since they were read, by fingerprint or `urn:sha256:` resource. Nothing is fetched. */
export async function sourceStates(config: OkbConfig, resources: Iterable<string>): Promise<Map<string, SourceState>> {
  const byHash = new Map<string, string>();
  for (const r of resources) {
    const hash = (LOCAL.exec(r)?.[1] ?? (/^[a-f0-9]{64}$/i.test(r) ? r : '')).toLowerCase();
    if (hash) byHash.set(hash, r);
  }
  const states = await localSourceStates(config, byHash.keys());
  return new Map([...byHash].map(([hash, given]) => [given, states.get(hash)?.state ?? 'unknown']));
}
