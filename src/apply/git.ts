import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';

const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { env: GIT_ENV, timeout: 30_000, maxBuffer: 4_000_000 });
  return stdout;
}

/** Opt-in read-only gate before an apply. */
export async function requireCleanGitTree(config: OkbConfig): Promise<void> {
  if (!config.git.requireCleanTree) return;
  try {
    const stdout = await git(config.kb.root, ['status', '--porcelain', '--untracked-files=normal']);
    if (stdout.trim()) throw new OkbError('E_CONFLICT', 'git.requireCleanTree is enabled and the KB working tree has changes');
  } catch (cause) {
    if (cause instanceof OkbError) throw cause;
    throw new OkbError('E_CONFIG', 'cannot verify required clean Git tree (missing Git or not a repository)', { cause });
  }
}

export type GitCommitResult =
  | { readonly committed: true; readonly sha: string; readonly paths: number }
  | { readonly committed: false; readonly reason: string };

/**
 * `git.autoCommit`: after an apply or a rollback, commit exactly the files the
 * receipt touched, so the KB history mirrors OKB's receipts. Other changes in
 * the working tree, staged or not, are left alone. Never pushes, never creates
 * a remote. A failure here never undoes the apply: the files are written and the
 * receipt stays the source of truth; the caller reports the reason.
 */
export async function commitKbChanges(config: OkbConfig, paths: readonly string[], message: string): Promise<GitCommitResult> {
  if (!config.git.enabled || !config.git.autoCommit) return { committed: false, reason: 'git.autoCommit is off' };
  if (!paths.length) return { committed: false, reason: 'nothing was written' };
  const root = config.kb.root;
  try {
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return { committed: false, reason: 'the KB is not in a Git repository' };
  } catch {
    return { committed: false, reason: 'the KB is not in a Git repository (or Git is missing)' };
  }
  try {
    // A path Git never saw and that no longer exists (a rollback of an apply made
    // before autoCommit was on) is not a pathspec Git accepts: leave it out.
    const tracked = new Set((await git(root, ['ls-files', '-z', '--', ...paths])).split('\0').filter(Boolean));
    const present = await Promise.all(paths.map((p) => access(resolve(root, p)).then(() => true, () => false)));
    const targets = paths.filter((p, i) => present[i] || tracked.has(p));
    if (!targets.length) return { committed: false, reason: 'no change to commit' };
    await git(root, ['add', '-A', '--', ...targets]);
    if (!(await git(root, ['diff', '--cached', '--name-only', '--', ...targets])).trim()) return { committed: false, reason: 'no change to commit' };
    await git(root, ['commit', '--quiet', '--only', '-m', message, '--', ...targets]);
    const sha = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
    return { committed: true, sha, paths: targets.length };
  } catch (cause) {
    const detail = String((cause as { stderr?: unknown }).stderr ?? (cause as Error).message ?? cause).trim().split('\n')[0] ?? '';
    return { committed: false, reason: `git commit failed: ${detail}` };
  }
}
