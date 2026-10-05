import { execFile } from 'node:child_process';
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
