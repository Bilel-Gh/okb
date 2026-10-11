import { mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { noteKind } from '../brain/types.js';
import { CAREER_KINDS } from '../career/career.js';
import { loadConfig, okbHome } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { person } from '../identity/person.js';
import { loadBundleFor, type Bundle, type KbEntry } from '../kb/bundle.js';
import { isInside } from '../kb/registry.js';
import { isSecret } from '../security/confidential.js';
import { findSecrets } from '../security/secrets.js';
import { spaceOf } from '../spaces/space.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, walkFiles, writeJsonAtomic, writeTextAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';
import { withStateLock } from '../util/state-lock.js';
import { isGitFolder, remoteOf } from './git.js';
import { drawerName, MANIFEST, readManifest, type DrawerManifest } from './manifest.js';
export type { DrawerManifest } from './manifest.js';

/**
 * Sharing through drawers (2.1). Colleagues reach one shared folder — a team
 * folder, or the local copy of a repository they have in common. Each person
 * has a drawer in it, and OKB writes only in the person's own: there is nothing
 * to merge and nothing to conflict. A drawer holds copies of the notes the
 * person chose to share, as they are.
 *
 * What never leaves: a 🔒 note, a private one, a note that holds a secret, the
 * career notes, and anything of a brain that is the person's baggage or that
 * must stay on the computer. The preview says what leaves and what is held
 * back, and why, before anything is written.
 */
export type Sharing = { readonly folder: string; readonly drawer: string; readonly allowedAt: string };
export type HeldReason = 'secret' | 'private' | 'holds-secret' | 'career';
export type SharePreview = {
  readonly leaving: readonly { readonly path: string; readonly title: string; readonly markdown: string }[];
  readonly held: readonly { readonly path: string; readonly title: string; readonly reason: HeldReason }[];
  readonly removed: readonly { readonly path: string; readonly title: string }[];
  readonly previewHash: string;
};
export type DrawerInfo = { readonly drawer: string; readonly name: string; readonly person: string; readonly notes: number; readonly updatedAt: string; readonly mine: boolean };

const expand = (path: string) => resolve(path.replace(/^~(?=\/|$)/, homedir()));

export function sharingOf(config: OkbConfig): Sharing | null {
  return config.share ? { folder: expand(config.share.folder), drawer: config.share.drawer, allowedAt: config.share.allowedAt } : null;
}

/** The rules that hold at every step, not only at set-up: a brain may have become the baggage, or confidential, since. */
export function assertMayShare(config: OkbConfig): void {
  if (spaceOf(config) === 'baggage' || config.kb.brain?.preset === 'career') throw new OkbError('E_INVALID', 'the baggage is never shared', { key: 'spaceBaggageStays' });
  if (config.kb.confidential) throw new OkbError('E_INVALID', 'this brain must stay on this computer', { key: 'shareConfidential' });
}

function required(config: OkbConfig): Sharing {
  const sharing = sharingOf(config);
  if (!sharing) throw new OkbError('E_NOT_FOUND', 'sharing is not set up for this brain', { key: 'shareNotSetUp', hint: 'okb share setup --folder <shared folder> --drawer <your name> --allowed' });
  return sharing;
}

/** Recheck the actual location at every write: the configured path may have become an alias since setup. */
export async function sharedFolder(config: OkbConfig): Promise<Sharing> {
  const sharing = required(config);
  const folder = await realpath(sharing.folder).catch(() => null);
  if (!folder || !(await stat(folder)).isDirectory()) throw new OkbError('E_NOT_FOUND', 'the shared folder is unavailable', { key: 'shareNoFolder', params: { path: sharing.folder } });
  const kb = await realpath(config.kb.root);
  if (isInside(folder, kb) || isInside(kb, folder)) throw new OkbError('E_FORBIDDEN_PATH', 'the shared folder cannot be inside the notes, nor hold them', { key: 'shareInsideNotes' });
  return { ...sharing, folder };
}

/** The same fail-closed filter is used when sending and when reading an untrusted colleague's manifest. */
export function heldReason(entry: KbEntry, content: string): HeldReason | null {
  return isSecret(entry.ext) ? 'secret'
    : ['private', 'confidential'].includes((entry.ext as { confidentiality?: string }).confidentiality ?? '') ? 'private'
      : (CAREER_KINDS as readonly string[]).includes(noteKind(entry) ?? '') || entry.path.split('/').some((p) => ['career', 'carriere'].includes(p.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())) ? 'career'
        : findSecrets(content).length ? 'holds-secret' : null;
}

/**
 * Choose the shared folder and the person's drawer. The person says the place
 * is allowed by their company (F2.1-09): OKB cannot know it, so it asks, keeps
 * the day they said so, and shows where a Git checkout goes.
 */
export async function setupSharing(config: OkbConfig, env: NodeJS.ProcessEnv, input: { readonly folder: string; readonly drawer: string; readonly allowed: boolean }, now = new Date()): Promise<{ folder: string; drawer: string; git: boolean; remote: string | null }> {
  if (input.allowed !== true) throw new OkbError('E_NOT_APPROVED', 'say that this place is allowed for your work notes', { key: 'shareNotAllowed' });
  assertMayShare(config);
  const folder = await realpath(expand(input.folder)).catch(() => expand(input.folder));
  const kb = await realpath(config.kb.root);
  if (isInside(folder, kb) || isInside(kb, folder)) throw new OkbError('E_FORBIDDEN_PATH', 'the shared folder cannot be inside the notes, nor hold them', { key: 'shareInsideNotes' });
  if (!(await stat(folder).then((s) => s.isDirectory(), () => false))) throw new OkbError('E_NOT_FOUND', `no folder ${folder}`, { key: 'shareNoFolder', params: { path: folder } });
  const drawer = input.drawer.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!drawerName.test(drawer)) throw new OkbError('E_INVALID', `"${input.drawer}" cannot name a drawer`, { key: 'drawerName', params: { name: input.drawer } });
  const owner = await readManifest(folder, drawer, true);
  if (owner && owner.person.id !== (await person(env)).id) throw new OkbError('E_CONFLICT', `the drawer "${drawer}" belongs to someone else`, { key: 'drawerTaken', params: { drawer } });
  const file = resolve(okbHome(env), 'profiles', config.profile.id, 'profile.yaml');
  await withStateLock(file, async () => {
    const doc = YAML.parseDocument(await readFile(file, 'utf8'));
    doc.setIn(['share'], { folder, drawer, allowedAt: now.toISOString() });
    await writeTextAtomic(file, String(doc));
  });
  await loadConfig({ env, profileId: config.profile.id });
  return { folder, drawer, git: isGitFolder(folder), remote: await remoteOf(folder) };
}

/* ------------------------------------------------- what the person shares */

export function listMarked(config: OkbConfig): string[] {
  return openDb(config).all<{ path: string }>('SELECT path FROM shares ORDER BY path').map((r) => r.path);
}

/** Mark notes, or folders with everything under them, as shared. Nothing leaves before the next sending. */
export async function markShared(config: OkbConfig, paths: readonly string[], now = new Date()): Promise<string[]> {
  assertMayShare(config);
  const bundle = await loadBundleFor(config);
  const canonical = paths.map((p) => asBundlePath(p.trim().replace(/\/+$/, '')));
  for (const path of canonical) if (!bundle.entries.some((e) => !e.reserved && (e.path === path || e.path.startsWith(`${path}/`)))) {
    throw new OkbError('E_NOT_FOUND', 'no note or folder at this place', { key: 'noteUnknown', params: { path } });
  }
  const db = openDb(config);
  db.tx(() => { for (const p of canonical) db.run('INSERT OR IGNORE INTO shares (path, added_at) VALUES (?, ?)', p, now.toISOString()); });
  return listMarked(config);
}

export async function unmarkShared(config: OkbConfig, paths: readonly string[]): Promise<string[]> {
  const db = openDb(config);
  db.tx(() => { for (const p of paths) db.run('DELETE FROM shares WHERE path = ?', p.trim().replace(/\/+$/, '')); });
  return listMarked(config);
}

/** What would leave now, and what is held back with the reason. Reads only. */
export async function sharePreview(config: OkbConfig, bundle: Bundle, marks: readonly string[] = listMarked(config)): Promise<SharePreview> {
  assertMayShare(config);
  const sharing = await sharedFolder(config);
  const before = await readManifest(sharing.folder, sharing.drawer, true);
  const covered = (path: string) => marks.some((m) => path === m || path.startsWith(`${m}/`));
  const leaving: { path: string; title: string; markdown: string }[] = [];
  const held: { path: string; title: string; reason: HeldReason }[] = [];
  for (const e of bundle.entries) {
    if (e.reserved || !covered(e.path)) continue;
    const markdown = bundle.snapshot.files.get(e.path) ?? '';
    const reason = heldReason(e, markdown);
    if (reason) held.push({ path: e.path, title: e.title, reason }); else leaving.push({ path: e.path, title: e.title, markdown });
  }
  const live = new Set(leaving.map((n) => n.path));
  const removed = (before?.notes ?? []).filter((n) => !live.has(n.path)).map(({ path, title }) => ({ path, title }));
  const previewHash = sha256(JSON.stringify({ sharing, marks: [...marks].sort(), leaving, held, removed, before: before?.notes ?? [] }));
  return { leaving, held, removed, previewHash };
}

/**
 * Put the person's drawer in step with what they share: the notes that leave
 * are copied as they are, the ones no longer shared are taken out. Only the
 * person's own drawer is written, and in it only what OKB put there: a file
 * someone dropped by hand is left alone and reported.
 */
export async function sendDrawer(config: OkbConfig, env: NodeJS.ProcessEnv, now = new Date(), previewHash?: string): Promise<{ written: number; removed: number; kept: number; held: number; unknown: string[]; tracked: string[] }> {
  const sharing = await sharedFolder(config);
  assertMayShare(config);
  await assertInsideRoot(sharing.folder, `${sharing.drawer}/${MANIFEST}`);
  // Validate the preview before the lock creates a drawer directory.
  if (previewHash && (await sharePreview(config, await loadBundleFor(config, { fresh: true }))).previewHash !== previewHash) {
    throw new OkbError('E_STALE', 'what would leave has changed; read the preview again', { key: 'sharePreviewChanged' });
  }
  const root = resolve(sharing.folder, sharing.drawer);
  return withStateLock(resolve(root, MANIFEST), async () => {
  const me = await person(env);
  const before = await readManifest(sharing.folder, sharing.drawer, true);
  if (before && before.person.id !== me.id) throw new OkbError('E_CONFLICT', `the drawer "${sharing.drawer}" belongs to someone else`, { key: 'drawerTaken', params: { drawer: sharing.drawer } });
  const bundle = await loadBundleFor(config, { fresh: true });
  const preview = await sharePreview(config, bundle);
  if (previewHash && preview.previewHash !== previewHash) throw new OkbError('E_STALE', 'what would leave has changed; read the preview again', { key: 'sharePreviewChanged' });
  const old = new Map((before?.notes ?? []).map((n) => [n.path, n]));
  // Preflight the entire change before touching any note, including removals.
  for (const n of [...preview.leaving, ...preview.removed]) {
    const target = await assertInsideRoot(root, n.path);
    const text = await readTextIfExists(target);
    if (text !== null && (!old.has(n.path) || (sha256(text) !== old.get(n.path)!.sha256 && !preview.leaving.some((l) => l.path === n.path && l.markdown === text)))) {
      throw new OkbError('E_CONFLICT', 'a file in the drawer was added or edited by hand; keep that edit before sending', { key: 'shareFileEdited', params: { path: n.path } });
    }
  }
  await mkdir(root, { recursive: true });
  const notes: { path: string; title: string; sha256: string }[] = [];
  let written = 0;
  for (const n of preview.leaving) {
    const content = n.markdown;
    const target = await assertInsideRoot(root, n.path);
    const hash = sha256(content);
    if ((await readFile(target, 'utf8').catch(() => null)) !== content) {
      await mkdir(dirname(target), { recursive: true });
      await writeTextAtomic(target, content);
      written++;
    }
    notes.push({ path: n.path, title: n.title, sha256: hash });
  }
  const now_ = new Set(notes.map((n) => n.path));
  let removed = 0;
  for (const old of before?.notes ?? []) {
    if (now_.has(old.path)) continue;
    await rm(await assertInsideRoot(root, old.path), { force: true });
    removed++;
  }
  const mine = new Set([...now_, ...(before?.notes ?? []).map((n) => n.path), MANIFEST]);
  const unknown = (await walkFiles(root)).filter((f) => !mine.has(f) && !f.startsWith(`${MANIFEST}.lock/`)).sort();
  const manifest: DrawerManifest = { kind: 'okb-drawer', v: 1, person: { id: me.id }, name: config.profile.displayName || sharing.drawer, updatedAt: now.toISOString(), notes: notes.sort((a, b) => a.path.localeCompare(b.path)) };
  // The timestamp describes a content revision, not a click on an unchanged drawer.
  if (!before || JSON.stringify({ ...before, updatedAt: '' }) !== JSON.stringify({ ...manifest, updatedAt: '' })) {
    await writeJsonAtomic(resolve(root, MANIFEST), manifest);
  }
  return { written, removed, kept: notes.length - written, held: preview.held.length, unknown, tracked: [...new Set([MANIFEST, ...notes.map((n) => n.path), ...preview.removed.map((n) => n.path)])] };
  });
}

/** Every drawer of the shared folder, the person's own included. */
export async function listDrawers(config: OkbConfig, env: NodeJS.ProcessEnv): Promise<DrawerInfo[]> {
  const sharing = await sharedFolder(config);
  const me = await person(env);
  const out: DrawerInfo[] = [];
  for (const entry of await readdir(sharing.folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const m = await readManifest(sharing.folder, entry.name);
    if (m) out.push({ drawer: entry.name, name: String(m.name ?? entry.name).slice(0, 80), person: m.person.id, notes: m.notes.length, updatedAt: m.updatedAt, mine: m.person.id === me.id });
  }
  return out.sort((a, b) => a.drawer.localeCompare(b.drawer));
}
