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

/* ---------- Git and GitHub ---------- */

export async function gitAvailable(): Promise<boolean> {
  return (await which('git')) !== null;
}

export async function ghState(): Promise<{ cli: string | null; loggedIn: boolean; user: string | null }> {
  const cli = (await which('gh')) ?? (await access('/opt/homebrew/bin/gh').then(() => '/opt/homebrew/bin/gh', () => null));
  if (!cli) return { cli: null, loggedIn: false, user: null };
  const r = await tryRun(cli, ['api', 'user', '--jq', '.login'], { timeout: 15_000 });
  return { cli, loggedIn: r.ok && Boolean(r.out), user: r.ok ? r.out : null };
}

/** `git init` with a first commit of what is there (README in `.github/` so OKB never reads it as a note). */
export async function initKbRepository(root: string, readme: string): Promise<{ ok: boolean; error?: string }> {
  const { writeTextAtomic } = await import('../util/fsx.js');
  const already = await tryRun('git', ['-C', root, 'rev-parse', '--show-toplevel']);
  if (already.ok && resolve(already.out) === resolve(root)) return { ok: true };
  const init = await tryRun('git', ['-C', root, 'init', '-q', '-b', 'main']);
  if (!init.ok) return { ok: false, error: init.err };
  await writeTextAtomic(resolve(root, '.github', 'README.md'), readme);
  await tryRun('git', ['-C', root, 'add', '-A']);
  const commit = await tryRun('git', ['-C', root, 'commit', '-q', '-m', 'KB créée avec OKB']);
  return commit.ok ? { ok: true } : { ok: false, error: commit.err };
}

/** A private GitHub repository for the KB, pushed. Only with `gh` logged in, only on request. */
export async function createPrivateRepo(root: string, name: string, description: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const gh = await ghState();
  if (!gh.cli || !gh.loggedIn) return { ok: false, error: 'gh-not-logged-in' };
  const r = await tryRun(gh.cli, ['repo', 'create', name, '--private', '--description', description, '--source', root, '--remote', 'origin', '--push'], { cwd: root, timeout: 120_000 });
  if (!r.ok) return { ok: false, error: r.err };
  const url = await tryRun(gh.cli, ['repo', 'view', name, '--json', 'url', '--jq', '.url'], { cwd: root });
  return { ok: true, ...(url.ok ? { url: url.out } : {}) };
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

export async function updateProduct(onStep: (step: string, ok: boolean, detail?: string) => void): Promise<boolean> {
  const repo = await tryRun('git', ['-C', PRODUCT_ROOT, 'rev-parse', '--show-toplevel']);
  if (repo.ok) {
    const pull = await tryRun('git', ['-C', PRODUCT_ROOT, 'pull', '--ff-only'], { timeout: 120_000 });
    onStep('pull', pull.ok, pull.ok ? pull.out.split('\n').pop() : pull.err);
    if (!pull.ok) return false;
  } else {
    onStep('pull', true, 'not a Git checkout: skipped');
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
