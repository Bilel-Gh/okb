import { readdir, rename, stat } from 'node:fs/promises';
import { relative, resolve, sep, isAbsolute } from 'node:path';
import YAML from 'yaml';
import { expandHome, okbHome } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import type { Lang } from '../i18n/index.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readTextIfExists, walkFiles, writeTextAtomic } from '../util/fsx.js';
import { withStateLock } from '../util/state-lock.js';

/**
 * Every KB a person has, as people see them: a name, a folder, a language.
 * "Profile" stays the internal word; the interface says "KB".
 */
export type KbSummary = {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly active: boolean;
  readonly writingLanguage: string;
  readonly exists: boolean;
  readonly owner: 'this' | 'other' | 'none';
};

export type RootConfig = { activeProfile?: string; profiles?: string[]; ui?: { language?: Lang | 'auto' }; [k: string]: unknown };

export async function readRootConfig(env: NodeJS.ProcessEnv = process.env): Promise<RootConfig> {
  const raw = await readTextIfExists(resolve(okbHome(env), 'config.yaml'));
  return raw ? ((YAML.parse(raw) as RootConfig | null) ?? {}) : {};
}

export async function writeRootConfig(update: (root: RootConfig) => RootConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = resolve(okbHome(env), 'config.yaml');
  await withStateLock(path, async () => {
    const next = update(await readRootConfig(env));
    await writeTextAtomic(path, YAML.stringify(next, { lineWidth: 0 }));
  });
}

export async function setUiLanguage(language: Lang | 'auto', env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writeRootConfig((root) => ({ ...root, ui: { ...(root.ui ?? {}), language } }), env);
}

async function readProfile(id: string, env: NodeJS.ProcessEnv): Promise<Record<string, unknown> | null> {
  const raw = await readTextIfExists(resolve(okbHome(env), 'profiles', id, 'profile.yaml'));
  return raw ? ((YAML.parse(raw) as Record<string, unknown> | null) ?? {}) : null;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function listKbs(env: NodeJS.ProcessEnv = process.env): Promise<KbSummary[]> {
  const root = await readRootConfig(env);
  const ids = Array.isArray(root.profiles) ? root.profiles.map(String) : [];
  const out: KbSummary[] = [];
  for (const id of ids) {
    const data = await readProfile(id, env);
    if (!data) continue;
    const profile = rec(data.profile);
    const kb = rec(data.kb);
    const kbRoot = typeof kb.root === 'string' ? resolve(expandHome(kb.root, env)) : '';
    const exists = kbRoot ? await stat(kbRoot).then((s) => s.isDirectory(), () => false) : false;
    const owner = exists ? (await readOwner(kbRoot)) : null;
    out.push({
      id,
      name: typeof profile.displayName === 'string' && profile.displayName ? profile.displayName : id,
      root: kbRoot,
      active: root.activeProfile === id,
      writingLanguage: String(rec(profile.answer).language ?? 'en'),
      exists,
      owner: owner === null ? 'none' : owner === id ? 'this' : 'other',
    });
  }
  return out;
}

/* ---------- Ownership: OKB writes only in a folder it was given ---------- */

const OWNER_FILE = ['.okb', 'owner.yaml'];

export async function readOwner(kbRoot: string): Promise<string | null> {
  const raw = await readTextIfExists(resolve(kbRoot, ...OWNER_FILE));
  if (raw === null) return null;
  try {
    const data = YAML.parse(raw) as { profile?: unknown } | null;
    return typeof data?.profile === 'string' ? data.profile : null;
  } catch {
    return null;
  }
}

export async function writeOwner(kbRoot: string, profileId: string): Promise<void> {
  await ensureDir(resolve(kbRoot, '.okb'));
  await writeTextAtomic(resolve(kbRoot, ...OWNER_FILE), [
    '# This folder is an OKB knowledge base. OKB writes here only through proposals',
    '# the owner approved, and never in a folder that carries another owner.',
    `okb: 1`,
    `profile: ${profileId}`,
    `since: ${new Date().toISOString()}`,
    '',
  ].join('\n'));
}

/** Markdown files in the folder that OKB did not generate (another tool's notes, hand-written notes). */
export async function foreignNotes(kbRoot: string, limit = 50): Promise<string[]> {
  let files: string[] = [];
  // index.md and log.md are OKF's reserved navigation files: OKB writes them without authorship metadata.
  try { files = (await walkFiles(kbRoot)).filter((f) => f.endsWith('.md') && !/(^|\/)(index|log)\.md$/.test(f)); } catch { return []; }
  const foreign: string[] = [];
  for (const f of files) {
    const raw = (await readTextIfExists(resolve(kbRoot, f))) ?? '';
    const front = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    if (!/(^|\n)generated:[\s{]*\n?\s*by:\s*["']?okb\//.test(front)) foreign.push(f);
    if (foreign.length >= limit) break;
  }
  return foreign;
}

export type Ownership =
  | { readonly state: 'owned' }
  | { readonly state: 'adopted' }
  | { readonly state: 'other'; readonly owner: string }
  | { readonly state: 'foreign'; readonly examples: readonly string[] };

/**
 * Before any write: the KB folder must be this profile's. A folder marked by
 * another profile is refused; an unmarked folder holding only OKB notes (or
 * nothing) is adopted silently, as KBs created before 0.5 are; an unmarked
 * folder with other notes may belong to another tool or agent and is refused
 * until the person adopts it on purpose (`okb kb adopt`).
 */
export async function checkOwnership(config: OkbConfig, options: { adopt?: boolean } = {}): Promise<Ownership> {
  const owner = await readOwner(config.kb.root);
  if (owner === config.profile.id) return { state: 'owned' };
  if (owner !== null) return { state: 'other', owner };
  const foreign = options.adopt ? [] : await foreignNotes(config.kb.root, 5);
  if (foreign.length) return { state: 'foreign', examples: foreign };
  await writeOwner(config.kb.root, config.profile.id);
  return { state: 'adopted' };
}

export async function assertWritableKb(config: OkbConfig): Promise<void> {
  const own = await checkOwnership(config);
  if (own.state === 'other') {
    throw new OkbError('E_FORBIDDEN_PATH', `the KB folder belongs to another OKB profile ("${own.owner}")`, {
      key: 'kbOtherOwner', params: { owner: own.owner, root: config.kb.root },
      hint: `Use --profile ${own.owner}, or point this profile to its own folder.`,
    });
  }
  if (own.state === 'foreign') {
    throw new OkbError('E_FORBIDDEN_PATH', 'the KB folder holds notes OKB did not write; it may belong to another tool', {
      key: 'kbForeign', params: { root: config.kb.root, example: own.examples[0] ?? '' },
      hint: 'If this folder really is yours for OKB: okb kb adopt',
      detail: { examples: own.examples },
    });
  }
}

/** Two KBs never share or nest folders: each one's writes stay its own. */
export async function overlappingKb(root: string, exceptId: string | null, env: NodeJS.ProcessEnv = process.env): Promise<KbSummary | null> {
  const target = resolve(root);
  for (const kb of await listKbs(env)) {
    if (kb.id === exceptId || !kb.root) continue;
    const a = relative(kb.root, target);
    const b = relative(target, kb.root);
    const inside = (r: string) => r === '' || (!r.startsWith('..') && !isAbsolute(r));
    if (inside(a) || inside(b)) return kb;
  }
  return null;
}

/** Remove a KB from OKB's list. Its notes stay where they are; its settings move to the archive. */
export async function archiveKb(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const home = okbHome(env);
  const root = await readRootConfig(env);
  const ids = Array.isArray(root.profiles) ? root.profiles.map(String) : [];
  if (!ids.includes(id)) throw new OkbError('E_NOT_FOUND', `KB "${id}" is not installed`, { key: 'kbUnknown', params: { id } });
  const day = new Date().toISOString().slice(0, 10);
  const target = resolve(home, 'archive', day, id);
  await ensureDir(resolve(home, 'archive', day));
  await rename(resolve(home, 'profiles', id), target);
  const rest = ids.filter((p) => p !== id);
  await writeRootConfig((r) => ({ ...r, profiles: rest, activeProfile: r.activeProfile === id ? rest[0] : r.activeProfile }), env);
  return target;
}

/** Obsidian vaults this person already uses (macOS, Linux, Windows locations). */
export async function obsidianVaults(env: NodeJS.ProcessEnv = process.env): Promise<{ path: string; open: boolean }[]> {
  const home = env.HOME ?? '';
  const candidates = [
    resolve(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    resolve(home, '.config', 'obsidian', 'obsidian.json'),
    resolve(env.APPDATA ?? resolve(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json'),
  ];
  for (const file of candidates) {
    const raw = await readTextIfExists(file);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as { vaults?: Record<string, { path?: string; open?: boolean; ts?: number }> };
      const vaults = Object.values(data.vaults ?? {}).filter((v) => typeof v.path === 'string');
      const existing = [];
      for (const v of vaults.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))) {
        if (await stat(v.path!).then((s) => s.isDirectory(), () => false)) existing.push({ path: v.path!, open: Boolean(v.open) });
      }
      return existing;
    } catch { /* unreadable: no suggestion */ }
  }
  return [];
}

/** `kb-<name>` folders already present in a vault. */
/**
 * OKB's own KB folders in a vault: registered with OKB or carrying its owner
 * marker. A folder merely named `kb-…` may belong to another tool and is not one.
 */
export async function kbFoldersIn(vault: string, knownRoots: readonly string[] = []): Promise<string[]> {
  try {
    const dirs = (await readdir(vault, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.'));
    const known = new Set(knownRoots.map((r) => resolve(r)));
    const mine = await Promise.all(dirs.map(async (d) => {
      const root = resolve(vault, d.name);
      if (known.has(root)) return d.name;
      return (await readOwner(root)) ? d.name : null;
    }));
    return mine.filter((n): n is string => n !== null).sort();
  } catch {
    return [];
  }
}

/** The naming convention: "Atlas Pilotage" → id `atlas-pilotage`, folder `kb-atlas-pilotage`. */
export function kbNames(name: string): { id: string; folder: string; display: string } {
  const id = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/^kb-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'notes';
  return { id, folder: `kb-${id}`, display: name.trim() || id };
}

export function isInside(child: string, parent: string): boolean {
  const r = relative(resolve(parent), resolve(child));
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}
