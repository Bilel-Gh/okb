import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { OkbError } from '../util/errors.js';
import { exists, readTextIfExists } from '../util/fsx.js';
import { configSchema, policySchema, type OkbConfig, type OkbPolicy } from './schema.js';
import { assertId } from '../util/paths.js';
import { realpath } from 'node:fs/promises';
import { relative, sep, dirname } from 'node:path';

export type LayerName = 'defaults' | 'org' | 'team' | 'profile' | 'kb-local' | 'env' | 'flags';

export type Layer = {
  readonly name: LayerName;
  readonly origin: string;
  readonly data: Record<string, unknown>;
};

export type EffectiveConfig = {
  readonly config: OkbConfig;
  readonly layers: readonly Layer[];
  /** Keys whose value was narrowed by the org policy, with before/after. */
  readonly clamped: readonly ClampRecord[];
  /** Capabilities switched off because they are not configured. */
  readonly disabled: readonly string[];
  /** Top-level keys okb does not own; kept in the file, reported, not applied. */
  readonly ignoredKeys: readonly string[];
};

/** Keys a layer file may carry that are not part of the configuration itself. */
const LAYER_META_KEYS = new Set(['activeProfile', 'profiles', 'orgConfig', 'teamConfig', '$schema', 'ui']);

export type ClampRecord = {
  readonly path: string;
  readonly requested: unknown;
  readonly effective: unknown;
  readonly reason: string;
};

export function okbHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.OKB_HOME && env.OKB_HOME.trim() !== ''
    ? resolve(env.OKB_HOME)
    : resolve(homedir(), '.okb');
}

export function expandHome(p: string, env: NodeJS.ProcessEnv = process.env): string {
  if (p.startsWith('~/')) return resolve(env.HOME ?? homedir(), p.slice(2));
  return p;
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) out[k] = deepMerge(prev, v);
    else out[k] = v;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readYamlLayer(
  name: LayerName,
  path: string | null,
): Promise<Layer | null> {
  if (!path) return null;
  const raw = await readTextIfExists(path);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (cause) {
    throw new OkbError('E_CONFIG', `cannot parse ${path}: invalid YAML`, {
      cause,
      detail: { layer: name, path },
      hint: 'Run `okb config show` after fixing the file to confirm it loads.',
    });
  }
  if (parsed === null || parsed === undefined) return { name, origin: path, data: {} };
  if (!isPlainObject(parsed)) {
    throw new OkbError('E_CONFIG', `${path} must contain a YAML mapping at the top level`, {
      detail: { layer: name, path },
    });
  }
  return { name, origin: path, data: parsed };
}

/** Env overrides are deliberately few: the ones an operator needs in CI or a container. */
export function envLayer(env: NodeJS.ProcessEnv = process.env): Layer {
  const data: Record<string, unknown> = {};
  const set = (path: string, value: unknown) => {
    const parts = path.split('.');
    let cursor = data;
    for (const part of parts.slice(0, -1)) {
      cursor[part] = isPlainObject(cursor[part]) ? cursor[part] : {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]!] = value;
  };
  if (env.OKB_KB_ROOT) set('kb.root', env.OKB_KB_ROOT);
  // OKB_PROFILE selects a profile; an explicit --profile wins. It is not a data override.
  if (env.OKB_CONCEPT_ASSIST) set('conceptAssist.level', env.OKB_CONCEPT_ASSIST);
  if (env.OKB_APPLY_MODE) set('changes.apply', env.OKB_APPLY_MODE);
  if (env.OKB_STATE_HOME) set('stateHome', env.OKB_STATE_HOME);
  return { name: 'env', origin: 'process environment', data };
}

export type LoadOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly profileId?: string;
  readonly flags?: Record<string, unknown>;
  /** Explicit org overlay path; otherwise discovered from env or the KB. */
  readonly orgConfigPath?: string | null;
};

export async function loadConfig(options: LoadOptions = {}): Promise<EffectiveConfig> {
  const env = options.env ?? process.env;
  const home = okbHome(env);
  const rootConfigPath = resolve(home, 'config.yaml');

  const rootLayer = await readYamlLayer('defaults', rootConfigPath);
  const activeProfile =
    options.profileId ??
    (env.OKB_PROFILE && env.OKB_PROFILE.trim()) ??
    (rootLayer?.data.activeProfile as string | undefined) ??
    'default';

  const profilePath = resolve(home, 'profiles', activeProfile, 'profile.yaml');
  assertId(activeProfile, 'profile id');
  const profileLayer = await readYamlLayer('profile', profilePath);
  if (!profileLayer) {
    throw new OkbError('E_CONFIG', `profile "${activeProfile}" is not installed`, {
      key: activeProfile === 'default' && !rootLayer ? 'noKbYet' : 'kbUnknown', params: { id: activeProfile },
      detail: { expected: profilePath, home },
      hint: 'Run `okb init` (guided) or `okb setup --profile <id> --kb-root <path>` to create it.',
    });
  }

  const orgPath =
    options.orgConfigPath ??
    (env.OKB_ORG_CONFIG ? resolve(env.OKB_ORG_CONFIG) : null) ??
    (await discoverOrgConfig({ ...rootLayer?.data, ...profileLayer.data }));
  const orgLayer = await readYamlLayer('org', orgPath);
  if (orgPath && !orgLayer) throw new OkbError('E_CONFIG', `declared organisation configuration is missing: ${orgPath}`);

  const teamPath = env.OKB_TEAM_CONFIG ?? profileLayer.data.teamConfig ?? rootLayer?.data.teamConfig;
  if (teamPath !== undefined && typeof teamPath !== 'string') throw new OkbError('E_CONFIG', 'teamConfig must be a path');
  const teamLayer = await readYamlLayer('team', teamPath ? resolve(expandHome(teamPath as string, env)) : null);
  if (teamPath && !teamLayer) throw new OkbError('E_CONFIG', 'declared team configuration is missing');

  const kbRootGuess = pickKbRoot([rootLayer, orgLayer, teamLayer, profileLayer, { name: 'flags', origin: 'flags', data: options.flags ?? {} }], env);
  const kbLocalLayer = kbRootGuess
    ? await readYamlLayer('kb-local', resolve(kbRootGuess, '.okb', 'kb.yaml'))
    : null;

  if (kbLocalLayer && (kbLocalLayer.data.stateHome !== undefined || kbLocalLayer.data.profile !== undefined || (isPlainObject(kbLocalLayer.data.kb) && kbLocalLayer.data.kb.root !== undefined))) throw new OkbError('E_CONFIG', 'KB-local configuration cannot redirect identity, kb.root or stateHome');

  const flagsLayer: Layer = {
    name: 'flags',
    origin: 'command line',
    data: options.flags ?? {},
  };

  const layers = [
    { name: 'defaults' as const, origin: rootConfigPath, data: stripRootKeys(rootLayer?.data ?? {}) },
    orgLayer,
    teamLayer,
    profileLayer,
    kbLocalLayer,
    envLayer(env),
    flagsLayer,
  ].filter((l): l is Layer => l !== null);

  let merged: Record<string, unknown> = {};
  for (const layer of layers) merged = deepMerge(merged, layer.data);

  // Policy is not preference data: preserve every ceiling, including a profile's
  // stricter choices. Personal / KB-local / flags can never undo an org restriction.
  merged.policy = mergePolicies(layers);
  if (isPlainObject(merged.kb)) merged.kb.exclude = [...new Set([...configSchema.shape.kb.parse({ root: '.' }).exclude, ...layers.flatMap(l => isPlainObject(l.data.kb) && Array.isArray(l.data.kb.exclude) ? l.data.kb.exclude as string[] : [])])];

  if (!merged.stateHome) merged.stateHome = resolve(home, 'profiles', activeProfile, 'state');
  if (!isPlainObject(merged.profile)) merged.profile = { id: activeProfile };
  else if (!(merged.profile as Record<string, unknown>).id)
    (merged.profile as Record<string, unknown>).id = activeProfile;

  const known = new Set(Object.keys(configSchema.shape));
  const ignoredKeys: string[] = [];
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (known.has(key)) applied[key] = value;
    else if (!LAYER_META_KEYS.has(key)) ignoredKeys.push(key);
  }

  const parsed = configSchema.safeParse(applied);
  if (!parsed.success) {
    throw new OkbError('E_CONFIG', formatZodError(parsed.error, layers), {
      detail: { issues: parsed.error.issues },
      hint: 'Run `okb config show` to see which layer supplied each value.',
    });
  }

  const normalized = normalizePaths(parsed.data, env);
  if (normalized.profile.id !== activeProfile) throw new OkbError('E_CONFIG', 'profile.id must match the selected profile');
  await assertStateOutsideKb(normalized);
  const { config, clamped } = clampToPolicy(normalized);
  return {
    config,
    layers,
    clamped,
    disabled: disabledCapabilities(config),
    ignoredKeys: ignoredKeys.sort(),
  };
}

function stripRootKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!LAYER_META_KEYS.has(k)) out[k] = v;
  return out;
}

function pickKbRoot(layers: readonly (Layer | null)[], env: NodeJS.ProcessEnv): string | null {
  if (env.OKB_KB_ROOT) return resolve(expandHome(env.OKB_KB_ROOT, env));
  for (const layer of [...layers].reverse()) {
    const kb = layer?.data.kb;
    if (isPlainObject(kb) && typeof kb.root === 'string' && kb.root.trim() !== '') {
      return resolve(expandHome(kb.root, env));
    }
  }
  return null;
}

async function discoverOrgConfig(profileData: Record<string, unknown>): Promise<string | null> {
  const declared = profileData.orgConfig;
  if (typeof declared === 'string' && declared.trim() !== '') {
    const p = resolve(expandHome(declared));
    return p;
  }
  return null;
}

function normalizePaths(config: OkbConfig, env: NodeJS.ProcessEnv): OkbConfig {
  const root = resolve(expandHome(config.kb.root, env));
  const stateHome = config.stateHome
    ? resolve(expandHome(config.stateHome, env))
    : resolve(okbHome(env), 'profiles', config.profile.id, 'state');
  if (!isAbsolute(root)) {
    throw new OkbError('E_CONFIG', 'kb.root must resolve to an absolute path', {
      detail: { value: config.kb.root },
    });
  }
  return { ...config, kb: { ...config.kb, root }, stateHome };
}

/**
 * Apply the organisation ceiling. Every rule here can only *remove* permission:
 * numbers are min-ed, booleans are AND-ed, allow-lists are intersected and
 * deny-lists are unioned.
 */
export function clampToPolicy(config: OkbConfig): {
  config: OkbConfig;
  clamped: ClampRecord[];
} {
  const policy: OkbPolicy = config.policy;
  const clamped: ClampRecord[] = [];
  const next: OkbConfig = structuredClone(config);

  const note = (path: string, requested: unknown, effective: unknown, reason: string) => {
    if (JSON.stringify(requested) !== JSON.stringify(effective)) {
      clamped.push({ path, requested, effective, reason });
    }
  };

  if (!policy.allowDirectApply && config.changes.apply === 'allow-direct') {
    next.changes.apply = 'require-approval';
    note('changes.apply', 'allow-direct', 'require-approval', 'policy.allowDirectApply = false');
  }

  if (policy.allowedSourceKinds) {
    const allowed = new Set(policy.allowedSourceKinds);
    next.sources.enabled = config.sources.enabled.filter((k) => allowed.has(k));
    note(
      'sources.enabled',
      config.sources.enabled,
      next.sources.enabled,
      'policy.allowedSourceKinds',
    );
  }

  if (config.sources.limits.maxBytes > policy.maxSourceBytes) {
    next.sources.limits.maxBytes = policy.maxSourceBytes;
    note(
      'sources.limits.maxBytes',
      config.sources.limits.maxBytes,
      policy.maxSourceBytes,
      'policy.maxSourceBytes',
    );
  }

  if (
    config.conceptAssist.limits.maxSuggestionsPerSource > policy.maxConceptSuggestionsPerSource
  ) {
    next.conceptAssist.limits.maxSuggestionsPerSource = policy.maxConceptSuggestionsPerSource;
    note(
      'conceptAssist.limits.maxSuggestionsPerSource',
      config.conceptAssist.limits.maxSuggestionsPerSource,
      policy.maxConceptSuggestionsPerSource,
      'policy.maxConceptSuggestionsPerSource',
    );
  }

  if (!policy.allowWebConnector && config.connectors.web.enabled) {
    next.connectors.web.enabled = false;
    note('connectors.web.enabled', true, false, 'policy.allowWebConnector = false');
  }

  if (policy.allowedConnectors) {
    const allowed = new Set(policy.allowedConnectors);
    next.connectors.mcp = config.connectors.mcp.filter((c) => allowed.has(c));
    note('connectors.mcp', config.connectors.mcp, next.connectors.mcp, 'policy.allowedConnectors');
  }

  if (policy.allowedRemotes) {
    const allowed = new Set(policy.allowedRemotes);
    next.git.allowedRemotes = config.git.allowedRemotes.filter((r) => allowed.has(r));
    note(
      'git.allowedRemotes',
      config.git.allowedRemotes,
      next.git.allowedRemotes,
      'policy.allowedRemotes',
    );
  }

  return { config: next, clamped };
}

function disabledCapabilities(config: OkbConfig): string[] {
  const out: string[] = [];
  if (config.conceptAssist.level === 'off') out.push('concept-assist');
  if (!config.connectors.web.enabled) out.push('web-connector');
  if (config.connectors.mcp.length === 0) out.push('mcp-connectors');
  if (config.git.allowedRemotes.length === 0) out.push('git-push');
  if (config.sources.retention.mode === 'none') out.push('source-retention');
  return out;
}

function formatZodError(error: z.ZodError, layers: readonly Layer[]): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    const provider = layers
      .slice()
      .reverse()
      .find((l) => hasPath(l.data, issue.path.map(String)));
    const where = provider ? ` [set by ${provider.name}: ${provider.origin}]` : '';
    return `  - ${path}: ${issue.message}${where}`;
  });
  return `configuration is invalid:\n${lines.join('\n')}`;
}

function hasPath(data: unknown, path: readonly string[]): boolean {
  let cursor: unknown = data;
  for (const key of path) {
    if (!isPlainObject(cursor) || !(key in cursor)) return false;
    cursor = cursor[key];
  }
  return true;
}

function mergePolicies(layers: readonly Layer[]): OkbPolicy {
  const out = policySchema.parse({});
  const seen = new Set<string>();
  const nullableLists = new Set(['allowedRemotes', 'allowedSourceKinds', 'allowedConnectors']);
  for (const layer of layers) {
    if (!isPlainObject(layer.data.policy)) continue;
    const raw = layer.data.policy;
    const checked = policySchema.partial().safeParse(raw);
    if (!checked.success) throw new OkbError('E_CONFIG', `invalid policy in ${layer.origin}`, { detail: { issues: checked.error.issues } });
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'writeAllowGroups') throw new OkbError('E_CONFIG', 'writeAllowGroups is derived; configure writeAllow instead');
      const dst = out as unknown as Record<string, unknown>;
      if (key === 'writeAllow') {
        out.writeAllowGroups.push(value as string[]);
        out.writeAllow = value as string[];
      } else if (key === 'writeDeny') {
        out.writeDeny = [...new Set([...out.writeDeny, ...(value as string[])])];
      } else if (nullableLists.has(key)) {
        if (value !== null) dst[key] = dst[key] === null ? value : (dst[key] as string[]).filter(v => (value as string[]).includes(v));
      } else if (typeof value === 'number') {
        dst[key] = Math.min(dst[key] as number, value);
      } else if (typeof value === 'boolean') {
        dst[key] = seen.has(key) ? Boolean(dst[key]) && value : value;
      }
      seen.add(key);
    }
  }
  return out;
}

async function physicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await physicalPath(parent), path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
  }
}

export async function assertStateOutsideKb(config: OkbConfig): Promise<void> {
  const kb = await physicalPath(config.kb.root);
  const state = await physicalPath(config.stateHome);
  for (const [parent, child] of [[kb, state], [state, kb]]) {
    const rel = relative(parent!, child!);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
      throw new OkbError('E_CONFIG', 'stateHome and kb.root must be separate, non-nested directories (symlinks included)');
    }
  }
}
