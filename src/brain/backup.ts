import { copyFile, link, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { okbHome } from '../config/load.js';
import { readRootConfig } from '../kb/registry.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, walkFiles, writeJsonAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';

/**
 * Daily snapshots of a KB and of its private state, in a folder the person
 * chooses (an external disk is best: the same disk does not survive the disk).
 * A snapshot links unchanged files to the previous one, so a hundred days cost
 * little. Kept: 7 days, then one a week for 4 weeks, then one a month for 12
 * months. A snapshot is verified by reading every file back against its
 * fingerprint; a restore goes to a new folder and never overwrites the KB.
 */
export type Manifest = {
  readonly version: 1;
  readonly profile: string;
  readonly kbRoot: string;
  readonly createdAt: string;
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly size: number }>>;
};

export type BackupInfo = { readonly date: string; readonly path: string; readonly files: number; readonly bytes: number; readonly createdAt: string };

const SKIP_STATE = new Set(['cache', 'index', 'logs']);
/** The approval key never leaves the machine's state folder, not even in a backup. */
const NEVER = new Set(['approval.key']);

export async function backupRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const root = await readRootConfig(env).catch(() => ({} as Record<string, unknown>));
  const dir = (root as { backup?: { dir?: unknown } }).backup?.dir;
  return typeof dir === 'string' && dir.trim() ? resolve(dir.replace(/^~(?=\/|$)/, env.HOME ?? '~')) : resolve(okbHome(env), 'backups');
}

export async function backupsEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const root = await readRootConfig(env).catch(() => ({} as Record<string, unknown>));
  return (root as { backup?: { enabled?: unknown } }).backup?.enabled !== false;
}

function profileDir(base: string, config: OkbConfig): string {
  return resolve(base, config.profile.id);
}

export async function listBackups(config: OkbConfig, env: NodeJS.ProcessEnv = process.env): Promise<BackupInfo[]> {
  const dir = profileDir(await backupRoot(env), config);
  const out: BackupInfo[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))) {
    const m = await readJsonIfExists<Manifest>(resolve(dir, name, 'manifest.json')).catch(() => null);
    if (!m) continue;
    const files = Object.values(m.files);
    out.push({ date: name, path: resolve(dir, name), files: files.length, bytes: files.reduce((s, f) => s + f.size, 0), createdAt: m.createdAt });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

async function filesOf(root: string, skipTop: ReadonlySet<string> = new Set()): Promise<string[]> {
  const all = await walkFiles(root, { skipDirs: new Set(['.git', 'node_modules']) }).catch(() => [] as string[]);
  return all.filter((f) => !skipTop.has(f.split('/')[0]!) && !NEVER.has(f.split('/').pop()!));
}

/** Take today's snapshot (once a day unless `force`). */
export async function runBackup(config: OkbConfig, options: { force?: boolean; now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<{ created: boolean; info: BackupInfo; linked: number; copied: number; removed: string[] }> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const base = await backupRoot(env);
  const dir = profileDir(base, config);
  const date = now.toISOString().slice(0, 10);
  const target = resolve(dir, date);
  const existing = await listBackups(config, env);
  if (!options.force && existing.some((b) => b.date === date)) {
    return { created: false, info: existing.find((b) => b.date === date)!, linked: 0, copied: 0, removed: [] };
  }
  const previous = existing.find((b) => b.date !== date);
  const prevManifest = previous ? await readJsonIfExists<Manifest>(resolve(previous.path, 'manifest.json')) : null;
  const tmp = `${target}.partial`;
  await rm(tmp, { recursive: true, force: true });
  const files: Record<string, { sha256: string; size: number }> = {};
  let linked = 0;
  let copied = 0;
  const sources: { prefix: string; root: string; skip?: ReadonlySet<string> }[] = [
    { prefix: 'kb', root: config.kb.root },
    { prefix: 'state', root: statePaths(config).root, skip: SKIP_STATE },
  ];
  for (const s of sources) {
    for (const rel of await filesOf(s.root, s.skip)) {
      const from = resolve(s.root, rel);
      const key = `${s.prefix}/${rel}`;
      const data = await readFile(from).catch(() => null);
      if (data === null) continue;
      const hash = sha256(data);
      const to = resolve(tmp, key);
      await mkdir(dirname(to), { recursive: true });
      const prev = prevManifest?.files[key];
      let done = false;
      if (prev && prev.sha256 === hash && previous) {
        try { await link(resolve(previous.path, key), to); linked++; done = true; } catch { /* other disk, or gone: copy */ }
      }
      if (!done) { await copyFile(from, to); copied++; }
      files[key] = { sha256: hash, size: data.length };
    }
  }
  const manifest: Manifest = { version: 1, profile: config.profile.id, kbRoot: config.kb.root, createdAt: now.toISOString(), files };
  await writeJsonAtomic(resolve(tmp, 'manifest.json'), manifest);
  await rm(target, { recursive: true, force: true });
  const { rename } = await import('node:fs/promises');
  await rename(tmp, target);
  const removed = await rotate(config, env, now);
  const info = (await listBackups(config, env)).find((b) => b.date === date)!;
  return { created: true, info, linked, copied, removed };
}

/** Which snapshots to keep: the last 7 days, one per week for 4 weeks, one per month for 12 months. */
export function keepSet(dates: readonly string[], now: Date): Set<string> {
  const sorted = [...dates].sort().reverse();
  const keep = new Set<string>(sorted.slice(0, 7));
  const weeks = new Set<string>();
  const months = new Set<string>();
  for (const d of sorted) {
    const age = (now.getTime() - Date.parse(`${d}T12:00:00Z`)) / 86_400_000;
    const t = new Date(`${d}T12:00:00Z`);
    const week = `${t.getUTCFullYear()}-${Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
    if (age <= 35 && !weeks.has(week) && weeks.size < 4) { weeks.add(week); keep.add(d); }
    const month = d.slice(0, 7);
    if (age <= 370 && !months.has(month) && months.size < 12) { months.add(month); keep.add(d); }
  }
  return keep;
}

async function rotate(config: OkbConfig, env: NodeJS.ProcessEnv, now: Date): Promise<string[]> {
  const all = await listBackups(config, env);
  const keep = keepSet(all.map((b) => b.date), now);
  const removed: string[] = [];
  for (const b of all) {
    if (keep.has(b.date)) continue;
    await rm(b.path, { recursive: true, force: true });
    removed.push(b.date);
  }
  return removed;
}

export type VerifyReport = { readonly date: string; readonly files: number; readonly ok: number; readonly bad: readonly string[]; readonly missing: readonly string[] };

/** Read every file of a snapshot back and compare it with its fingerprint. */
export async function verifyBackup(config: OkbConfig, date?: string, env: NodeJS.ProcessEnv = process.env): Promise<VerifyReport> {
  const all = await listBackups(config, env);
  const b = date ? all.find((x) => x.date === date) : all[0];
  if (!b) throw new OkbError('E_NOT_FOUND', 'no backup yet', { key: 'backupNone', hint: 'okb backup run' });
  const m = (await readJsonIfExists<Manifest>(resolve(b.path, 'manifest.json')))!;
  const bad: string[] = [];
  const missing: string[] = [];
  let ok = 0;
  for (const [key, f] of Object.entries(m.files)) {
    const data = await readFile(resolve(b.path, key)).catch(() => null);
    if (data === null) missing.push(key);
    else if (sha256(data) !== f.sha256) bad.push(key);
    else ok++;
  }
  const report = { date: b.date, files: Object.keys(m.files).length, ok, bad, missing };
  await writeJsonAtomic(resolve(profileDir(await backupRoot(env), config), 'verified.json'), { at: new Date().toISOString(), ...report });
  return report;
}

export async function lastVerified(config: OkbConfig, env: NodeJS.ProcessEnv = process.env): Promise<{ at: string; bad: number; missing: number } | null> {
  const v = await readJsonIfExists<{ at: string; bad: string[]; missing: string[] }>(resolve(profileDir(await backupRoot(env), config), 'verified.json')).catch(() => null);
  return v ? { at: v.at, bad: v.bad.length, missing: v.missing.length } : null;
}

/** Copy a snapshot's KB into a new folder. The KB itself is never touched. */
export async function restoreBackup(config: OkbConfig, date: string, to: string, env: NodeJS.ProcessEnv = process.env): Promise<{ to: string; files: number }> {
  const b = (await listBackups(config, env)).find((x) => x.date === date);
  if (!b) throw new OkbError('E_NOT_FOUND', `no backup of ${date}`, { key: 'backupUnknown', params: { date } });
  const target = resolve(to);
  if (target === resolve(config.kb.root) || target.startsWith(`${resolve(config.kb.root)}/`)) throw new OkbError('E_FORBIDDEN_PATH', 'a restore never goes into the KB itself', { key: 'backupIntoKb' });
  const exists = await stat(target).then((s) => s.isDirectory(), () => false);
  if (exists && (await readdir(target)).length) throw new OkbError('E_CONFLICT', `${target} is not empty`, { key: 'backupTargetNotEmpty', params: { path: target } });
  const m = (await readJsonIfExists<Manifest>(resolve(b.path, 'manifest.json')))!;
  let n = 0;
  for (const key of Object.keys(m.files).filter((k) => k.startsWith('kb/'))) {
    const dest = resolve(target, key.slice(3));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(resolve(b.path, key), dest);
    n++;
  }
  return { to: target, files: n };
}
