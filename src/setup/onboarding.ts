import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig, okbHome } from '../config/load.js';
import { kbNames, listKbs } from '../kb/registry.js';
import { setModule } from '../modules/catalog.js';
import { createProject } from '../projects/projects.js';
import { assertNoSecrets } from '../security/guard.js';
import { OkbError } from '../util/errors.js';
import { runWizard, type StepResult } from './wizard.js';

export const onboardingSchema = z.object({ profile: z.enum(['dev', 'consultant', 'student', 'other']), name: z.string().trim().min(1).max(80), project: z.string().trim().min(1).max(200), language: z.enum(['fr', 'en']), folder: z.string().trim().min(1).max(1000).optional() }).strict();
const NEXT = { fr: 'Choisir la prochaine petite étape.', en: 'Choose the next small step.' };
/** A short first launch on the shared wizard, without touching the person's agent, shell, or an existing folder. */
export async function startOnboarding(raw: unknown, env: NodeJS.ProcessEnv = process.env) {
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'choose a profile, a space name and a first project');
  const input = parsed.data;
  assertNoSecrets(input, 'onboarding');
  const id = kbNames(input.name).id;
  const existing = await listKbs(env);
  if (existing.some((k) => k.id === id)) throw new OkbError('E_CONFLICT', 'a space with this name already exists; open it instead');
  // Explicit test homes stay entirely in their sandbox; production notes stay readable in Documents.
  const base = env.OKB_HOME ? resolve(okbHome(env), 'brains') : resolve(homedir(), 'Documents', 'OKB');
  const root = input.folder ?? resolve(base, kbNames(input.name).folder);
  const steps: StepResult[] = [];
  const result = await runWizard({ name: input.name, root, uiLanguage: input.language, writingLanguage: input.language, preset: 'standard', readerLevel: 'intermediate', beginnerDomains: [], conceptAssist: 'targeted', requireTemplate: true, focus: 'later', plugin: false, launcher: null, activate: true, adopt: false, kind: input.profile === 'dev' ? 'workspace' : 'topic' }, (step) => steps.push(step), env);
  const { config } = await loadConfig({ env, profileId: result.id });
  const project = createProject(config, { title: input.project, where: input.language === 'fr' ? 'Je commence.' : 'Getting started.', next: NEXT[input.language] });
  // Profiles are welcome paths, not new business modules. Dev can be enabled later from Settings.
  if (existing.length === 0) await setModule('dev', input.profile === 'dev', env);
  else if (input.profile === 'dev') await setModule('dev', true, env);
  return { ok: true, ...result, project, steps };
}
