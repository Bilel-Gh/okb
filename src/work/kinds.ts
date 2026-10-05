import { resolve } from 'node:path';
import YAML from 'yaml';
import { loadConfig, okbHome } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { listRepos } from '../repo/registry.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { listWorkspaces } from './workspaces.js';

/**
 * Three kinds of KB, chosen when the KB is made:
 * - `topic`: a subject, no code (notes by category);
 * - `repo`: one code repository — the whole KB is that repository, its notes
 *   at the root (`comprendre.md`, `tickets/`, `concepts/`…);
 * - `workspace`: the repositories of a team — one space per repository under
 *   `repos/<id>/` and a shared part (business concepts, features across
 *   repositories, decisions, how they connect).
 */
export type KbKind = 'topic' | 'repo' | 'workspace';
export const KB_KINDS: readonly KbKind[] = ['topic', 'repo', 'workspace'];
export const KIND_ICON: Record<KbKind, string> = { topic: '📚', repo: '📦', workspace: '🗂️' };

export { isFlat } from '../repo/pack.js';

/** The kind of a KB: declared, else inferred (one that holds repositories is a workspace). */
export async function kindOf(profileId: string, config?: OkbConfig | null, env: NodeJS.ProcessEnv = process.env): Promise<KbKind> {
  const declared = config?.kb.kind ?? (await loadConfig({ profileId, env }).then((r) => r.config.kb.kind, () => undefined));
  if (declared) return declared;
  if ((await listWorkspaces(env)).some((w) => w.kb === profileId)) return 'workspace';
  if ((await listRepos(env)).some((r) => r.kb === profileId)) return 'workspace';
  return 'topic';
}

/** Record a KB's kind in its profile (comments in profile.yaml are kept). */
export async function setKbKind(profileId: string, kind: KbKind, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = resolve(okbHome(env), 'profiles', profileId, 'profile.yaml');
  const before = await readTextIfExists(path);
  if (before === null) throw new OkbError('E_NOT_FOUND', `KB "${profileId}" is not installed`, { key: 'kbUnknown', params: { id: profileId } });
  const doc = YAML.parseDocument(before);
  doc.setIn(['kb', 'kind'], kind);
  await writeTextAtomic(path, String(doc));
}
