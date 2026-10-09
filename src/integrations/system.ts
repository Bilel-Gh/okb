import { execFile, spawn } from 'node:child_process';
import { access, constants, lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The few places OKB reaches outside itself, always on the person's request:
 * Claude Code (plugin), the shell (an `okb` command on the PATH), Git and
 * GitHub (a repository per KB), Obsidian and the browser (opening things).
 * Each returns what happened; none changes a setting it was not asked to.
 */
const run = promisify(execFile);

export const PRODUCT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function which(cmd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const p = resolve(dir, cmd);
    try { await access(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

async function tryRun(cmd: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const r = await run(cmd, args, { cwd: options.cwd, timeout: options.timeout ?? 60_000, maxBuffer: 4_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return { ok: true, out: r.stdout.trim(), err: r.stderr.trim() };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: String(x.stdout ?? '').trim(), err: String(x.stderr ?? x.message ?? '').trim() };
  }
}

export async function productVersion(): Promise<string> {
  try { return (JSON.parse(await readFile(resolve(PRODUCT_ROOT, 'package.json'), 'utf8')) as { version: string }).version; } catch { return 'unknown'; }
}

/* ---------- Claude Code ---------- */

export type ClaudeState = { readonly cli: string | null; readonly installed: boolean; readonly version: string | null; readonly marketplace: boolean };

export async function claudeState(): Promise<ClaudeState> {
  const cli = await which('claude');
  if (!cli) return { cli: null, installed: false, version: null, marketplace: false };
  const home = process.env.HOME ?? '';
  let installed = false, version: string | null = null, marketplace = false;
  try {
    const data = JSON.parse(await readFile(resolve(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, { version?: string }[]> };
    const entry = Object.entries(data.plugins ?? {}).find(([k]) => k === 'okb@okb' || k.startsWith('okb@'));
    if (entry) { installed = true; version = entry[1][0]?.version ?? null; }
  } catch { /* none */ }
  try {
    const known = JSON.parse(await readFile(resolve(home, '.claude', 'plugins', 'known_marketplaces.json'), 'utf8')) as Record<string, unknown>;
    marketplace = 'okb' in known;
  } catch { /* none */ }
  return { cli, installed, version, marketplace };
}

/** Register this folder as the `okb` plugin catalogue and (re)install the plugin for every session. */
export async function installClaudePlugin(): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const state = await claudeState();
  if (!state.cli) return { ok: false, steps: [], error: 'claude-missing' };
  const steps: string[] = [];
  if (state.installed) {
    // An update keeps the installation as it is (scope, enabled state); reinstall only if it fails.
    const up = await tryRun(state.cli, ['plugin', 'update', 'okb@okb'], { timeout: 120_000 });
    steps.push(`update: ${up.ok ? 'ok' : up.err}`);
    if (up.ok) return { ok: true, steps };
    const r = await tryRun(state.cli, ['plugin', 'uninstall', 'okb@okb']);
    steps.push(`uninstall: ${r.ok ? 'ok' : r.err}`);
  }
  if (!state.marketplace) {
    const r = await tryRun(state.cli, ['plugin', 'marketplace', 'add', PRODUCT_ROOT]);
    steps.push(`marketplace: ${r.ok ? 'ok' : r.err}`);
    if (!r.ok) return { ok: false, steps, error: r.err };
  }
  const r = await tryRun(state.cli, ['plugin', 'install', 'okb@okb']);
  steps.push(`install: ${r.ok ? 'ok' : r.err}`);
  return r.ok ? { ok: true, steps } : { ok: false, steps, error: r.err };
}

/** OKB plugins (the core and each module) Claude Code has installed, by plugin name. */
export async function claudeModules(home: string = process.env.HOME ?? ''): Promise<Record<string, { installed: boolean; version: string | null }>> {
  const { MODULES } = await import('../modules/catalog.js');
  let plugins: Record<string, { version?: string }[]> = {};
  try {
    plugins = (JSON.parse(await readFile(resolve(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: typeof plugins }).plugins ?? {};
  } catch { /* Claude Code never installed a plugin */ }
  const out: Record<string, { installed: boolean; version: string | null }> = {};
  for (const m of MODULES) {
    if (!m.plugin) continue;
    const entry = plugins[`${m.plugin}@okb`];
    out[m.plugin] = { installed: Boolean(entry), version: entry?.[0]?.version ?? null };
  }
  return out;
}

/**
 * Install a module's plugin in Claude Code (on the person's click): register
 * this folder as the `okb` catalogue when needed, then install or update the
 * plugin. The core plugin goes first when it is missing: a module depends on it.
 */
export async function installClaudeModule(id: string, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const { entitled, moduleDef } = await import('../modules/catalog.js');
  const def = moduleDef(id);
  if (!def?.plugin) return { ok: false, steps: [], error: 'no-plugin' };
  // A module that needs a licence is installed only once it is held (none does yet).
  if (!entitled(def.id)) return { ok: false, steps: [], error: 'not-entitled' };
  if (def.plugin === 'okb') return installClaudePlugin();
  const state = await claudeState();
  if (!state.cli) return { ok: false, steps: [], error: 'claude-missing' };
  const steps: string[] = [];
  if (!state.installed) {
    const core = await installClaudePlugin();
    steps.push(...core.steps);
    if (!core.ok) return { ok: false, steps, ...(core.error ? { error: core.error } : {}) };
  }
  const installed = (await claudeModules(env.HOME ?? ''))[def.plugin]?.installed;
  const r = await tryRun(state.cli, installed ? ['plugin', 'update', `${def.plugin}@okb`] : ['plugin', 'install', `${def.plugin}@okb`], { timeout: 120_000 });
  steps.push(`${installed ? 'update' : 'install'} ${def.plugin}: ${r.ok ? 'ok' : r.err}`);
  return r.ok ? { ok: true, steps } : { ok: false, steps, error: r.err };
}

/* ---------- The `okb` command on the PATH ---------- */

export type LauncherState = { readonly onPath: string | null; readonly candidates: readonly string[] };

export async function launcherState(): Promise<LauncherState> {
  const onPath = await which('okb');
  const home = process.env.HOME ?? '';
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const preferred = [resolve(home, '.local', 'bin'), resolve(home, 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const candidates: string[] = [];
  for (const d of [...preferred.filter((p) => dirs.includes(p)), ...dirs.filter((p) => p.startsWith(home) && !preferred.includes(p))]) {
    try { await access(d, constants.W_OK); candidates.push(d); } catch { /* not writable */ }
  }
  return { onPath, candidates: [...new Set(candidates)] };
}

const LAUNCHER_MARK = '# okb launcher (written by okb init)';

/** A tiny `okb` script in a folder already on the PATH. No shell file is edited; an existing foreign `okb` is left alone. */
export async function installLauncher(dir: string): Promise<string> {
  const target = resolve(PRODUCT_ROOT, 'dist', 'cli', 'index.js');
  const path = resolve(dir, 'okb');
  await mkdir(dir, { recursive: true });
  try {
    const st = await lstat(path);
    const mine = st.isSymbolicLink() || (await readFile(path, 'utf8').catch(() => '')).includes(LAUNCHER_MARK);
    if (!mine) throw new Error(`${path} exists and is not an OKB launcher: left untouched`);
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { writeFile, chmod } = await import('node:fs/promises');
  await writeFile(path, `#!/bin/sh\n${LAUNCHER_MARK}\nexec "${process.execPath}" "${target}" "$@"\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

/* ---------- Opening things ---------- */

export function obsidianUrl(absolutePath: string): string {
  return `obsidian://open?path=${encodeURIComponent(absolutePath)}`;
}

/** Hand a URL or a file to the system (Obsidian, browser, default app). */
export function openExternal(target: string): Promise<boolean> {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  return new Promise((done) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => done(false));
      child.on('spawn', () => { child.unref(); done(true); });
    } catch {
      done(false);
    }
  });
}

/** Is Obsidian installed on this machine? (Used to prefer obsidian:// links.) */
export async function obsidianInstalled(): Promise<boolean> {
  if (process.platform === 'darwin') return access('/Applications/Obsidian.app').then(() => true, () => false);
  return (await which('obsidian')) !== null;
}

/* ---------- Updating OKB itself ---------- */

/** How this copy of OKB was installed: it decides how it updates. */
export async function installKind(): Promise<'git' | 'npm-global' | 'folder'> {
  if ((await tryRun('git', ['-C', PRODUCT_ROOT, 'rev-parse', '--show-toplevel'])).ok) return 'git';
  return /[\\/]node_modules[\\/]okb$/.test(PRODUCT_ROOT) ? 'npm-global' : 'folder';
}

/** Access to the repository refused or unreachable, as opposed to a local problem (conflict, local edits). */
export function pullDenied(err: string): boolean {
  return /permission denied|authentication failed|could not read username|repository not found|access denied|403|401|could not resolve host|publickey/i.test(err);
}

export async function updateProduct(onStep: (step: string, ok: boolean, detail?: string) => void, options: { from?: string } = {}): Promise<boolean> {
  const kind = await installKind();
  if (options.from) {
    // A package (okb-x.y.z.tgz from `npm pack`) or a folder holding a newer copy of OKB.
    const from = resolve(options.from);
    const pkg = await readPackageVersion(from);
    if (!pkg) { onStep('package', false, 'not an OKB package'); return false; }
    onStep('package', true, `${pkg}`);
    if (kind === 'git') { onStep('install', false, 'git-checkout'); return false; }
    if (kind === 'npm-global') {
      const npm = (await which('npm')) ?? 'npm';
      const r = await tryRun(npm, ['install', '-g', from, '--no-audit', '--no-fund'], { timeout: 600_000 });
      onStep('install', r.ok, r.ok ? undefined : r.err.split('\n').slice(-3).join(' '));
      if (!r.ok) return false;
    } else {
      const copied = await replaceInstall(from);
      onStep('install', copied.ok, copied.error);
      if (!copied.ok) return false;
      const npm = (await which('npm')) ?? 'npm';
      const deps = await tryRun(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: PRODUCT_ROOT, timeout: 600_000 });
      onStep('install', deps.ok, deps.ok ? undefined : deps.err.split('\n').slice(-3).join(' '));
      if (!deps.ok) return false;
    }
    const claude = await claudeState();
    if (claude.cli) {
      const plugin = await installClaudePlugin();
      onStep('plugin', plugin.ok, plugin.error);
    }
    return true;
  }
  if (kind === 'git') {
    const pull = await tryRun('git', ['-C', PRODUCT_ROOT, 'pull', '--ff-only'], { timeout: 120_000 });
    onStep('pull', pull.ok, pull.ok ? pull.out.split('\n').pop() : pullDenied(pull.err) ? 'no-access' : pull.err);
    if (!pull.ok) return false;
  } else {
    // Without Git there is nothing to pull from: the new version comes as a package.
    onStep('pull', false, 'needs-package');
    return false;
  }
  const npm = (await which('npm')) ?? 'npm';
  const install = await tryRun(npm, ['ci', '--no-audit', '--no-fund'], { cwd: PRODUCT_ROOT, timeout: 600_000 });
  onStep('install', install.ok, install.ok ? undefined : install.err.split('\n').slice(-3).join(' '));
  if (!install.ok) return false;
  const build = await tryRun(npm, ['run', 'build'], { cwd: PRODUCT_ROOT, timeout: 300_000 });
  onStep('build', build.ok, build.ok ? undefined : build.err.split('\n').slice(-3).join(' '));
  if (!build.ok) return false;
  const claude = await claudeState();
  if (claude.cli) {
    const plugin = await installClaudePlugin();
    onStep('plugin', plugin.ok, plugin.error);
  } else {
    onStep('plugin', true, 'Claude Code not found: skipped');
  }
  return true;
}

/** The version inside an OKB package (.tgz) or folder, or null when it is not OKB. */
async function readPackageVersion(from: string): Promise<string | null> {
  try {
    if (from.endsWith('.tgz') || from.endsWith('.tar.gz')) {
      const r = await tryRun('tar', ['-xzOf', from, 'package/package.json']);
      const pkg = r.ok ? (JSON.parse(r.out) as { name?: string; version?: string }) : null;
      return pkg?.name === 'okb' ? pkg.version ?? null : null;
    }
    const pkg = JSON.parse(await readFile(resolve(from, 'package.json'), 'utf8')) as { name?: string; version?: string };
    return pkg.name === 'okb' ? pkg.version ?? null : null;
  } catch { return null; }
}

/**
 * Replace this copy's files with the package's: the shipped folders are swapped
 * whole (no stale file survives), profiles and KBs are elsewhere and untouched.
 */
async function replaceInstall(from: string): Promise<{ ok: boolean; error?: string }> {
  const { mkdtemp, rm, cp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const work = await mkdtemp(resolve(tmpdir(), 'okb-update-'));
  try {
    let src = from;
    if (from.endsWith('.tgz') || from.endsWith('.tar.gz')) {
      const r = await tryRun('tar', ['-xzf', from, '-C', work]);
      if (!r.ok) return { ok: false, error: r.err };
      src = resolve(work, 'package');
    }
    for (const entry of await readdir(src)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const target = resolve(PRODUCT_ROOT, entry);
      await rm(target, { recursive: true, force: true });
      await cp(resolve(src, entry), target, { recursive: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

