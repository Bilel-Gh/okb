import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import YAML from 'yaml';
import { readOwner, writeOwner } from '../kb/registry.js';
import type { ConceptAssistLevel } from '../config/schema.js';
import { configSchema, CONCEPT_ASSIST_LEVELS } from '../config/schema.js';
import { expandHome, okbHome } from '../config/load.js';
import { assertId } from '../util/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readTextIfExists, writeTextAtomic } from '../util/fsx.js';

export type SetupAnswers = {
  readonly profileId: string;
  readonly displayName?: string;
  readonly humanActor?: string;
  readonly locale?: string;
  readonly role?: string;
  readonly projects?: readonly string[];
  readonly kbRoot: string;
  /** Deliberately has no default: the product must not pick it silently. */
  readonly conceptAssist: ConceptAssistLevel;
  readonly conceptsFolder?: string;
  readonly answerLanguage?: string;
  readonly orgConfig?: string;
  readonly teamConfig?: string;
  readonly machineActor?: string;
  /** Extra tooling paths inside the bundle that are not knowledge. */
  readonly exclude?: readonly string[];
  /** Writing preferences (preset + overrides), merged over the existing ones. */
  readonly writing?: Record<string, unknown>;
  /** Shortcut for `writing.preset`; wins over `writing.preset` from a file. */
  readonly writingPreset?: string;
  /** Prior knowledge of the reader, merged over the existing one. */
  readonly reader?: Record<string, unknown>;
  /** Focus note and session journal (`file`, `journal`, `staleDays`, `sessionStart`), merged. */
  readonly focus?: Record<string, unknown>;
  /** Git settings such as `autoCommit`, merged. */
  readonly git?: Record<string, unknown>;
};

export type SetupResult = {
  readonly home: string;
  readonly profilePath: string;
  readonly rootConfigPath: string;
  readonly created: boolean;
  readonly preserved: readonly string[];
};

export const CONCEPT_ASSIST_HELP = `Concept assist decides whether okb proposes short cards and contextual links
for terms a reader may not know.

  off          no detection, no insertion. Existing cards and links keep working.
  targeted     business vocabulary, internal terms and indispensable prerequisites.
               ← recommended
  pedagogical  targeted, plus the fundamental notions relevant to the subject.

Pick one explicitly: --concept-assist off|targeted|pedagogical`;

export function parseConceptAssist(value: string | undefined): ConceptAssistLevel {
  if (value === undefined) {
    throw new OkbError('E_CONFIG', 'concept assist level was not provided', {
      hint: CONCEPT_ASSIST_HELP,
    });
  }
  if (!(CONCEPT_ASSIST_LEVELS as readonly string[]).includes(value)) {
    throw new OkbError('E_CONFIG', `unknown concept assist level "${value}"`, {
      hint: CONCEPT_ASSIST_HELP,
    });
  }
  return value as ConceptAssistLevel;
}

/**
 * Create or update a profile.
 *
 * Re-running setup must never flatten an existing profile: known keys are
 * updated, every other key the user added is carried over untouched and listed
 * in `preserved` so the operator can see what survived.
 */
export async function runSetup(
  answers: SetupAnswers,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<SetupResult> {
  assertId(answers.profileId, 'profile id');
  const env = options.env ?? process.env;
  const home = okbHome(env);
  const rootConfigPath = resolve(home, 'config.yaml');
  const profileDir = resolve(home, 'profiles', answers.profileId);
  const profilePath = resolve(profileDir, 'profile.yaml');


  const existingRaw = await readTextIfExists(profilePath);
  const existing = existingRaw ? ((YAML.parse(existingRaw) as Record<string, unknown>) ?? {}) : {};
  const created = existingRaw === null;

  const managedKeys = ['profile', 'kb', 'conceptAssist', 'okf', 'orgConfig', 'writing', 'reader', 'focus', 'git'];
  const preserved = Object.keys(existing).filter((k) => !managedKeys.includes(k));

  const next: Record<string, unknown> = {
    ...existing,
    profile: {
      ...(asRecord(existing.profile) ?? {}),
      id: answers.profileId,
      ...(answers.displayName !== undefined ? { displayName: answers.displayName } : {}),
      ...(answers.humanActor !== undefined ? { humanActor: answers.humanActor } : {}),
      ...(answers.locale !== undefined ? { locale: answers.locale } : {}),
      ...(answers.role !== undefined ? { role: answers.role } : {}),
      ...(answers.projects !== undefined ? { projects: [...answers.projects] } : {}),
      ...(answers.answerLanguage !== undefined
        ? {
            answer: {
              ...(asRecord(asRecord(existing.profile)?.answer) ?? {}),
              language: answers.answerLanguage,
            },
          }
        : {}),
    },
    kb: {
      ...(asRecord(existing.kb) ?? {}),
      root: resolve(expandHome(answers.kbRoot, env)),
      ...(answers.exclude !== undefined ? { exclude: [...answers.exclude] } : {}),
      ...(answers.conceptsFolder !== undefined
        ? {
            layout: {
              ...(asRecord(asRecord(existing.kb)?.layout) ?? {}),
              concepts: answers.conceptsFolder,
            },
          }
        : {}),
    },
    conceptAssist: {
      ...(asRecord(existing.conceptAssist) ?? {}),
      level: answers.conceptAssist,
    },
    ...(answers.machineActor
      ? { okf: { ...(asRecord(existing.okf) ?? {}), machineActor: answers.machineActor } }
      : {}),
    ...(answers.writing !== undefined || answers.writingPreset !== undefined
      ? {
          writing: {
            ...(asRecord(existing.writing) ?? {}),
            ...(asRecord(answers.writing) ?? {}),
            ...(answers.writingPreset !== undefined ? { preset: answers.writingPreset } : {}),
          },
        }
      : {}),
    ...(answers.reader !== undefined
      ? { reader: { ...(asRecord(existing.reader) ?? {}), ...(asRecord(answers.reader) ?? {}) } }
      : {}),
    ...(answers.focus !== undefined
      ? { focus: { ...(asRecord(existing.focus) ?? {}), ...(asRecord(answers.focus) ?? {}) } }
      : {}),
    ...(answers.git !== undefined
      ? { git: { ...(asRecord(existing.git) ?? {}), ...(asRecord(answers.git) ?? {}) } }
      : {}),
    ...(answers.orgConfig ? { orgConfig: resolve(expandHome(answers.orgConfig, env)) } : {}),
    ...(answers.teamConfig ? { teamConfig: resolve(expandHome(answers.teamConfig, env)) } : {}),
  };

  const known = Object.fromEntries(Object.entries(next).filter(([k]) => k in configSchema.shape));
  const valid = configSchema.safeParse(known);
  if (!valid.success) throw new OkbError('E_CONFIG', 'invalid setup configuration', { detail: { issues: valid.error.issues } });
  await ensureDir(profileDir);
  await writeTextAtomic(profilePath, YAML.stringify(next, { lineWidth: 0 }));

  const rootRaw = await readTextIfExists(rootConfigPath);
  const root = rootRaw ? ((YAML.parse(rootRaw) as Record<string, unknown>) ?? {}) : {};
  const profiles = new Set<string>(Array.isArray(root.profiles) ? root.profiles.map(String) : []);
  profiles.add(answers.profileId);
  await writeTextAtomic(
    rootConfigPath,
    YAML.stringify(
      { ...root, activeProfile: root.activeProfile ?? answers.profileId, profiles: [...profiles].sort() },
      { lineWidth: 0 },
    ),
  );

  // Setting up a profile on a folder is the person handing that folder to OKB:
  // mark it, unless another profile already owns it (then apply refuses).
  const kbRoot = resolve(expandHome(answers.kbRoot, env));
  if (await stat(kbRoot).then((s) => s.isDirectory(), () => false)) {
    const owner = await readOwner(kbRoot);
    if (owner === null) await writeOwner(kbRoot, answers.profileId);
  }

  return { home, profilePath, rootConfigPath, created, preserved };
}

export async function switchProfile(
  profileId: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  assertId(profileId, 'profile id');
  const home = okbHome(options.env ?? process.env);
  const rootConfigPath = resolve(home, 'config.yaml');
  const raw = await readTextIfExists(rootConfigPath);
  const root = raw ? ((YAML.parse(raw) as Record<string, unknown>) ?? {}) : {};
  const profiles: string[] = Array.isArray(root.profiles) ? root.profiles.map(String) : [];
  if (!profiles.includes(profileId)) {
    throw new OkbError('E_NOT_FOUND', `profile "${profileId}" is not installed`, {
      detail: { installed: profiles },
    });
  }
  await writeTextAtomic(
    rootConfigPath,
    YAML.stringify({ ...root, activeProfile: profileId }, { lineWidth: 0 }),
  );
  return rootConfigPath;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
