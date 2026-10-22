import { resolve } from 'node:path';
import YAML from 'yaml';
import { loadConfig, okbHome } from '../config/load.js';
import { readRootConfig, setUiLanguage, writeRootConfig } from '../kb/registry.js';
import { productDetail } from '../style/simple.js';
import { OkbError } from '../util/errors.js';
import { withStateLock } from '../util/state-lock.js';
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
  // The reading profile (OKB 1.0): with reader.level, how visual, how long, how many examples.
  { key: 'writing.diagrams', group: 'writing', type: 'choice', scope: 'profile', path: ['writing', 'diagrams'], options: ['off', 'when-useful', 'prefer'], recommended: 'when-useful', fallback: 'when-useful' },
  { key: 'writing.detail', group: 'writing', type: 'choice', scope: 'profile', path: ['writing', 'detail'], options: ['essential', 'standard', 'thorough'], recommended: 'standard', fallback: 'standard' },
  // The length of the four kinds people write most; any other kind: writing.byType in profile.yaml (okb style types).
  ...(['concept', 'guide', 'decision', 'meeting'] as const).map((type): SettingDef => ({
    key: `writing.byType.${type}.detail`, group: 'writing', type: 'choice', scope: 'profile', path: ['writing', 'byType', type, 'detail'], options: ['essential', 'standard', 'thorough'], recommended: productDetail(type)!, fallback: productDetail(type),
  })),
  { key: 'writing.examples', group: 'writing', type: 'choice', scope: 'profile', path: ['writing', 'examples'], options: ['none', 'generic', 'project'], recommended: 'project', fallback: 'project' },
  { key: 'kb.requireTemplate', group: 'writing', type: 'bool', scope: 'profile', path: ['kb', 'requireTemplate'], recommended: true, fallback: false },
  { key: 'conceptAssist.level', group: 'help', type: 'choice', scope: 'profile', path: ['conceptAssist', 'level'], options: ['off', 'targeted', 'pedagogical'], recommended: 'targeted', fallback: 'targeted' },
  { key: 'focus.file', group: 'memory', type: 'text', scope: 'profile', path: ['focus', 'file'], fallback: '' },
  { key: 'focus.journal', group: 'memory', type: 'text', scope: 'profile', path: ['focus', 'journal'], fallback: '' },
  { key: 'focus.sessionStart', group: 'memory', type: 'bool', scope: 'profile', path: ['focus', 'sessionStart'], recommended: true, fallback: true },
  { key: 'focus.staleDays', group: 'memory', type: 'number', scope: 'profile', path: ['focus', 'staleDays'], recommended: 14, fallback: 14 },
  { key: 'changes.agentWrites', group: 'history', type: 'choice', scope: 'profile', path: ['changes', 'agentWrites'], options: ['proposal', 'review-later'], recommended: 'proposal', fallback: 'proposal' },
  { key: 'review.offer', group: 'history', type: 'bool', scope: 'profile', path: ['review', 'offer'], recommended: true, fallback: true },
  { key: 'review.auto', group: 'history', type: 'choice', scope: 'profile', path: ['review', 'auto'], options: ['never', 'risky'], recommended: 'never', fallback: 'never' },
  { key: 'kb.space', group: 'history', type: 'choice', scope: 'profile', path: ['kb', 'space'], options: ['baggage', 'work'], fallback: 'work' },
  { key: 'kb.confidential', group: 'history', type: 'bool', scope: 'profile', path: ['kb', 'confidential'], fallback: false },
  { key: 'routing.suggest', group: 'assistant', type: 'bool', scope: 'profile', path: ['routing', 'suggest'], recommended: true, fallback: true },
  // Subagents that gather located evidence (long sources, repositories). Per machine: a
  // company gateway may not offer every model. Writing and the evidence reviewer keep the session's model.
  { key: 'agents.model', group: 'assistant', type: 'choice', scope: 'global', path: ['agents', 'model'], options: ['inherit', 'sonnet', 'haiku', 'opus'], recommended: 'inherit', fallback: 'inherit' },
  { key: 'routing.otherKnowledgeTools', group: 'assistant', type: 'list', scope: 'profile', path: ['routing', 'otherKnowledgeTools'], fallback: [] },
  // Suggestions before writing (src/suggest): when cards are shown, and the daily writing budget in tokens.
  { key: 'suggest.mode', group: 'assistant', type: 'choice', scope: 'global', path: ['suggest', 'mode'], options: ['session', 'live', 'never'], recommended: 'session', fallback: 'session' },
  { key: 'dev.attribution', group: 'assistant', type: 'choice', scope: 'global', path: ['dev', 'attribution'], options: ['off', 'on'], recommended: 'off', fallback: 'off' },
  // How OKB itself asks a model (src/ai/provider.ts): Claude Code when installed, else ANTHROPIC_API_KEY.
  { key: 'ai.provider', group: 'assistant', type: 'choice', scope: 'global', path: ['ai', 'provider'], options: ['auto', 'claude-code', 'api', 'off'], recommended: 'auto', fallback: 'auto' },
  // Personal progress (src/progress): experience and badges shown in the web app; local, never shared.
  { key: 'progress.show', group: 'help', type: 'bool', scope: 'global', path: ['progress', 'show'], recommended: true, fallback: true },
  { key: 'budget.daily', group: 'assistant', type: 'number', scope: 'global', path: ['budget', 'daily'], recommended: 50000, fallback: 50000 },
  // Daily backups of every KB and its state (src/brain/backup.ts). An external disk is safest.
  { key: 'backup.enabled', group: 'history', type: 'bool', scope: 'global', path: ['backup', 'enabled'], recommended: true, fallback: true },
  { key: 'backup.dir', group: 'history', type: 'text', scope: 'global', path: ['backup', 'dir'], fallback: '' },
  // Who acts (src/identity/person.ts): the job the person declares; the id is made by OKB.
  { key: 'person.role', group: 'advanced', type: 'choice', scope: 'global', path: ['person', 'role'], options: ['', 'dev', 'devops', 'sales', 'product', 'other'], fallback: '' },
  // Modules for a job (src/modules/catalog.ts): the core is always on.
  { key: 'modules.enabled', group: 'advanced', type: 'list', scope: 'global', path: ['modules', 'enabled'], fallback: ['dev'] },
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
/** What the agent may write is the person's call (D71): an agent cannot change these settings. */
/** Settings only the person changes (D71): an agent is refused, the app asks for their presence. */
export const PERSON_ONLY: ReadonlySet<string> = new Set(['changes.agentWrites', 'review.offer', 'review.auto']);
export function assertPersonSetting(key: string, actor: 'person' | 'agent'): void {
  if (actor !== 'person' && PERSON_ONLY.has(key)) throw new OkbError('E_NOT_APPROVED', `${key} is the person's own setting`, { key: 'settingPersonOnly', params: { key } });
}

export async function writeSetting(profileId: string, key: string, raw: unknown, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const def = settingDef(key);
  const value = parseSettingValue(def, raw);
  if (def.scope === 'global') {
    if (key === 'ui.language') await setUiLanguage(value as 'auto' | 'fr' | 'en', env);
    else {
      await writeRootConfig((root) => {
        const next: Record<string, unknown> = { ...root };
        let cur = next;
        def.path.slice(0, -1).forEach((part) => { cur[part] = { ...((cur[part] as Record<string, unknown>) ?? {}) }; cur = cur[part] as Record<string, unknown>; });
        cur[def.path[def.path.length - 1]!] = value;
        return next;
      }, env);
    }
    return value;
  }
  const path = resolve(okbHome(env), 'profiles', profileId, 'profile.yaml');
  // Two settings saved at once (two clicks, the CLI and the app) must both stay.
  return withStateLock(path, async () => {
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
  });
}

/**
 * Reading profiles: four settings at once, chosen in one question at setup —
 * « Débutant, visuel », « Équilibré », « Expert, concis ».
 */
export const READING_PROFILES = {
  'beginner-visual': { 'reader.level': 'beginner', 'writing.preset': 'pedagogique', 'writing.diagrams': 'prefer', 'writing.detail': 'standard', 'writing.examples': 'project' },
  balanced: { 'reader.level': 'intermediate', 'writing.preset': 'standard', 'writing.diagrams': 'when-useful', 'writing.detail': 'standard', 'writing.examples': 'project' },
  'expert-concise': { 'reader.level': 'expert', 'writing.preset': 'expert', 'writing.diagrams': 'when-useful', 'writing.detail': 'essential', 'writing.examples': 'none' },
} as const;
export type ReadingProfile = keyof typeof READING_PROFILES;

export async function applyReadingProfile(profileId: string, profile: ReadingProfile, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const values = READING_PROFILES[profile];
  if (!values) throw new OkbError('E_INVALID', `unknown reading profile "${profile}"`, { key: 'settingUnknown', params: { name: profile } });
  for (const [key, value] of Object.entries(values)) await writeSetting(profileId, key, value, env);
  return { ...values };
}
