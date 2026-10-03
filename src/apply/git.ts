import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';

/** Opt-in read-only gate. No staging, commit, remote creation or push. */
export async function requireCleanGitTree(config: OkbConfig): Promise<void> {
  if (config.git.autoCommit) throw new OkbError('E_CONFIG', 'automatic Git commits are not implemented; set git.autoCommit: false');
  if (!config.git.requireCleanTree) return;
  try {
    const {stdout} = await promisify(execFile)('git', ['-c','core.fsmonitor=false','-C',config.kb.root,'status','--porcelain','--untracked-files=normal'], {
      env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}, timeout:15000, maxBuffer:1_000_000,
    });
    if (stdout.trim()) throw new OkbError('E_CONFLICT', 'git.requireCleanTree is enabled and the KB working tree has changes');
  } catch (cause) {
    if (cause instanceof OkbError) throw cause;
    throw new OkbError('E_CONFIG', 'cannot verify required clean Git tree (missing Git or not a repository)', {cause});
  }
}
