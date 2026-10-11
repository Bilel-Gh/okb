import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { okbHome } from '../config/load.js';
import { readRootConfig, writeOwner, writeRootConfig } from '../kb/registry.js';
import { copyDb, inspectDb } from '../state/db.js';
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
 *
 * A snapshot brings everything back (F2.0-14): the notes and the documents
 * (`kb/`), the state with one whole copy of its database (`state/`), and the
 * brain's settings (`profile/`). `drillRestore` proves it: it restores the last
 * snapshot somewhere temporary and checks what came back.
 */
export type Manifest = {
  readonly version: 1;
  readonly profile: string;
  readonly kbRoot: string;
  readonly createdAt: string;
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly size: number }>>;
  /** What the snapshot held when it was taken; a restore is checked against it. Absent on snapshots made before 2.0. */
  readonly counts?: Counts;
};
export type Counts = { readonly notes: number; readonly documents: number; readonly projects: number; readonly actions: number; readonly entries: number; readonly reviews: number };

export type BackupInfo = { readonly date: string; readonly path: string; readonly files: number; readonly bytes: number; readonly createdAt: string };

const SKIP_STATE = new Set(['cache', 'index', 'logs']);
/** The approval key never leaves the machine's state folder, not even in a backup. The database is copied whole, not file by file. */
const NEVER = new Set(['approval.key', 'okb.db', 'okb.db-wal', 'okb.db-shm']);
const DB_KEY = 'state/okb.db';
const PROFILE_KEY = 'profile/profile.yaml';
const notesIn = (keys: readonly string[]) => keys.filter((k) => k.startsWith('kb/') && k.endsWith('.md') && !k.startsWith('kb/_Documents/') && !k.startsWith('kb/.')).length;

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
  // The brain's settings, so a restore on another computer is the same brain.
  const settings = await readFile(resolve(okbHome(env), 'profiles', config.profile.id, 'profile.yaml')).catch(() => null);
  if (settings) {
    await mkdir(resolve(tmp, 'profile'), { recursive: true });
    await writeFile(resolve(tmp, PROFILE_KEY), settings);
    files[PROFILE_KEY] = { sha256: sha256(settings), size: settings.length };
    copied++;
  }
  // The state database, whole: projects, actions, the journal, the documents' index.
  let inside = { documents: 0, projects: 0, actions: 0, entries: 0, reviews: 0 };
  const dbCopy = resolve(tmp, DB_KEY);
  await mkdir(dirname(dbCopy), { recursive: true });
  if (copyDb(config, dbCopy)) {
    const data = await readFile(dbCopy);
    const { sound: _sound, ...counted } = inspectDb(dbCopy);
    inside = counted;
    files[DB_KEY] = { sha256: sha256(data), size: data.length };
    copied++;
  }
  const manifest: Manifest = { version: 1, profile: config.profile.id, kbRoot: config.kb.root, createdAt: now.toISOString(), files, counts: { notes: notesIn(Object.keys(files)), ...inside } };
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

/**
 * Copy a snapshot's notes and documents into a new folder; the KB itself is
 * never touched. With `as`, the snapshot comes back as a new brain: its state
 * (projects, actions, journal, documents' index) and its settings too. A
 * restore never lands on a brain that exists.
 */
export async function restoreBackup(config: OkbConfig, date: string, to: string, env: NodeJS.ProcessEnv = process.env, options: { readonly as?: string } = {}): Promise<{ to: string; files: number; profile?: string }> {
  const b = (await listBackups(config, env)).find((x) => x.date === date);
  if (!b) throw new OkbError('E_NOT_FOUND', `no backup of ${date}`, { key: 'backupUnknown', params: { date } });
  const target = resolve(to);
  if (target === resolve(config.kb.root) || target.startsWith(`${resolve(config.kb.root)}/`)) throw new OkbError('E_FORBIDDEN_PATH', 'a restore never goes into the KB itself', { key: 'backupIntoKb' });
  const exists = await stat(target).then((s) => s.isDirectory(), () => false);
  if (exists && (await readdir(target)).length) throw new OkbError('E_CONFLICT', `${target} is not empty`, { key: 'backupTargetNotEmpty', params: { path: target } });
  const as = options.as?.trim();
  const home = resolve(okbHome(env), 'profiles', as ?? '');
  if (as !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(as)) throw new OkbError('E_INVALID', `"${as}" is not a brain id`, { key: 'backupProfileName', params: { id: as } });
    const known = ((await readRootConfig(env).catch(() => ({ profiles: [] }))).profiles ?? []).map(String);
    if (known.includes(as) || (await stat(home).then(() => true, () => false))) throw new OkbError('E_CONFLICT', `a brain "${as}" already exists`, { key: 'backupProfileExists', params: { id: as } });
  }
  const m = (await readJsonIfExists<Manifest>(resolve(b.path, 'manifest.json')))!;
  let n = 0;
  for (const key of Object.keys(m.files).filter((k) => k.startsWith('kb/'))) {
    const dest = resolve(target, key.slice(3));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(resolve(b.path, key), dest);
    n++;
  }
  if (as === undefined) return { to: target, files: n };
  for (const key of Object.keys(m.files).filter((k) => k.startsWith('state/'))) {
    const dest = resolve(home, key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(resolve(b.path, key), dest);
  }
  // The settings of the brain as it was, pointed at where it now lives.
  const raw = await readFile(resolve(b.path, PROFILE_KEY), 'utf8').catch(() => readFile(resolve(okbHome(env), 'profiles', config.profile.id, 'profile.yaml'), 'utf8'));
  const doc = YAML.parseDocument(raw);
  doc.setIn(['profile', 'id'], as);
  doc.setIn(['kb', 'root'], target);
  doc.delete('stateHome');
  await mkdir(home, { recursive: true });
  await writeFile(resolve(home, 'profile.yaml'), String(doc));
  await writeOwner(target, as);
  await writeRootConfig((root) => ({ ...root, profiles: [...new Set([...(root.profiles ?? []).map(String), as])] }), env);
  return { to: target, files: n, profile: as };
}

export type DrillReport = Counts & { readonly ok: boolean; readonly date: string; readonly files: number; readonly problems: readonly string[] };

/**
 * A restore that is really tried. The last snapshot is copied into a
 * temporary folder, every file checked against its fingerprint, the database
 * opened and counted, and what came back compared with what the snapshot said
 * it held. The folder is removed. Nothing of the brain is touched.
 */
export async function drillRestore(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<DrillReport> {
  const b = (await listBackups(config, env))[0];
  if (!b) throw new OkbError('E_NOT_FOUND', 'no backup yet', { key: 'backupNone', hint: 'okb backup run' });
  const m = (await readJsonIfExists<Manifest>(resolve(b.path, 'manifest.json')))!;
  const tmp = await mkdtemp(resolve(tmpdir(), 'okb-drill-'));
  const problems: string[] = [];
  let found = { documents: 0, projects: 0, actions: 0, entries: 0, reviews: 0 };
  try {
    for (const [key, f] of Object.entries(m.files)) {
      const data = await readFile(resolve(b.path, key)).catch(() => null);
      if (data === null) { problems.push(`${key}: missing`); continue; }
      if (sha256(data) !== f.sha256) { problems.push(`${key}: changed since the snapshot`); continue; }
      const dest = resolve(tmp, key);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
    if (m.files[DB_KEY] && !problems.some((p) => p.startsWith(DB_KEY))) {
      try {
        const { sound, ...counted } = inspectDb(resolve(tmp, DB_KEY));
        found = counted;
        if (!sound) problems.push(`${DB_KEY}: the database does not pass its own check`);
      } catch (e) { problems.push(`${DB_KEY}: ${(e as Error).message}`); }
    }
    const restored = (await walkFiles(resolve(tmp, 'kb')).catch(() => [] as string[])).map((f) => `kb/${f}`);
    const counts: Counts = { notes: notesIn(restored), ...found };
    if (m.counts) for (const k of Object.keys(m.counts) as (keyof Counts)[]) if (counts[k] !== m.counts[k]) problems.push(`${k}: ${counts[k]} came back, the snapshot held ${m.counts[k]}`);
    const report: DrillReport = { ok: problems.length === 0, date: b.date, files: Object.keys(m.files).length, ...counts, problems };
    await writeJsonAtomic(resolve(profileDir(await backupRoot(env), config), 'drilled.json'), { at: now.toISOString(), ok: report.ok, date: b.date, problems: problems.length });
    return report;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Is today's snapshot still to take? Once a day (twenty hours after the last), unless the person turned backups off. */
export async function backupDue(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<boolean> {
  if (!(await backupsEnabled(env).catch(() => false))) return false;
  const latest = (await listBackups(config, env).catch(() => []))[0];
  return !latest || now.getTime() - Date.parse(latest.createdAt) > 20 * 3_600_000;
}

export type BackupStatus = {
  /** `ok` today or yesterday, `late` beyond two days, `never`, or `off` when the person turned backups off. */
  readonly state: 'ok' | 'late' | 'never' | 'off';
  readonly where: string;
  readonly last: { readonly date: string; readonly at: string; readonly files: number } | null;
  readonly verifiedAt: string | null;
  /** When a restore was last really tried, and whether everything came back. */
  readonly drilledAt: string | null;
  readonly drillOk: boolean | null;
};

/** Where the backup stands, for a line the person sees every day. */
export async function backupStatus(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<BackupStatus> {
  const where = await backupRoot(env);
  const last = (await listBackups(config, env).catch(() => []))[0] ?? null;
  const drilled = await readJsonIfExists<{ at: string; ok: boolean }>(resolve(profileDir(where, config), 'drilled.json')).catch(() => null);
  const state = !(await backupsEnabled(env)) ? 'off' : !last ? 'never' : now.getTime() - Date.parse(last.createdAt) > 2 * 86_400_000 ? 'late' : 'ok';
  return { state, where, last: last ? { date: last.date, at: last.createdAt, files: last.files } : null, verifiedAt: (await lastVerified(config, env))?.at ?? null, drilledAt: drilled?.at ?? null, drillOk: drilled?.ok ?? null };
}
