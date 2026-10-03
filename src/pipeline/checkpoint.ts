import { assertId } from '../util/paths.js';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';

export type Checkpoint = {
  readonly runId: string;
  readonly sourceUri: string;
  readonly sourceSha256: string;
  readonly adapter: string;
  readonly adapterVersion: string;
  readonly totalBlocks: number;
  /** Index of the first block not yet handed to the caller. */
  readonly cursor: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Caller-owned notes, carried across sessions without interpretation. */
  readonly carry: Record<string, unknown>;
};

function checkpointFile(config: OkbConfig, runId: string): string {
  return resolve(statePaths(config).runs, assertId(runId, 'run id'), 'checkpoint.json');
}

export async function saveCheckpoint(config: OkbConfig, checkpoint: Checkpoint): Promise<void> {
  const file = checkpointFile(config, checkpoint.runId);
  await ensureDir(resolve(file, '..'));
  await writeJsonAtomic(file, { ...checkpoint, updatedAt: new Date().toISOString() });
}

export async function loadCheckpoint(config: OkbConfig, runId: string): Promise<Checkpoint | null> {
  return readJsonIfExists<Checkpoint>(checkpointFile(config, runId));
}

/**
 * A resumed run is only valid against the same bytes and the same extractor.
 * A changed source or a bumped adapter means the block indices no longer line
 * up, so the caller is told to restart rather than silently skipping content.
 */
export function checkpointIsUsable(
  checkpoint: Checkpoint,
  current: { sha256: string; adapter: string; adapterVersion: string },
): { usable: boolean; reason?: string } {
  if (checkpoint.sourceSha256 !== current.sha256) {
    return { usable: false, reason: 'the source bytes changed since the run started' };
  }
  if (checkpoint.adapter !== current.adapter) {
    return { usable: false, reason: `a different adapter is now selected (${current.adapter})` };
  }
  if (checkpoint.adapterVersion !== current.adapterVersion) {
    return { usable: false, reason: `the ${current.adapter} adapter changed version` };
  }
  return { usable: true };
}

export async function saveNormalized(config: OkbConfig, runId: string, doc: import('../sources/types.js').NormalizedDoc): Promise<void> {
  const file = resolve(statePaths(config).runs, assertId(runId, 'run id'), 'source.json');
  await writeJsonAtomic(file, doc);
}
export async function loadNormalized(config: OkbConfig, runId: string): Promise<import('../sources/types.js').NormalizedDoc | null> {
  return readJsonIfExists(resolve(statePaths(config).runs, assertId(runId, 'run id'), 'source.json'));
}
