import { resolve } from 'node:path';
import { loadConfig, type EffectiveConfig } from '../../config/load.js';
import type { OkbConfig } from '../../config/schema.js';
import { parseConceptAssist } from '../../setup/setup.js';
import { ensureState, statePaths } from '../../state/paths.js';
import { isInside, readRootConfig } from '../../kb/registry.js';
import { listRepos } from '../../repo/registry.js';
import { flagBool, flagString, type ParsedArgs } from '../args.js';
import type { Output, OutputMode } from '../output.js';
import { interactive } from '../ui/prompt.js';

export type Ctx = {
  readonly args: ParsedArgs;
  readonly out: Output;
  readonly mode: OutputMode;
};

export type Handler = (ctx: Ctx) => Promise<number> | number;

export async function effective(args: ParsedArgs): Promise<EffectiveConfig> {
  // Inside a repository OKB documents, or a workspace, its KB is the one meant (unless one is named).
  const profileId = flagString(args, 'profile') ?? flagString(args, 'kb') ?? (process.env.OKB_PROFILE ? undefined : await kbOfCurrentFolder());
  const result = await loadConfig({
    ...(profileId ? { profileId } : {}),
    ...(flagString(args, 'org-config') ? { orgConfigPath: flagString(args, 'org-config')! } : {}),
    flags: buildFlagOverrides(args),
  });
  await ensureState(statePaths(result.config));
  return result;
}

/** The KB of the registered repository, else the workspace, containing the current folder (by path only: no Git call). */
export async function kbOfCurrentFolder(cwd = process.cwd()): Promise<string | undefined> {
  try {
    const repos = await listRepos();
    const repo = repos.filter((r) => isInside(cwd, r.path)).sort((a, b) => b.path.length - a.path.length)[0];
    const { workspaceForDir } = await import('../../work/workspaces.js');
    const kb = repo?.kb ?? (await workspaceForDir(cwd))?.kb;
    // A KB removed since: the active one applies.
    return kb && (await readRootConfig()).profiles?.map(String).includes(kb) ? kb : undefined;
  } catch {
    return undefined;
  }
}

export async function config(args: ParsedArgs): Promise<OkbConfig> {
  return (await effective(args)).config;
}

function buildFlagOverrides(args: ParsedArgs): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const kbRoot = flagString(args, 'kb-root');
  if (kbRoot) overrides.kb = { root: kbRoot };
  const assist = flagString(args, 'concept-assist');
  if (assist) overrides.conceptAssist = { level: parseConceptAssist(assist) };
  return overrides;
}

/** A person at a terminal who did not ask for machine output or "accept everything". */
export function canAsk(ctx: Ctx): boolean {
  return ctx.mode === 'text' && !flagBool(ctx.args, 'yes') && interactive();
}

/** `--profile x` (or `--kb x`) as it must be repeated in suggested commands. */
export function kbFlag(args: ParsedArgs, cfg?: OkbConfig): string {
  const explicit = flagString(args, 'profile') ?? flagString(args, 'kb');
  return explicit ? ` --kb ${explicit}` : cfg && process.env.OKB_PROFILE ? ` --kb ${cfg.profile.id}` : '';
}

export function abs(path: string): string {
  return resolve(path);
}
