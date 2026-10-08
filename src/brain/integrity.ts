import { execFile } from 'node:child_process';
import { posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { checkLinks } from '../links/check.js';
import { extractLinks } from '../markdown/ast.js';
import { resolveInternal } from '../links/portable.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import type { BundlePath } from '../util/paths.js';
import { lastVerified, listBackups } from './backup.js';
import { layoutOf, rootFile } from './layout.js';
import { positionOf } from './tree.js';

/**
 * The health of a brain's storage: what could lose or hide a note. Each
 * finding says what to do; repairs go through a proposal (src/brain/repair).
 */
export type IntegrityCode =
  | 'sync-copy' | 'sync-conflict' | 'duplicate-id' | 'missing-id' | 'outside-layout' | 'broken-link'
  | 'orphan-file' | 'unreadable' | 'no-disk-encryption' | 'no-backup' | 'old-backup' | 'unverified-backup' | 'moved-note';

export type IntegrityFinding = {
  readonly code: IntegrityCode;
  readonly level: 'error' | 'warning' | 'info';
  readonly path?: string;
  readonly detail?: string;
  /** For a moved note: where its links should now point. */
  readonly to?: string;
};

const CONFLICT = /(conflicted copy|\.sync-conflict-|\(conflict|\(conflit|copie en conflit)/i;
const COPY = /^(.*) (\d+)(\.[^.]+)$/;

const run = promisify(execFile);

async function diskEncrypted(): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('fdesetup', ['status'], { timeout: 2_000 });
    return /FileVault is On/i.test(stdout);
  } catch { return null; }
}

function idsFile(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'cache', 'note-ids.json');
}

/** Where each note id was last seen: a note moved outside OKB is found again by its id. */
export async function idMoves(config: OkbConfig, bundle: Bundle, save = true): Promise<{ from: string; to: string; id: string }[]> {
  const before = (await readJsonIfExists<Record<string, string>>(idsFile(config)).catch(() => null)) ?? {};
  const now: Record<string, string> = {};
  for (const e of bundle.entries) if (typeof e.ext.id === 'string') now[e.ext.id] = e.path;
  const moves = Object.entries(now).filter(([id, p]) => before[id] && before[id] !== p).map(([id, to]) => ({ id, from: before[id]!, to }));
  if (save) await writeJsonAtomic(idsFile(config), now);
  return moves;
}

export async function checkIntegrity(config: OkbConfig, bundle: Bundle, options: { env?: NodeJS.ProcessEnv; now?: Date; disk?: boolean } = {}): Promise<IntegrityFinding[]> {
  const out: IntegrityFinding[] = [];
  const layout = layoutOf(config);
  const files = [...bundle.snapshot.files.keys()] as string[];
  const set = new Set(files);
  for (const f of files) {
    const name = posix.basename(f);
    if (CONFLICT.test(name)) out.push({ code: 'sync-conflict', level: 'warning', path: f });
    const m = COPY.exec(name);
    if (m && set.has(posix.join(posix.dirname(f), `${m[1]}${m[3]}`))) {
      const original = bundle.snapshot.files.get(posix.join(posix.dirname(f), `${m[1]}${m[3]}`) as BundlePath);
      out.push({ code: 'sync-copy', level: 'warning', path: f, detail: original === bundle.snapshot.files.get(f as BundlePath) ? 'identical' : 'different' });
    }
  }
  for (const u of bundle.unreadable) out.push({ code: 'unreadable', level: 'error', path: u.path, detail: u.reason });
  const seen = new Map<string, string>();
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    const id = e.ext.id;
    if (typeof id === 'string') {
      if (seen.has(id)) out.push({ code: 'duplicate-id', level: 'warning', path: e.path, detail: seen.get(id)! });
      else seen.set(id, e.path);
    } else if (layout) out.push({ code: 'missing-id', level: 'info', path: e.path });
    if (layout && !positionOf(layout, e.path).drawer && ![rootFile(layout, 'home'), rootFile(layout, 'now'), rootFile(layout, 'glossary')].includes(e.path) && !/^readme\.md$/i.test(e.path)) {
      out.push({ code: 'outside-layout', level: 'info', path: e.path });
    }
  }
  const links = checkLinks(bundle.snapshot, { brokenTargetsAre: 'warning' });
  const moves = await idMoves(config, bundle, false).catch(() => []);
  for (const issue of links.issues.filter((i) => i.code === 'LINK_BROKEN_TARGET')) {
    const target = resolveInternal(issue.file, issue.url);
    const move = target ? moves.find((m) => m.from === target) : undefined;
    out.push(move ? { code: 'moved-note', level: 'warning', path: issue.file, detail: issue.url, to: move.to } : { code: 'broken-link', level: 'warning', path: issue.file, detail: issue.url });
  }
  // Attachments nothing links to.
  const referenced = new Set<string>();
  for (const [path, doc] of bundle.docs) for (const l of extractLinks(doc.body)) { const t = resolveInternal(path, l.url); if (t) referenced.add(t); }
  for (const f of files) if (!f.endsWith('.md') && !f.startsWith('.') && !referenced.has(f) && /\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(f)) out.push({ code: 'orphan-file', level: 'info', path: f });

  if (config.kb.confidential && options.disk !== false) {
    const enc = await diskEncrypted();
    if (enc === false) out.push({ code: 'no-disk-encryption', level: 'warning' });
  }
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const backups = await listBackups(config, env).catch(() => []);
  if (!backups.length) out.push({ code: 'no-backup', level: 'warning' });
  else {
    const age = (now.getTime() - Date.parse(backups[0]!.createdAt)) / 86_400_000;
    if (age > 2) out.push({ code: 'old-backup', level: 'warning', detail: backups[0]!.date });
    const v = await lastVerified(config, env);
    if (!v || (now.getTime() - Date.parse(v.at)) / 86_400_000 > 35 || v.bad || v.missing) out.push({ code: 'unverified-backup', level: v && (v.bad || v.missing) ? 'error' : 'info' });
  }
  return out;
}
