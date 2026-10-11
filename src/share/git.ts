import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { OkbError } from '../util/errors.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';
import { drawerName } from './manifest.js';

/**
 * Git for the shared folder, and only for it. The folder is the local copy of a
 * repository the colleagues have in common — not a knowledge base: OKB never
 * commits nor pushes a KB (D33). Here it stages the person's own drawer,
 * commits it and pushes, or pulls, and only when the person asks.
 */
const run = promisify(execFile);
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

export const isGitFolder = (folder: string) => existsSync(resolve(folder, '.git'));

async function git(folder: string, args: readonly string[], timeout = 60_000): Promise<string> {
  const { stdout } = await run('git', ['-C', folder, ...args], { env: ENV, timeout, maxBuffer: 16_000_000 });
  return stdout;
}

/** Where the folder goes, without credentials: `https://user:token@host/x.git` → `https://host/x.git`. Null without a remote. */
export async function remoteOf(folder: string): Promise<string | null> {
  if (!isGitFolder(folder)) return null;
  const url = await git(folder, ['remote', 'get-url', 'origin'], 5000).then((s) => s.trim(), () => '');
  if (!url) return null;
  try {
    const u = new URL(url);
    u.username = ''; u.password = ''; u.search = ''; u.hash = '';
    return u.toString();
  } catch {
    return url.replace(/^[^@/]+@/, '');
  }
}

const said = (error: unknown) => String((error as { stderr?: string }).stderr || (error as Error).message).replace(/(https?:\/\/)[^\s/@]+@/g, '$1').trim().split('\n').slice(-3).join(' ').slice(0, 300);

/**
 * Take what the colleagues sent into the local copy. Each person writes only
 * in their own drawer, so replaying the person's commits after theirs cannot
 * conflict. False when there is nothing to take yet (no remote, or an empty one).
 */
async function integrate(folder: string): Promise<boolean> {
  if (!(await git(folder, ['remote']).catch(() => '')).split('\n').includes('origin')) return false;
  await git(folder, ['fetch', 'origin']);
  const branch = (await git(folder, ['symbolic-ref', '--short', 'HEAD'])).trim();
  const theirs = `refs/remotes/origin/${branch}`;
  if (!(await git(folder, ['rev-parse', '--verify', '--quiet', theirs]).then(() => true, () => false))) return false;
  const born = await git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false);
  if (born) {
    const head = (await git(folder, ['rev-parse', 'HEAD'])).trim();
    const remote = (await git(folder, ['rev-parse', theirs])).trim();
    // A fast-forward merge preserves disjoint local preparation and its index;
    // a divergent history needs a clean rebase and fails visibly otherwise.
    if (head !== remote && !(await git(folder, ['merge-base', '--is-ancestor', theirs, 'HEAD']).then(() => true, () => false))) {
      const fastForward = await git(folder, ['merge-base', '--is-ancestor', 'HEAD', theirs]).then(() => true, () => false);
      await git(folder, fastForward ? ['merge', '--ff-only', theirs] : ['rebase', theirs]);
    }
  }
  else {
    // A fresh copy with no commit of its own: start from theirs, and keep what is already on disk (the person's drawer, not yet committed).
    // Normal checkout refuses overlapping untracked files instead of overwriting them.
    await git(folder, ['checkout', '-B', branch, theirs]);
  }
  return true;
}

/** A push publishes prior commits too: those were not authorised by this preview. Leave them to a manual Git review. */
export async function assertNoPendingCommits(folder: string): Promise<void> {
  if (!(await git(folder, ['remote'])).split('\n').includes('origin')) return;
  if (!(await git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false))) return;
  const branch = (await git(folder, ['symbolic-ref', '--short', 'HEAD'])).trim();
  const remote = `refs/remotes/origin/${branch}`;
  const known = await git(folder, ['rev-parse', '--verify', '--quiet', remote]).then(() => true, () => false);
  if (!known || Number((await git(folder, ['rev-list', '--count', `${remote}..HEAD`])).trim()) > 0) {
    throw new OkbError('E_CONFLICT', 'local commits already await publication; inspect them before pushing manually', {
      key: 'sharePendingCommits', hint: 'In the shared copy, inspect git status and git log --branches --not --remotes. A prior failed push may have left a local commit.',
    });
  }
}

/** Commit the person's drawer (and nothing else) in the local copy, then send it. Nothing is forced. */
export async function pushDrawer(folder: string, drawer: string, message: string, paths: readonly string[]): Promise<{ committed: boolean; pushed: boolean }> {
  if (!isGitFolder(folder)) throw new OkbError('E_INVALID', 'the shared folder is not a Git checkout', { key: 'shareNoGit' });
  if (!drawerName.test(drawer)) throw new OkbError('E_FORBIDDEN_PATH', 'invalid drawer name');
  const candidates = paths.map((p) => `${drawer}/${asBundlePath(p)}`);
  for (const path of candidates) await assertInsideRoot(folder, path);
  try {
    const selected: string[] = [];
    for (const path of candidates) {
      // A file removed before its first commit has no Git path to stage.
      if (existsSync(resolve(folder, path)) || (await git(folder, ['--literal-pathspecs', 'ls-files', '--', path])).trim()) selected.push(path);
    }
    // Exact managed paths, never the whole drawer: loose files and unrelated staged changes stay local.
    await git(folder, ['--literal-pathspecs', 'add', '--all', '--', ...selected]);
    const staged = await git(folder, ['--literal-pathspecs', 'diff', '--cached', '--name-only', '--', ...selected]);
    const committed = staged.trim().length > 0;
    if (committed) await git(folder, ['--literal-pathspecs', 'commit', '--only', '-m', message, '--', ...selected]);
    if (!(await git(folder, ['remote']).catch(() => '')).split('\n').includes('origin')) return { committed, pushed: false };
    await git(folder, ['push', '--set-upstream', 'origin', 'HEAD']);
    return { committed, pushed: true };
  } catch (error) {
    throw new OkbError('E_IO', `Git refused: ${said(error)}`, { key: 'shareGitFailed', params: { message: said(error) } });
  }
}

/** Take what the colleagues sent. */
export async function pullShared(folder: string): Promise<{ changed: boolean }> {
  if (!isGitFolder(folder)) throw new OkbError('E_INVALID', 'the shared folder is not a Git checkout', { key: 'shareNoGit' });
  try {
    const head = () => git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => s.trim(), () => '');
    const before = await head();
    await integrate(folder);
    return { changed: before !== (await head()) };
  } catch (error) {
    throw new OkbError('E_IO', `Git refused: ${said(error)}`, { key: 'shareGitFailed', params: { message: said(error) } });
  }
}
