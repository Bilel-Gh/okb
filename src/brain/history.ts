import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Receipt } from '../apply/apply.js';
import { parseOkf } from '../okf/document.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists, readTextIfExists } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';

/**
 * The history of a note, without Git: every apply keeps the file before and
 * after it (src/apply), so the versions of a note are read back from the
 * receipts, newest first — following the note when a proposal moved it (same
 * `x_okb.id` deleted at one path and created at another). Deleted notes stay
 * restorable the same way: that is the trash.
 */
export type Version = {
  readonly n: number;
  readonly at: string;
  readonly path: BundlePath;
  readonly action: 'created' | 'updated' | 'deleted' | 'moved' | 'current';
  readonly proposalId: string | null;
  readonly sha256: string | null;
  /** Where to read this version's text. */
  readonly source: { readonly kind: 'file' | 'backup' | 'next'; readonly file: string } | null;
};

async function allReceipts(config: OkbConfig): Promise<Receipt[]> {
  const dir = statePaths(config).receipts;
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Receipt[] = [];
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    const r = await readJsonIfExists<Receipt>(resolve(dir, n)).catch(() => null);
    if (r && r.complete && !r.rolledBack && Array.isArray(r.results)) out.push(r);
  }
  return out.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

function idOf(text: string | null): string | null {
  if (!text) return null;
  try {
    const id = (parseOkf('x.md', text).data.x_okb as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

function backupFile(config: OkbConfig, r: Receipt, path: string, kind: 'bak' | 'next'): string {
  return resolve(statePaths(config).backups, r.proposalId, `${sha256(path)}.${kind}`);
}

export async function noteHistory(config: OkbConfig, rawPath: string): Promise<Version[]> {
  let path = asBundlePath(rawPath);
  const versions: Version[] = [];
  const current = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path));
  if (current !== null) versions.push({ n: 0, at: new Date().toISOString(), path, action: 'current', proposalId: null, sha256: sha256(current), source: { kind: 'file', file: bundlePathToAbsolute(config.kb.root, path) } });
  for (const r of await allReceipts(config)) {
    const hit = r.results.find((x) => x.path === path);
    if (!hit) continue;
    if (hit.action !== 'deleted') {
      versions.push({ n: 0, at: r.appliedAt, path, action: hit.action === 'created' ? 'created' : 'updated', proposalId: r.proposalId, sha256: hit.sha256 || null, source: { kind: 'next', file: backupFile(config, r, path, 'next') } });
    } else {
      versions.push({ n: 0, at: r.appliedAt, path, action: 'deleted', proposalId: r.proposalId, sha256: null, source: r.backups[path] ? { kind: 'backup', file: backupFile(config, r, path, 'bak') } : null });
    }
    // Created here by a move: continue the story at the path it came from.
    if (hit.action === 'created') {
      const proposal = await readJsonIfExists<{ notes?: string[] }>(resolve(statePaths(config).proposals, r.proposalId, 'proposal.json')).catch(() => null);
      const recorded = (proposal?.notes ?? []).filter((n) => n.startsWith('move ')).map((n) => { try { return JSON.parse(n.slice(5)) as { from: string; to: string }; } catch { return null; } }).find((m) => m?.to === path);
      if (recorded) {
        path = asBundlePath(recorded.from);
        // The note as it was before the move, at its old place.
        if (r.backups[path]) versions.push({ n: 0, at: r.appliedAt, path, action: 'moved', proposalId: r.proposalId, sha256: r.beforeHashes[path] ?? null, source: { kind: 'backup', file: backupFile(config, r, path, 'bak') } });
        continue;
      }
      const created = await readTextIfExists(backupFile(config, r, path, 'next'));
      const id = idOf(created);
      if (id) {
        for (const other of r.results.filter((x) => x.action === 'deleted')) {
          if (idOf(await readTextIfExists(backupFile(config, r, other.path, 'bak'))) === id) { path = other.path; break; }
        }
      }
    }
  }
  // Duplicates (the current file is also the last apply's result) are collapsed.
  const out: Version[] = [];
  for (const v of versions) if (!out.length || out[out.length - 1]!.sha256 !== v.sha256 || v.action === 'deleted') out.push(v);
  return out.map((v, i) => ({ ...v, n: i }));
}

export async function readVersion(v: Version): Promise<string | null> {
  return v.source ? readTextIfExists(v.source.file) : null;
}

export type TrashItem = { readonly path: BundlePath; readonly deletedAt: string; readonly proposalId: string; readonly title: string; readonly file: string; readonly days: number };

/** Notes deleted through OKB, newest first: they can be restored (a proposal) for 30 days at least. */
export async function trash(config: OkbConfig, options: { days?: number; now?: Date } = {}): Promise<TrashItem[]> {
  const now = options.now ?? new Date();
  const limit = options.days ?? 30;
  const out: TrashItem[] = [];
  const present = async (p: string) => (await readTextIfExists(bundlePathToAbsolute(config.kb.root, p))) !== null;
  for (const r of await allReceipts(config)) {
    const days = Math.floor((now.getTime() - Date.parse(r.appliedAt)) / 86_400_000);
    if (days > limit) continue;
    const created = new Set(r.results.filter((x) => x.action === 'created').map((x) => x.path));
    for (const x of r.results.filter((y) => y.action === 'deleted')) {
      if (!r.backups[x.path] || (await present(x.path))) continue;
      const file = backupFile(config, r, x.path, 'bak');
      const text = await readTextIfExists(file);
      if (text === null) continue;
      // A move deletes and creates the same note: not a deletion people care about.
      const id = idOf(text);
      let moved = false;
      if (id) for (const c of created) if (idOf(await readTextIfExists(backupFile(config, r, c, 'next'))) === id) { moved = true; break; }
      if (moved) continue;
      let title: string = x.path;
      try { const t = parseOkf(x.path, text).data.title; if (typeof t === 'string') title = t; } catch { /* keep the path */ }
      out.push({ path: x.path, deletedAt: r.appliedAt, proposalId: r.proposalId, title, file, days });
    }
  }
  return out;
}
