import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { loadConfig } from '../config/load.js';
import { t } from '../i18n/index.js';
import { claudeState, launcherState, productVersion } from '../integrations/system.js';
import { isInside, kbNames, listKbs, obsidianVaults, readOwner } from '../kb/registry.js';
import { cloudSyncedFolder } from '../repo/confidential.js';
import { gitRoot } from '../repo/git.js';
import { listRepos, repoForDir } from '../repo/registry.js';
import { kindOf, type KbKind } from '../work/kinds.js';
import { listWorkspaces, looksLikeNotes, reposIn, workspaceForDir } from '../work/workspaces.js';

/**
 * Where the person stands, read without AI and without writing anything:
 * the KBs, workspaces and repositories OKB knows, what lies around the
 * current folder (a folder of repositories, a KB written before OKB), the
 * Claude plugin — and, from that, recommendations and a plan of exact
 * commands. `okb start` shows it; the setup skill asks the person and runs it.
 */
export type Situation = 'ready-repo' | 'ready-workspace' | 'team-repos' | 'single-repo' | 'notes' | 'subject' | 'kb-only';

export type Advice = { readonly code: string; readonly level: 'do' | 'advice' | 'warn'; readonly params: Record<string, string>; readonly text: string };

export type PlanStep = {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** The `okb` command, `{name}` and `{id}` replaced by the KB name the person gives and its id; null when it runs in Claude. */
  readonly argv: readonly string[] | null;
  /** A command to type in Claude Code (it uses AI), for later or now. */
  readonly inClaude: string | null;
  /** The person must name the KB first (never suggested from a person's name). */
  readonly asksName: boolean;
  readonly nameHint: string | null;
  readonly optional: boolean;
  /** It asks its own questions: run it in a terminal (the installer of the plugin and the `okb` command). */
  readonly interactive: boolean;
};

export type TreeEntry = {
  readonly name: string;
  readonly path: string;
  readonly kind: 'repo' | 'repo-in' | 'kb' | 'old-kb' | 'group' | 'other';
  readonly kb: string | null;
  readonly notes: number;
  /** For a group (a team's subfolder): the repositories inside. */
  readonly repos: readonly string[];
};

export type Discovery = {
  readonly version: string;
  readonly cwd: string;
  readonly situation: Situation;
  readonly here: { readonly repo: string | null; readonly workspace: string | null; readonly kb: string | null; readonly gitRoot: string | null };
  readonly kbs: readonly { readonly id: string; readonly name: string; readonly root: string; readonly kind: KbKind; readonly active: boolean; readonly exists: boolean; readonly confidential: boolean; readonly synced: string | null; readonly brain: string | null }[];
  readonly workspaces: readonly { readonly id: string; readonly name: string; readonly kb: string; readonly roots: readonly string[] }[];
  readonly repos: number;
  readonly reposFolder: { readonly path: string; readonly repos: readonly { readonly name: string; readonly path: string; readonly kb: string | null }[]; readonly workspace: string | null } | null;
  readonly notesFolders: readonly { readonly path: string; readonly notes: number; readonly kb: string | null }[];
  /** The folder of repositories, one line per subfolder: what it is for OKB. */
  readonly tree: readonly TreeEntry[];
  readonly vaults: readonly string[];
  readonly tools: { readonly claude: boolean; readonly plugin: 'ok' | 'missing' | 'outdated' | 'no-claude'; readonly launcher: boolean };
  readonly advice: readonly Advice[];
  readonly plan: readonly PlanStep[];
  /** How to work once it is set up. */
  readonly next: readonly string[];
};

const MANIFEST = /^(package\.json|pom\.xml|build\.gradle(\.kts)?|go\.mod|Cargo\.toml|pyproject\.toml|requirements\.txt|setup\.py|Gemfile|composer\.json|mta\.yaml|.+\.csproj|.+\.sln|Makefile)$/;

/** A folder of Markdown notes (under Git or not): mostly `.md`, no project manifest. */
async function notesIn(dir: string): Promise<number | null> {
  if ((await gitRoot(dir)) === resolve(dir)) return (await looksLikeNotes(dir)) ? await countMarkdown(dir) : null;
  let md = 0;
  let other = 0;
  let manifest = false;
  const walk = async (d: string, depth: number) => {
    if (depth > 3 || md + other > 3000) return;
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory()) await walk(resolve(d, e.name), depth + 1);
      else if (e.isFile()) {
        if (MANIFEST.test(e.name)) manifest = true;
        if (/\.(md|markdown)$/i.test(e.name)) md++;
        else if (!['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'].includes(extname(e.name).toLowerCase())) other++;
      }
    }
  };
  await walk(dir, 0);
  return !manifest && md >= 5 && md / Math.max(1, md + other) >= 0.6 ? md : null;
}

async function countMarkdown(dir: string): Promise<number> {
  const { listFiles } = await import('../repo/git.js');
  return ((await listFiles(dir).catch(() => null)) ?? []).filter((f) => /\.(md|markdown)$/i.test(f)).length;
}

async function isDir(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isDirectory(), () => false);
}

export async function discover(cwdArg = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<Discovery> {
  const cwd = resolve(cwdArg);
  const [version, kbList, workspaces, repos, claude, launcher] = await Promise.all([productVersion(), listKbs(env), listWorkspaces(env), listRepos(env), claudeState(), launcherState()]);
  const kbs = await Promise.all(kbList.map(async (k) => {
    const config = await loadConfig({ profileId: k.id, env }).then((r) => r.config, () => null);
    return { id: k.id, name: k.name, root: k.root, kind: await kindOf(k.id, config, env).catch(() => 'topic' as const), active: k.active, exists: k.exists, confidential: config?.kb.confidential ?? false, synced: cloudSyncedFolder(k.root), brain: config?.kb.brain?.preset ?? null };
  }));
  const here = {
    repo: (await repoForDir(cwd, env).catch(() => null))?.repo ?? null,
    workspace: await workspaceForDir(cwd, env),
    kb: kbs.find((k) => isInside(cwd, k.root)) ?? null,
    gitRoot: await gitRoot(cwd),
  };

  // A folder of repositories: here, or the folder above the repository we are in, or the parent.
  const candidates = [...new Set([cwd, ...(here.gitRoot ? [dirname(here.gitRoot)] : []), dirname(cwd)])];
  let reposFolder: Discovery['reposFolder'] = null;
  const notesFolders: { path: string; notes: number; kb: string | null }[] = [];
  for (const c of candidates) {
    const found = await reposIn(c, env).catch(() => [] as string[]);
    const code: string[] = [];
    for (const r of found) if (!(await looksLikeNotes(r))) code.push(r);
    if (code.length >= 2 || (code.length >= 1 && c === cwd && !here.gitRoot)) {
      reposFolder = {
        path: c,
        repos: code.map((p) => ({ name: basename(p), path: p, kb: repos.find((r) => resolve(r.path) === resolve(p))?.kb ?? null })),
        workspace: (await workspaceForDir(c, env))?.id ?? null,
      };
      break;
    }
  }
  // KBs written before OKB: beside the repositories, or the current folder itself.
  const look = new Set<string>([cwd]);
  if (reposFolder) for (const d of await readdir(reposFolder.path, { withFileTypes: true }).catch(() => [])) if (d.isDirectory() && !d.name.startsWith('.')) look.add(resolve(reposFolder.path, d.name));
  for (const dir of look) {
    if (!(await isDir(dir)) || repos.some((r) => resolve(r.path) === dir)) continue;
    const kb = kbs.find((k) => resolve(k.root) === dir) ?? null;
    const owned = kb ? null : await readOwner(dir).catch(() => null);
    if (owned) continue; // an OKB KB whose profile is gone: not a candidate
    const notes = await notesIn(dir);
    if (notes !== null || kb) notesFolders.push({ path: dir, notes: notes ?? 0, kb: kb?.id ?? null });
  }

  const vaults = (await obsidianVaults(env).catch(() => [])).map((v) => v.path);
  const pluginState: Discovery['tools']['plugin'] = !claude.cli ? 'no-claude' : !claude.installed ? 'missing' : claude.version && claude.version !== version ? 'outdated' : 'ok';
  const tools = { claude: Boolean(claude.cli), plugin: pluginState, launcher: Boolean(launcher.onPath) };

  const advice: Advice[] = [];
  const say = (code: string, level: Advice['level'], params: Record<string, string> = {}) => advice.push({ code, level, params, text: t(`start.advice.${code}`, params) });
  const plan: PlanStep[] = [];
  const step = (s: Omit<PlanStep, 'title' | 'why' | 'asksName' | 'nameHint' | 'optional' | 'interactive'> & { params?: Record<string, string>; asksName?: boolean; nameHint?: string | null; optional?: boolean; interactive?: boolean }) =>
    plan.push({ id: s.id, argv: s.argv, inClaude: s.inClaude, asksName: s.asksName ?? false, nameHint: s.nameHint ?? null, optional: s.optional ?? false, interactive: s.interactive ?? false, title: t(`start.step.${s.id}`, s.params ?? {}), why: t(`start.why.${s.id}`, s.params ?? {}) });

  // The folder of repositories, subfolder by subfolder.
  const tree: TreeEntry[] = [];
  if (reposFolder) {
    for (const d of (await readdir(reposFolder.path, { withFileTypes: true }).catch(() => [])).filter((x) => x.isDirectory() && !x.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(reposFolder.path, d.name);
      const r = reposFolder.repos.find((x) => resolve(x.path) === path);
      const nf = notesFolders.find((n) => n.path === path);
      const kb = kbs.find((k) => resolve(k.root) === path);
      const inside = reposFolder.repos.filter((x) => dirname(resolve(x.path)) === path);
      const entry = { name: d.name, path, kb: null as string | null, notes: 0, repos: [] as string[] };
      if (r) tree.push({ ...entry, kind: r.kb ? 'repo-in' : 'repo', kb: r.kb });
      else if (kb || nf?.kb) tree.push({ ...entry, kind: 'kb', kb: kb?.id ?? nf!.kb });
      else if (nf) tree.push({ ...entry, kind: 'old-kb', notes: nf.notes });
      else if (inside.length) tree.push({ ...entry, kind: 'group', repos: inside.map((x) => x.name) });
      else tree.push({ ...entry, kind: 'other' });
    }
  }

  let situation: Situation;
  const next: string[] = [];
  const oldKb = notesFolders.find((n) => !n.kb && n.notes > 0) ?? null;
  const connectedHere = reposFolder ? notesFolders.find((n) => n.kb && isInside(n.path, reposFolder!.path)) ?? null : null;
  const wsOfFolder = (reposFolder?.workspace ? workspaces.find((w) => w.id === reposFolder!.workspace) : null) ?? here.workspace ?? null;
  if (here.repo) {
    situation = 'ready-repo';
    say('readyRepo', 'do', { repo: here.repo.name });
    // Added alone, with repositories beside it that OKB does not know: the folder becomes a workspace.
    if (reposFolder && !wsOfFolder && reposFolder.repos.some((r) => !r.kb)) {
      const params = { folder: reposFolder.path, n: String(reposFolder.repos.length) };
      say('siblingsOutside', 'advice', params);
      if ((await kindOf(here.repo.kb, null, env).catch(() => 'topic')) !== 'repo') step({ id: 'workspace', argv: ['workspace', 'add', reposFolder.path, '--kb', here.repo.kb], inClaude: null, params });
      else step({ id: 'workspaceNew', argv: ['workspace', 'add', reposFolder.path, '--new-kb', '{name}'], inClaude: null, asksName: true, nameHint: t('repo.add.newKbDefault'), params });
    }
    next.push(t('start.next.ticketHere'));
  } else if (wsOfFolder) {
    situation = 'ready-workspace';
    say('readyWorkspace', 'do', { ws: wsOfFolder.name });
    next.push(t('start.next.openRepo', { folder: wsOfFolder.roots[0] ?? '' }), t('start.next.ticket'));
  } else if (reposFolder) {
    situation = 'team-repos';
    const params = { folder: reposFolder.path, n: String(reposFolder.repos.length) };
    say('teamRepos', 'do', params);
    if (oldKb) {
      say('oldKb', 'do', { folder: oldKb.path, n: String(oldKb.notes) });
      step({ id: 'connectOld', argv: ['kb', 'add', oldKb.path, '--name', '{name}', '--confidential'], inClaude: null, asksName: true, nameHint: t('repo.add.newKbDefault'), params: { folder: oldKb.path } });
      step({ id: 'workspace', argv: ['workspace', 'add', reposFolder.path, '--kb', '{id}'], inClaude: null, params });
      step({ id: 'convert', argv: null, inClaude: '/okb:convert', optional: true, params: { folder: oldKb.path } });
      step({ id: 'brain', argv: null, inClaude: '/okb:maintain', optional: true, params: { folder: oldKb.path } });
    } else if (connectedHere) {
      step({ id: 'workspace', argv: ['workspace', 'add', reposFolder.path, '--kb', connectedHere.kb!], inClaude: null, params });
    } else {
      step({ id: 'workspaceNew', argv: ['workspace', 'add', reposFolder.path, '--new-kb', '{name}'], inClaude: null, asksName: true, nameHint: t('repo.add.newKbDefault'), params });
    }
    if (here.gitRoot) next.push(t('start.next.ticketHere'));
    else next.push(t('start.next.openRepo', { folder: reposFolder.path }), t('start.next.ticket'));
  } else if (here.gitRoot && !(await looksLikeNotes(here.gitRoot))) {
    situation = 'single-repo';
    say('singleRepo', 'do', { repo: basename(here.gitRoot) });
    step({ id: 'repoKb', argv: ['repo', 'add', here.gitRoot, '--new-repo-kb', '{name}'], inClaude: null, asksName: true, nameHint: basename(here.gitRoot), params: { repo: basename(here.gitRoot) } });
    step({ id: 'onboard', argv: null, inClaude: '/okb-dev:onboard', optional: true, params: { repo: basename(here.gitRoot) } });
    next.push(t('start.next.ticketHere'));
  } else if (oldKb) {
    situation = 'notes';
    say('oldKb', 'do', { folder: oldKb.path, n: String(oldKb.notes) });
    step({ id: 'connectOld', argv: ['kb', 'add', oldKb.path, '--name', '{name}'], inClaude: null, asksName: true, nameHint: kbNames(basename(oldKb.path)).display, params: { folder: oldKb.path } });
    step({ id: 'convert', argv: null, inClaude: '/okb:convert', optional: true, params: { folder: oldKb.path } });
    step({ id: 'brain', argv: null, inClaude: '/okb:maintain', optional: true, params: { folder: oldKb.path } });
  } else if (!kbs.length) {
    situation = 'subject';
    say('subject', 'do');
    step({ id: 'topic', argv: ['init', '--yes', '--name', '{name}', '--kind', 'topic', '--brain', 'topics'], inClaude: null, asksName: true, nameHint: null });
  } else {
    situation = 'kb-only';
    say('kbOnly', 'advice', { n: String(kbs.length) });
  }

  // Every repository of the workspace's folder belongs to it: the ones left out are added.
  if (reposFolder && wsOfFolder) {
    const missing = reposFolder.repos.filter((r) => !r.kb);
    if (missing.length) {
      const params = { ws: wsOfFolder.name, n: String(missing.length), names: missing.map((r) => r.name).join(', '), folder: reposFolder.path };
      say('missingRepos', 'do', params);
      step({ id: 'syncWorkspace', argv: ['workspace', 'add', reposFolder.path, '--to', wsOfFolder.id], inClaude: null, params });
    }
    for (const r of reposFolder.repos.filter((x) => x.kb && x.kb !== wsOfFolder.kb)) {
      const k = kbs.find((x) => x.id === r.kb);
      if (k && k.kind !== 'repo') say('elsewhere', 'warn', { repo: r.name, kb: k.name, ws: wsOfFolder.name });
    }
  }
  // Repositories spread in team subfolders: one workspace, or one per team if they are different teams or employers.
  const groups = tree.filter((e) => e.kind === 'group');
  if (groups.length >= 2) say('groups', 'advice', { names: groups.map((g) => g.name).join(', ') });

  // Tools: the Claude plugin and the `okb` command.
  if (pluginState === 'missing' || pluginState === 'outdated' || !launcher.onPath) {
    step({ id: 'tools', argv: ['doctor', '--fix'], inClaude: null, interactive: true, params: {} });
  }
  if (pluginState === 'no-claude') say('noClaude', 'advice');
  // What deserves a word about the KBs already there.
  for (const k of kbs) {
    if (!k.exists) say('kbMissing', 'warn', { kb: k.name, root: k.root });
    else if (k.confidential && k.synced) say('kbSynced', 'warn', { kb: k.name, where: k.synced });
  }
  const sameEmployer = kbs.filter((k) => k.kind === 'workspace');
  if (situation === 'team-repos' && sameEmployer.length && !oldKb && !connectedHere) say('otherWorkKb', 'advice', { kbs: sameEmployer.map((k) => k.name).join(', ') });
  if (reposFolder && notesFolders.some((n) => n.kb && isInside(n.path, reposFolder!.path))) say('kbBeside', 'advice', {});

  return {
    version, cwd, situation,
    here: { repo: here.repo?.id ?? null, workspace: here.workspace?.id ?? null, kb: here.kb?.id ?? null, gitRoot: here.gitRoot },
    kbs, workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, kb: w.kb, roots: w.roots })),
    repos: repos.length, reposFolder, notesFolders, tree, vaults, tools, advice, plan, next,
  };
}

/** The plan's command with the KB name the person gave (`{name}`) and its id (`{id}`). */
export function fillStep(argv: readonly string[], name: string | null): string[] {
  const id = name ? kbNames(name).id : '';
  return argv.map((a) => a.replace('{name}', name ?? '').replace('{id}', id));
}
