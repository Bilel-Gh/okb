import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import YAML from 'yaml';
import { okbHome } from '../config/load.js';
import { isInside, listKbs } from '../kb/registry.js';
import { branchNames, recentSubjects } from '../repo/git.js';
import { repoSlug } from '../repo/registry.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';

/**
 * A workspace: the folder (or folders) where a person keeps the repositories
 * of one team or one employer, tied to the KB that documents them. Inside it,
 * each repository has its own space in that KB (`repos/<id>/`) and the rest of
 * the KB is shared: business concepts, features that span repositories,
 * decisions, how the repositories connect.
 *
 * The list lives on this machine (`~/.okb/workspaces.yaml`): folder paths
 * and a team's ticket prefixes are local facts, not knowledge.
 */
export type Workspace = {
  readonly id: string;
  readonly name: string;
  /** The KB (profile id) that documents the repositories of this workspace. */
  readonly kb: string;
  /** Parent folders holding the repositories (one usually, several when they are spread). */
  readonly roots: readonly string[];
  readonly tickets: TicketRules;
  /**
   * Repositories outside its folders that belong to it anyway (`okb workspace attach`).
   * A repository with its own KB inside its folders belongs to it without being listed.
   */
  readonly attached: readonly string[];
  readonly createdAt: string;
};

/**
 * How ticket references look in this team: prefixes (`ABC` for `ABC-123`),
 * learned from branch names and commit messages, or a custom pattern.
 */
export type TicketRules = { readonly prefixes: readonly string[]; readonly pattern: string | null };

type WorkspaceFile = { workspaces?: Workspace[] };

function file(env: NodeJS.ProcessEnv): string {
  return resolve(okbHome(env), 'workspaces.yaml');
}

export async function listWorkspaces(env: NodeJS.ProcessEnv = process.env): Promise<Workspace[]> {
  const raw = await readTextIfExists(file(env));
  if (!raw) return [];
  try {
    const data = (YAML.parse(raw) as WorkspaceFile | null) ?? {};
    return (Array.isArray(data.workspaces) ? data.workspaces : [])
      .filter((w) => w && typeof w.id === 'string' && typeof w.kb === 'string' && Array.isArray(w.roots))
      .map((w) => ({ ...w, name: String(w.name ?? w.id), attached: Array.isArray(w.attached) ? w.attached.map(String) : [], tickets: { prefixes: Array.isArray(w.tickets?.prefixes) ? w.tickets.prefixes.map(String) : [], pattern: typeof w.tickets?.pattern === 'string' ? w.tickets.pattern : null } }));
  } catch (cause) {
    throw new OkbError('E_CONFIG', 'cannot read the list of workspaces (~/.okb/workspaces.yaml)', { cause });
  }
}

async function save(list: readonly Workspace[], env: NodeJS.ProcessEnv): Promise<void> {
  await writeTextAtomic(file(env), [
    '# Workspaces: the folders holding a team\'s repositories, and the KB that documents them.',
    '# Local paths: this file stays on this machine.',
    YAML.stringify({ workspaces: list }, { lineWidth: 0 }),
  ].join('\n'));
}

async function physical(dir: string): Promise<string> {
  return realpath(resolve(dir)).catch(() => resolve(dir));
}

/** The workspace whose folder contains `dir` (the deepest root wins). Paths only: no Git call. */
export async function workspaceForDir(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<Workspace | null> {
  const list = await listWorkspaces(env);
  if (!list.length) return null;
  const target = await physical(dir);
  let best: { ws: Workspace; depth: number } | null = null;
  for (const ws of list) {
    for (const root of ws.roots) {
      if (isInside(target, root) || isInside(resolve(dir), root)) {
        if (!best || root.length > best.depth) best = { ws, depth: root.length };
      }
    }
  }
  return best?.ws ?? null;
}

export async function findWorkspace(idOrName: string, env: NodeJS.ProcessEnv = process.env): Promise<Workspace | null> {
  const list = await listWorkspaces(env);
  const want = idOrName.toLowerCase();
  return list.find((w) => w.id === idOrName || w.name.toLowerCase() === want) ?? null;
}

export type AddWorkspaceInput = {
  readonly root: string;
  readonly kb: string;
  readonly name?: string;
  /** Add the folder to this existing workspace instead of creating one. */
  readonly into?: string;
  readonly prefixes?: readonly string[];
  readonly pattern?: string | null;
};

/** Create a workspace for a folder, or add the folder to an existing one. */
export async function addWorkspace(input: AddWorkspaceInput, env: NodeJS.ProcessEnv = process.env): Promise<{ workspace: Workspace; created: boolean }> {
  const root = await physical(input.root);
  const isDir = await stat(root).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new OkbError('E_NOT_FOUND', `not a folder: ${root}`, { key: 'repoNotFolder', params: { path: root } });
  if (input.pattern) checkPattern(input.pattern);
  const list = await listWorkspaces(env);
  const existing = input.into
    ? list.find((w) => w.id === input.into)
    : list.find((w) => w.roots.some((r) => resolve(r) === root));
  if (input.into && !existing) throw new OkbError('E_NOT_FOUND', `workspace "${input.into}" does not exist`, { key: 'workspaceUnknown', params: { id: input.into } });
  if (existing) {
    const updated: Workspace = {
      ...existing,
      kb: input.into ? existing.kb : input.kb,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      roots: [...new Set([...existing.roots, root])],
      tickets: {
        prefixes: [...new Set([...existing.tickets.prefixes, ...(input.prefixes ?? [])])],
        pattern: input.pattern !== undefined ? input.pattern : existing.tickets.pattern,
      },
    };
    await save(list.map((w) => (w === existing ? updated : w)), env);
    return { workspace: updated, created: false };
  }
  const name = input.name?.trim() || basename(root);
  let id = repoSlug(name);
  const taken = new Set(list.map((w) => w.id));
  for (let n = 2; taken.has(id); n++) id = `${repoSlug(name)}-${n}`;
  const workspace: Workspace = {
    id, name, kb: input.kb, roots: [root],
    tickets: { prefixes: [...new Set(input.prefixes ?? [])], pattern: input.pattern ?? null },
    attached: [],
    createdAt: new Date().toISOString(),
  };
  await save([...list, workspace].sort((a, b) => a.id.localeCompare(b.id)), env);
  return { workspace, created: true };
}

export async function updateWorkspace(id: string, change: { name?: string; prefixes?: readonly string[]; addPrefixes?: readonly string[]; pattern?: string | null; attach?: string; detach?: string }, env: NodeJS.ProcessEnv = process.env): Promise<Workspace> {
  const list = await listWorkspaces(env);
  const found = list.find((w) => w.id === id);
  if (!found) throw new OkbError('E_NOT_FOUND', `workspace "${id}" does not exist`, { key: 'workspaceUnknown', params: { id } });
  if (change.pattern) checkPattern(change.pattern);
  const prefixes = change.prefixes ?? found.tickets.prefixes;
  const updated: Workspace = {
    ...found,
    ...(change.name?.trim() ? { name: change.name.trim() } : {}),
    attached: [...new Set([...found.attached, ...(change.attach ? [change.attach] : [])])].filter((r) => r !== change.detach),
    tickets: {
      prefixes: [...new Set([...prefixes, ...(change.addPrefixes ?? [])].map((p) => p.toUpperCase()))],
      pattern: change.pattern !== undefined ? change.pattern : found.tickets.pattern,
    },
  };
  await save(list.map((w) => (w === found ? updated : w)), env);
  return updated;
}

/** Forget a workspace. Its repositories stay registered and its notes stay in the KB. */
export async function removeWorkspace(id: string, env: NodeJS.ProcessEnv = process.env): Promise<Workspace> {
  const list = await listWorkspaces(env);
  const found = list.find((w) => w.id === id);
  if (!found) throw new OkbError('E_NOT_FOUND', `workspace "${id}" does not exist`, { key: 'workspaceUnknown', params: { id } });
  await save(list.filter((w) => w !== found), env);
  return found;
}

/* ------------------------------------------------------------ discovery */

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out']);

/**
 * Git repositories in a folder: its subfolders, and theirs one level down
 * (`team/repo` layouts). A KB kept beside the repositories, even under Git,
 * is not one of them.
 */
export async function reposIn(folder: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const kbRoots = new Set((await listKbs(env)).map((k) => resolve(k.root)));
  const exists = (p: string) => stat(p).then(() => true, () => false);
  const isKb = async (dir: string) => kbRoots.has(resolve(dir)) || exists(resolve(dir, '.okb', 'owner.yaml'));
  const isRepo = async (dir: string) => !(await isKb(dir)) && exists(resolve(dir, '.git'));
  const dirs = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
    .map((d) => resolve(dir, d.name));
  const found: string[] = [];
  for (const child of await dirs(folder)) {
    if (await isRepo(child)) { found.push(child); continue; }
    if (await isKb(child)) continue;
    for (const grand of await dirs(child)) if (await isRepo(grand)) found.push(grand);
  }
  return found.sort();
}

/* ---------------------------------------------------- ticket references */

/** Words shaped like `ABC-123` that are not tickets. */
const NOT_TICKETS = new Set([
  'UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'MD', 'ES', 'ECMA', 'IPV', 'PEP', 'WIN', 'UTC', 'GMT', 'CET',
  'GPT', 'COVID', 'NODE', 'JAVA', 'JDK', 'PY', 'PYTHON', 'VUE', 'NG', 'REACT', 'ANGULAR', 'SPRINT', 'RELEASE', 'VERSION', 'RC',
  'BETA', 'ALPHA', 'PHASE', 'STEP', 'ETAPE', 'LOT', 'TEST', 'TESTS', 'WIP', 'TMP', 'TEMP', 'POC', 'MVP', 'CHAPTER', 'PART',
  'X86', 'ARM', 'S3', 'EC2', 'H2', 'TOP', 'Q1', 'Q2', 'Q3', 'Q4', 'Y', 'W', 'V',
]);

/** A custom pattern must be a valid regular expression and stay short. */
function checkPattern(pattern: string): void {
  if (pattern.length > 200) throw new OkbError('E_INVALID', 'ticket pattern too long', { key: 'workspacePattern', params: { pattern } });
  try { new RegExp(pattern); } catch {
    throw new OkbError('E_INVALID', `invalid ticket pattern: ${pattern}`, { key: 'workspacePattern', params: { pattern } });
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ticket references in a text: with the team's prefixes when known (`ABC-123`,
 * also `abc-123` in a branch name), else any `ABC-123` written in capitals in a
 * message, or at the start of a branch segment (`feature/abc-123-…`).
 */
export function ticketRefs(text: string, rules: TicketRules | null, from: 'message' | 'branch'): string[] {
  const out: string[] = [];
  const push = (ref: string) => { const r = ref.toUpperCase(); if (!out.includes(r)) out.push(r); };
  if (rules?.pattern) {
    for (const m of text.matchAll(new RegExp(rules.pattern, from === 'branch' ? 'gi' : 'g'))) push(m[1] ?? m[0]);
    return out;
  }
  if (rules?.prefixes.length) {
    const re = new RegExp(`(?<![A-Za-z0-9])(${rules.prefixes.map(escape).join('|')})[-_ ]?(\\d{1,7})(?![0-9])`, 'gi');
    for (const m of text.matchAll(re)) push(`${m[1]}-${m[2]}`);
    return out;
  }
  const re = from === 'branch'
    ? /(?:^|[/_])([a-z][a-z0-9]{1,9})-(\d{1,7})(?=$|[-_/.])/gi
    : /(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?![\w-])/g;
  for (const m of text.matchAll(re)) {
    const prefix = m[1]!.toUpperCase();
    if (NOT_TICKETS.has(prefix) || /^\d/.test(prefix)) continue;
    push(`${prefix}-${m[2]}`);
  }
  return out;
}

/**
 * The ticket prefixes a team uses, from branch names and recent commit
 * subjects of its repositories: a prefix seen in at least two places, or in
 * two repositories, is theirs. Read-only, a few Git calls per repository.
 */
export async function learnPrefixes(repoRoots: readonly string[]): Promise<string[]> {
  const seen = new Map<string, { hits: number; repos: Set<string> }>();
  for (const root of repoRoots.slice(0, 40)) {
    const texts = [
      ...(await branchNames(root, 150)).flatMap((b) => ticketRefs(b, null, 'branch')),
      ...(await recentSubjects(root, 150)).flatMap((s) => ticketRefs(s, null, 'message')),
    ];
    for (const ref of texts) {
      const prefix = ref.split('-')[0]!;
      const entry = seen.get(prefix) ?? { hits: 0, repos: new Set<string>() };
      entry.hits++;
      entry.repos.add(root);
      seen.set(prefix, entry);
    }
  }
  return [...seen.entries()]
    .filter(([, v]) => v.hits >= 3 || v.repos.size >= 2)
    .sort((a, b) => b[1].hits - a[1].hits)
    .slice(0, 6)
    .map(([p]) => p);
}
