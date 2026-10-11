import type { OkbConfig } from '../config/schema.js';
import { resolve } from 'node:path';
import { OkbError } from '../util/errors.js';
import { withStateLock } from '../util/state-lock.js';
import { assertMayShare, sendDrawer, sharedFolder } from './drawers.js';
import { assertNoPendingCommits, isGitFolder, pullShared, pushDrawer } from './git.js';

/**
 * Sending and receiving (F2.1-03). Sending fills the person's drawer in the
 * local copy of the shared folder; nothing leaves the computer unless they ask
 * for the push too. OKB commits the drawer and only the drawer, in the shared
 * copy and only there: a knowledge base is never committed nor pushed (D33).
 */
export async function sendShared(config: OkbConfig, env: NodeJS.ProcessEnv, options: { readonly push?: boolean; readonly previewHash?: string } = {}): Promise<{ written: number; removed: number; kept: number; held: number; unknown: string[]; committed: boolean; pushed: boolean }> {
  assertMayShare(config);
  const { folder, drawer } = await sharedFolder(config);
  // One shared working tree has one Git index; preparation, push and receive must not interleave.
  return withStateLock(resolve(folder, '.okb-share-git'), async () => {
  if (options.push && !isGitFolder(folder)) throw new OkbError('E_INVALID', 'the shared folder is not a Git checkout', { key: 'shareNoGit' });
  // Bring their commits in before preparing ours, so Git cannot overwrite freshly prepared notes.
  if (options.push) { await pullShared(folder); await assertNoPendingCommits(folder); }
  const { tracked, ...out } = await sendDrawer(config, env, new Date(), options.previewHash);
  if (!options.push) return { ...out, committed: false, pushed: false };
  const notes = out.written + out.kept;
  return { ...out, ...(await pushDrawer(folder, drawer, `okb: ${drawer} shares ${notes} note${notes === 1 ? '' : 's'}`, tracked)) };
  });
}

export async function receiveShared(config: OkbConfig, _env: NodeJS.ProcessEnv): Promise<{ changed: boolean }> {
  assertMayShare(config);
  const { folder } = await sharedFolder(config);
  return withStateLock(resolve(folder, '.okb-share-git'), () => pullShared(folder));
}
