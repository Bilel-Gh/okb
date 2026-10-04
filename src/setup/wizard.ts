import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expandHome } from '../config/load.js';
import { initFocus, focusPaths } from '../focus/focus.js';
import { systemLanguage, type Lang } from '../i18n/index.js';
import { foreignNotes, kbFoldersIn, kbNames, listKbs, obsidianVaults, overlappingKb, readOwner, setUiLanguage, writeOwner, type KbSummary } from '../kb/registry.js';
import { claudeState, createPrivateRepo, ghState, gitAvailable, initKbRepository, installClaudePlugin, installLauncher, launcherState, type ClaudeState, type LauncherState } from '../integrations/system.js';
import { OkbError } from '../util/errors.js';
import { ensureDir } from '../util/fsx.js';
import { runSetup, switchProfile } from './setup.js';

/**
 * The setup wizard's model, shared by `okb init`, `okb new` and the web page:
 * what the machine already tells us, recommended answers, and the steps that
 * turn answers into a working KB. Every step that reaches outside OKB (Git,
 * GitHub, Claude, the PATH) runs only when its answer says so.
 */
export type WizardContext = {
  readonly systemLanguage: Lang;
  readonly vaults: readonly { path: string; open: boolean; kbs: readonly string[] }[];
  readonly kbs: readonly KbSummary[];
  readonly git: boolean;
  readonly gh: { cli: string | null; loggedIn: boolean; user: string | null };
  readonly claude: ClaudeState;
  readonly launcher: LauncherState;
  readonly person: string;
  readonly sharedFocus: { file: string; journal: string } | null;
};

export async function wizardContext(env: NodeJS.ProcessEnv = process.env, options: { github?: boolean } = {}): Promise<WizardContext> {
  const [vaults, kbs, git, claude, launcher] = await Promise.all([obsidianVaults(env), listKbs(env), gitAvailable(), claudeState(), launcherState()]);
  const withKbs = await Promise.all(vaults.map(async (v) => ({ ...v, kbs: await kbFoldersIn(v.path) })));
  const gh = options.github === false ? { cli: null, loggedIn: false, user: null } : await ghState();
  let person = '';
  try { person = (await promisify(execFile)('git', ['config', '--global', 'user.name'], { timeout: 3000 })).stdout.trim(); } catch { /* none */ }
  if (!person) person = userInfo().username;
  // A focus note another KB already uses is offered again: one person, one focus.
  let sharedFocus: { file: string; journal: string } | null = null;
  for (const kb of kbs) {
    try {
      const { loadConfig } = await import('../config/load.js');
      const { config } = await loadConfig({ env, profileId: kb.id });
      if (config.focus.file) { const p = focusPaths(config); sharedFocus = { file: p.file, journal: p.journal }; break; }
    } catch { /* skip a broken profile */ }
  }
  return { systemLanguage: systemLanguage(env), vaults: withKbs, kbs, git, gh, claude, launcher, person, sharedFocus };
}

export type WizardAnswers = {
  uiLanguage: Lang | 'auto';
  name: string;
  root: string;
  writingLanguage: string;
  preset: 'standard' | 'pedagogique' | 'expert';
  readerLevel: 'beginner' | 'intermediate' | 'expert';
  beginnerDomains: string[];
  conceptAssist: 'off' | 'targeted' | 'pedagogical';
  requireTemplate: boolean;
  focus: 'shared' | 'create' | 'later';
  git: boolean;
  github: boolean;
  plugin: boolean;
  launcher: string | null;
  activate: boolean;
  adopt: boolean;
};

/** Where a new KB goes by default: beside the person's other KBs, else in their newest vault, else a fresh vault folder. */
export function suggestedRoot(ctx: WizardContext, name: string, lang: Lang): string {
  const { folder } = kbNames(name);
  const withKbs = ctx.vaults.find((v) => v.kbs.length > 0);
  if (withKbs) return resolve(withKbs.path, folder);
  const known = ctx.kbs.find((k) => k.root);
  if (known) return resolve(dirname(known.root), folder);
  if (ctx.vaults[0]) return resolve(ctx.vaults[0].path, folder);
  return resolve(homedir(), 'Documents', lang === 'fr' ? 'second-cerveau' : 'second-brain', folder);
}

export function defaultAnswers(ctx: WizardContext, name: string, lang: Lang): WizardAnswers {
  return {
    uiLanguage: 'auto',
    name,
    root: suggestedRoot(ctx, name, lang),
    writingLanguage: lang,
    preset: 'standard',
    readerLevel: 'intermediate',
    beginnerDomains: [],
    conceptAssist: 'targeted',
    requireTemplate: true,
    focus: ctx.sharedFocus ? 'shared' : 'create',
    git: ctx.git,
    github: false,
    plugin: Boolean(ctx.claude.cli) && !ctx.claude.installed,
    launcher: ctx.launcher.onPath ? null : ctx.launcher.candidates[0] ?? null,
    activate: true,
    adopt: false,
  };
}

export type FolderCheck =
  | { readonly state: 'new' }
  | { readonly state: 'empty' }
  | { readonly state: 'okb'; readonly owner: string | null }
  | { readonly state: 'foreign'; readonly examples: readonly string[] }
  | { readonly state: 'overlap'; readonly with: string };

/** What is already in the chosen folder: nothing, an OKB KB, or someone else's notes. */
export async function checkFolder(root: string, id: string, env: NodeJS.ProcessEnv = process.env): Promise<FolderCheck> {
  const abs = resolve(expandHome(root, env));
  const overlap = await overlappingKb(abs, id, env);
  if (overlap) return { state: 'overlap', with: overlap.id };
  const exists = await stat(abs).then((s) => s.isDirectory(), () => false);
  if (!exists) return { state: 'new' };
  const owner = await readOwner(abs);
  if (owner) return { state: 'okb', owner };
  const foreign = await foreignNotes(abs, 5);
  if (foreign.length) return { state: 'foreign', examples: foreign };
  return { state: 'empty' };
}

export type WizardStep = 'profile' | 'folder' | 'language' | 'focus' | 'git' | 'github' | 'plugin' | 'launcher' | 'activate';
export type StepResult = { readonly step: WizardStep; readonly ok: boolean; readonly detail?: string };

function readme(name: string, lang: Lang): string {
  return lang === 'fr'
    ? `# ${name}\n\nBase de connaissances construite avec OKB : chaque note y entre par une proposition approuvée, et chaque application est un commit.\n`
    : `# ${name}\n\nKnowledge base built with OKB: every note enters through an approved proposal, and every apply is a commit.\n`;
}

/** Turn answers into a working KB. Steps report one by one; a failed optional step does not undo the KB. */
export async function runWizard(answers: WizardAnswers, onStep: (r: StepResult) => void, env: NodeJS.ProcessEnv = process.env): Promise<{ id: string; root: string }> {
  const { id, display } = kbNames(answers.name);
  const root = resolve(expandHome(answers.root, env));
  const check = await checkFolder(root, id, env);
  if (check.state === 'overlap') throw new OkbError('E_CONFLICT', `this folder overlaps the KB "${check.with}"`, { key: 'kbOverlap', params: { other: check.with, root } });
  if (check.state === 'foreign' && !answers.adopt) throw new OkbError('E_FORBIDDEN_PATH', 'the folder holds notes OKB did not write', { key: 'kbForeign', params: { root, example: check.examples[0] ?? '' } });
  if (check.state === 'okb' && check.owner && check.owner !== id) throw new OkbError('E_CONFLICT', `the folder belongs to the KB "${check.owner}"`, { key: 'kbOtherOwner', params: { owner: check.owner, root } });
  if ((await listKbs(env)).some((k) => k.id === id) && check.state !== 'okb') throw new OkbError('E_CONFLICT', `a KB named "${id}" already exists`, { key: 'kbNameTaken', params: { id } });

  await setUiLanguage(answers.uiLanguage, env);
  onStep({ step: 'language', ok: true, detail: answers.uiLanguage });

  await ensureDir(root);
  if (check.state === 'foreign' || check.state === 'new' || check.state === 'empty') await writeOwner(root, id);
  onStep({ step: 'folder', ok: true, detail: root });

  const ctx = await wizardContext(env, { github: false });
  const focus = answers.focus === 'shared' && ctx.sharedFocus
    ? { file: ctx.sharedFocus.file, journal: ctx.sharedFocus.journal }
    : answers.focus === 'create'
      ? { file: resolve(dirname(root), dirname(root) === homedir() ? '.okb-focus.md' : '01 Focus.md'), journal: resolve(dirname(root), 'journal') }
      : null;
  const person = (ctx.person || userInfo().username).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'me';
  await runSetup({
    profileId: id,
    displayName: display,
    kbRoot: root,
    conceptAssist: answers.conceptAssist,
    humanActor: `human:${person}`,
    locale: answers.writingLanguage === 'fr' ? 'fr-FR' : 'en-US',
    answerLanguage: answers.writingLanguage,
    writingPreset: answers.preset,
    reader: { level: answers.readerLevel, byDomain: Object.fromEntries(answers.beginnerDomains.map((d) => [d, 'beginner'])) },
    conceptsFolder: 'concepts',
    ...(focus ? { focus: { file: focus.file, journal: focus.journal } } : {}),
    ...(answers.git ? { git: { autoCommit: true } } : {}),
  }, { env });
  // requireTemplate is not a setup flag: write it through the settings model.
  const { writeSetting } = await import('../settings/settings.js');
  await writeSetting(id, 'kb.requireTemplate', answers.requireTemplate, env);
  onStep({ step: 'profile', ok: true, detail: id });

  if (answers.focus === 'create') {
    try {
      const { loadConfig } = await import('../config/load.js');
      const { config } = await loadConfig({ env, profileId: id });
      await initFocus(config).catch((e: unknown) => { if (!(e instanceof OkbError && e.code === 'E_CONFLICT')) throw e; });
      onStep({ step: 'focus', ok: true, detail: focusPaths(config).file });
    } catch (e) {
      onStep({ step: 'focus', ok: false, detail: (e as Error).message });
    }
  } else if (answers.focus === 'shared') {
    onStep({ step: 'focus', ok: true, detail: focus?.file ?? '' });
  }

  if (answers.git) {
    const r = await initKbRepository(root, readme(display, answers.writingLanguage === 'fr' ? 'fr' : 'en'));
    onStep({ step: 'git', ok: r.ok, ...(r.error ? { detail: r.error } : {}) });
    if (r.ok && answers.github) {
      const gh = await createPrivateRepo(root, `kb-${id}`, `${display} — OKB knowledge base`);
      onStep({ step: 'github', ok: gh.ok, ...(gh.url ? { detail: gh.url } : gh.error ? { detail: gh.error } : {}) });
    }
  }

  if (answers.plugin) {
    const r = await installClaudePlugin();
    onStep({ step: 'plugin', ok: r.ok, ...(r.error ? { detail: r.error } : {}) });
  }
  if (answers.launcher) {
    try {
      onStep({ step: 'launcher', ok: true, detail: await installLauncher(answers.launcher) });
    } catch (e) {
      onStep({ step: 'launcher', ok: false, detail: (e as Error).message });
    }
  }
  if (answers.activate) {
    await switchProfile(id, { env });
    onStep({ step: 'activate', ok: true, detail: id });
  }
  return { id, root };
}
