import { resolve } from 'node:path';
import { ensureDir } from '../util/fsx.js';
import type { OkbConfig } from '../config/schema.js';

/**
 * Operational state lives outside the knowledge bundle on purpose: a working
 * note produced by an agent must never become a validated piece of knowledge by
 * sitting in the same tree.
 */
export type StatePaths = {
  readonly root: string;
  readonly proposals: string;
  readonly runs: string;
  readonly cache: string;
  readonly logs: string;
  readonly index: string;
  readonly approvals: string;
  readonly receipts: string;
  readonly backups: string;
  readonly sources: string;
  readonly secretFile: string;
};

export function statePaths(config: OkbConfig): StatePaths {
  const root = resolve(config.stateHome);
  return {
    root,
    proposals: resolve(root, 'proposals'),
    runs: resolve(root, 'runs'),
    cache: resolve(root, 'cache'),
    logs: resolve(root, 'logs'),
    index: resolve(root, 'index'),
    approvals: resolve(root, 'approvals'),
    receipts: resolve(root, 'receipts'),
    backups: resolve(root, 'backups'),
    sources: resolve(root, 'sources'),
    secretFile: resolve(root, 'approval.key'),
  };
}

export async function ensureState(paths: StatePaths): Promise<void> {
  for (const dir of [
    paths.root,
    paths.proposals,
    paths.runs,
    paths.cache,
    paths.logs,
    paths.index,
    paths.approvals,
    paths.receipts,
    paths.backups,
    paths.sources,
  ]) {
    await ensureDir(dir);
  }
}
