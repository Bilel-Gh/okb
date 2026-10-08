import { resolve } from 'node:path';
import YAML from 'yaml';
import { configSchema } from '../config/schema.js';
import { okbHome } from '../config/load.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { assertId } from '../util/paths.js';
import type { BrainPreset, NamesLang } from './layout.js';

/**
 * Turn a KB into a brain in its profile (or take the setting away). Only the
 * `kb.brain` key changes; every other line of the profile is kept.
 */
export async function setBrainConfig(profileId: string, brain: { preset: BrainPreset; names?: NamesLang } | null, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  assertId(profileId, 'profile id');
  const path = resolve(okbHome(env), 'profiles', profileId, 'profile.yaml');
  const raw = await readTextIfExists(path);
  if (raw === null) throw new OkbError('E_NOT_FOUND', `no profile "${profileId}"`, { key: 'profileUnknown', params: { id: profileId } });
  const doc = YAML.parseDocument(raw);
  if (brain) doc.setIn(['kb', 'brain'], doc.createNode({ preset: brain.preset, ...(brain.names ? { names: brain.names } : {}) }));
  else doc.deleteIn(['kb', 'brain']);
  const data = doc.toJS() as Record<string, unknown>;
  const known = Object.fromEntries(Object.entries(data).filter(([k]) => k in configSchema.shape));
  const valid = configSchema.safeParse(known);
  if (!valid.success) throw new OkbError('E_CONFIG', 'invalid brain configuration', { detail: { issues: valid.error.issues } });
  await writeTextAtomic(path, doc.toString({ lineWidth: 0 }));
  return path;
}
