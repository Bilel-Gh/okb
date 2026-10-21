import type { OkbConfig } from '../config/schema.js';
import { listRepos } from '../repo/registry.js';
import { loadMap, repoPaths } from '../repo/state.js';
import type { RepoMap } from '../repo/types.js';
import { listWorkspaces } from '../work/workspaces.js';
import { buildModel, type SystemModel } from './model.js';
import { applyOverrides, readOverrides } from './overrides.js';

const isFr = (lang: string | undefined) => (lang ?? 'fr').toLowerCase().startsWith('fr');

/**
 * The system model of one KB: the stored scans of its repositories (no Git
 * call, no AI), linked by src/arch/model.ts. Its name is the workspace's when
 * the KB documents one, else the KB's. Null when no repository is scanned yet.
 */
export async function systemOf(config: OkbConfig): Promise<{ model: SystemModel; name: string; lang: 'fr' | 'en'; maps: RepoMap[] } | null> {
  const lang = isFr(config.writing.language ?? config.profile.answer.language) ? 'fr' : 'en';
  const repos = (await listRepos()).filter((r) => r.kb === config.profile.id);
  const maps: RepoMap[] = [];
  for (const r of repos) {
    const map = await loadMap(repoPaths(config, r.id));
    if (map) maps.push(map);
  }
  if (!maps.length) return null;
  const workspace = (await listWorkspaces()).find((w) => w.kb === config.profile.id);
  const name = workspace?.name || config.profile.displayName || config.profile.id;
  return { model: correctedModel(config, maps, lang), name, lang, maps };
}

/**
 * The model of these maps with the person's corrections (F2.4-17, D72): what an
 * address is first, then the corrections of the links. Every view that shows
 * relations (map, landscape note, Repos page, brief) goes through here.
 */
export function correctedModel(config: OkbConfig, maps: readonly RepoMap[], lang: 'fr' | 'en' = isFr(config.writing.language ?? config.profile.answer.language) ? 'fr' : 'en'): SystemModel {
  const { overrides, conflicts, rules } = readOverrides(config);
  const model = buildModel(maps, { lang, urlRules: new Map(rules.map((r) => [r.host, r.role])) });
  return applyOverrides(model, overrides, lang, conflicts);
}
