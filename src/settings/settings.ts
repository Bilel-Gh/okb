import { resolve } from 'node:path';
import YAML from 'yaml';
import { loadConfig, okbHome } from '../config/load.js';
import { readRootConfig, setUiLanguage } from '../kb/registry.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';

/**
 * The settings a person changes, described once for the terminal menu, the
 * web page and `okb settings set`: what it is, its choices, where it lives.
 * Writes go through YAML documents so the comments in profile.yaml survive.
 */
export type SettingType = 'choice' | 'bool' | 'text' | 'number' | 'list';
export type SettingGroup = 'language' | 'writing' | 'help' | 'memory' | 'history' | 'assistant' | 'advanced';

export type SettingDef = {
  readonly key: string;
  readonly group: SettingGroup;
  readonly type: SettingType;
  /** Where it is stored: the profile (one KB) or the OKB home (every KB). */
  readonly scope: 'profile' | 'global';
  readonly path: readonly string[];
  readonly options?: readonly string[];
  readonly recommended?: string | boolean | number;
  readonly fallback: unknown;
};

export const SETTINGS: readonly SettingDef[] = [
  { key: 'ui.language', group: 'language', type: 'choice', scope: 'global', path: ['ui', 'language'], options: ['auto', 'fr', 'en'], recommended: 'auto', fallback: 'auto' },
  { key: 'writing.language', group: 'language', type: 'choice', scope: 'profile', path: ['profile', 'answer', 'language'], options: ['fr', 'en', 'es', 'de', 'it', 'pt'], fallback: 'en' },
  { key: 'profile.displayName', group: 'writing', type: 'text', scope: 'profile', path: ['profile', 'displayName'], fallback: '' },
  { key: 'writing.preset', group: 'writing', type: 'choice', scope: 'profile', path: ['writing', 'preset'], options: ['standard', 'pedagogique', 'expert'], recommended: 'standard', fallback: 'standard' },
  { key: 'reader.level', group: 'writing', type: 'choice', scope: 'profile', path: ['reader', 'level'], options: ['beginner', 'intermediate', 'expert'], recommended: 'intermediate', fallback: 'intermediate' },
  { key: 'kb.requireTemplate', group: 'writing', type: 'bool', scope: 'profile', path: ['kb', 'requireTemplate'], recommended: true, fallback: false },
  { key: 'conceptAssist.level', group: 'help', type: 'choice', scope: 'profile', path: ['conceptAssist', 'level'], options: ['off', 'targeted', 'pedagogical'], recommended: 'targeted', fallback: 'targeted' },
  { key: 'focus.file', group: 'memory', type: 'text', scope: 'profile', path: ['focus', 'file'], fallback: '' },
  { key: 'focus.journal', group: 'memory', type: 'text', scope: 'profile', path: ['focus', 'journal'], fallback: '' },
  { key: 'focus.sessionStart', group: 'memory', type: 'bool', scope: 'profile', path: ['focus', 'sessionStart'], recommended: true, fallback: true },
  { key: 'focus.staleDays', group: 'memory', type: 'number', scope: 'profile', path: ['focus', 'staleDays'], recommended: 14, fallback: 14 },
  { key: 'kb.confidential', group: 'history', type: 'bool', scope: 'profile', path: ['kb', 'confidential'], fallback: false },
  { key: 'git.autoCommit', group: 'history', type: 'bool', scope: 'profile', path: ['git', 'autoCommit'], recommended: true, fallback: false },
  { key: 'routing.suggest', group: 'assistant', type: 'bool', scope: 'profile', path: ['routing', 'suggest'], recommended: true, fallback: true },
  { key: 'routing.otherKnowledgeTools', group: 'assistant', type: 'list', scope: 'profile', path: ['routing', 'otherKnowledgeTools'], fallback: [] },
  { key: 'profile.humanActor', group: 'advanced', type: 'text', scope: 'profile', path: ['profile', 'humanActor'], fallback: 'human:anonymous' },
  { key: 'context.pageSize', group: 'advanced', type: 'number', scope: 'profile', path: ['context', 'pageSize'], fallback: 25 },
];

export function settingDef(key: string): SettingDef {
  const def = SETTINGS.find((s) => s.key === key);
  if (!def) throw new OkbError('E_INVALID', `unknown setting "${key}"`, { key: 'settingUnknown', params: { name: key }, hint: 'okb settings show' });
  return def;
}

function getIn(data: unknown, path: readonly string[]): unknown {
  let cur = data;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export type SettingValue = { readonly def: SettingDef; readonly value: unknown; readonly isDefault: boolean };

export async function readSettings(profileId: string, env: NodeJS.ProcessEnv = process.env): Promise<SettingValue[]> {
  const raw = await readTextIfExists(resolve(okbHome(env), 'profiles', profileId, 'profile.yaml'));
  const profile = raw ? YAML.parse(raw) : {};
  const root = await readRootConfig(env);
  return SETTINGS.map((def) => {
    const stored = getIn(def.scope === 'global' ? root : profile, def.path);
    return { def, value: stored ?? def.fallback, isDefault: stored === undefined };
  });
}

export function parseSettingValue(def: SettingDef, raw: unknown): unknown {
  if (def.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const v = String(raw).toLowerCase();
    if (['true', 'yes', 'oui', 'on', '1'].includes(v)) return true;
    if (['false', 'no', 'non', 'off', '0'].includes(v)) return false;
  } else if (def.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  } else if (def.type === 'list') {
    if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  } else if (def.type === 'choice') {
    const v = String(raw).trim();
    if (def.options?.includes(v) || (def.key === 'writing.language' && /^[a-z]{2}(-[A-Z]{2})?$/.test(v))) return v;
  } else {
    return String(raw).trim();
  }
  throw new OkbError('E_INVALID', `invalid value for ${def.key}: ${String(raw)}`, {
    key: 'settingBadValue', params: { name: def.key, value: String(raw), options: (def.options ?? []).join(', ') },
  });
}

/** Change one setting, keeping the file's comments, then check the profile still loads. */
export async function writeSetting(profileId: string, key: string, raw: unknown, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const def = settingDef(key);
  const value = parseSettingValue(def, raw);
  if (def.scope === 'global') {
    await setUiLanguage(value as 'auto' | 'fr' | 'en', env);
    return value;
  }
  const path = resolve(okbHome(env), 'profiles', profileId, 'profile.yaml');
  const before = await readTextIfExists(path);
  if (before === null) throw new OkbError('E_NOT_FOUND', `KB "${profileId}" is not installed`, { key: 'kbUnknown', params: { id: profileId } });
  const doc = YAML.parseDocument(before);
  if (def.type === 'text' && value === '') doc.deleteIn(def.path as string[]);
  else doc.setIn(def.path as string[], value);
  await writeTextAtomic(path, String(doc));
  try {
    await loadConfig({ env, profileId });
  } catch (cause) {
    await writeTextAtomic(path, before);
    throw new OkbError('E_CONFIG', `the new value of ${key} makes the profile invalid; nothing changed`, { key: 'settingRejected', params: { name: key }, cause });
  }
  return value;
}
