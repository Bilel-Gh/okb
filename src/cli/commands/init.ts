import { resolve } from 'node:path';
import { expandHome } from '../../config/load.js';
import { lang, languageName, setLanguage, systemLanguage, t, WRITING_LANGUAGES, type Lang } from '../../i18n/index.js';
import { kbNames, listKbs } from '../../kb/registry.js';
import { productVersion } from '../../integrations/system.js';
import { checkFolder, defaultAnswers, okbVaults, runTools, runWizard, suggestedRoot, wizardContext, type StepResult, type WizardAnswers, type WizardContext } from '../../setup/wizard.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagString } from '../args.js';
import { choose, confirm, input, intro, note, outro, spin, step } from '../ui/prompt.js';
import { banner, paint, sym, tilde, yesNo } from '../ui/term.js';
import { canAsk, type Ctx } from './common.js';


async function askLocation(ctx: WizardContext, name: string, current: string): Promise<{ root: string; adopt: boolean }> {
  const { id } = kbNames(name);
  for (;;) {
    const suggested = suggestedRoot(ctx, name, lang());
    const fresh = !ctx.kbs.length && !ctx.vaults.some((v) => v.kbs.length);
    const options = [{ value: suggested, label: tilde(suggested), hint: t(fresh ? 'wiz.where.fresh' : 'wiz.where.suggested'), recommended: true }];
    for (const v of okbVaults(ctx).slice(0, 3)) {
      const p = resolve(v.path, kbNames(name).folder);
      if (p !== suggested) options.push({ value: p, label: tilde(p), hint: t('wiz.where.vault'), recommended: false });
    }
    options.push({ value: '__other', label: t('wiz.where.other'), hint: '', recommended: false });
    let root = await choose(t('wiz.where.q', { name: paint.name(name) }), options, current || suggested);
    if (root === '__other') root = resolve(expandHome(await input(t('wiz.where.path'), { placeholder: tilde(suggested), validate: (v) => (v.trim() ? undefined : t('wiz.required')) })));
    const check = await checkFolder(root, id);
    if (check.state === 'overlap') { step.err(t('err.kbOverlap.why', { other: check.with, root })); continue; }
    if (check.state === 'okb' && check.owner && check.owner !== id) { step.err(t('err.kbOtherOwner.why', { owner: check.owner, root })); continue; }
    if (check.state === 'foreign') {
      note(t('wiz.where.foreignNote', { root: tilde(root), example: check.examples[0] ?? '' }), t('wiz.where.foreignTitle'));
      if (await confirm(t('wiz.where.adopt'), false)) return { root, adopt: true };
      continue;
    }
    if (check.state === 'okb') step.info(t('wiz.where.existing'));
    return { root, adopt: false };
  }
}

function recap(a: WizardAnswers, ctx: WizardContext): string {
  const { id, folder } = kbNames(a.name);
  const yes = (b: boolean) => yesNo(b, t('ui.yes'), t('ui.no'));
  const rows: [string, string][] = [
    [t('wiz.recap.kb'), `${paint.name(a.name)} ${paint.dim(`(${folder} · ${id})`)}`],
    [t('wiz.recap.folder'), paint.path(a.root)],
    [t('wiz.recap.uiLang'), a.uiLanguage === 'auto' ? `${t('wiz.lang.auto')} ${paint.dim(`(${languageName(systemLanguage())})`)}` : languageName(a.uiLanguage)],
    [t('wiz.recap.writingLang'), languageName(a.writingLanguage)],
    [t('wiz.recap.style'), `${t(`settings.opt.writing.preset.${a.preset}`)} ${paint.dim('·')} ${t(`settings.opt.reader.level.${a.readerLevel}`)}`],
    [t('wiz.recap.help'), t(`settings.opt.conceptAssist.level.${a.conceptAssist}`)],
    [t('wiz.recap.focus'), a.focus === 'later' ? paint.dim(t(`wiz.focus.${a.focus}`)) : t(`wiz.focus.${a.focus}`)],
  ];
  if (ctx.claude.cli) rows.push([t('wiz.recap.plugin'), ctx.claude.installed && !a.plugin ? paint.dim(t('wiz.recap.pluginThere')) : yes(a.plugin)]);
  rows.push([t('wiz.recap.launcher'), ctx.launcher.onPath ? paint.dim(t('wiz.recap.launcherThere')) : a.launcher ? paint.path(resolve(a.launcher, 'okb')) : paint.dim(t('ui.no'))]);
  const w = Math.max(...rows.map((r) => r[0].length));
  return rows.map(([k, v]) => `${paint.dim(k.padEnd(w))}  ${v}`).join('\n');
}

/** One line per step that ran: ✔ label, then the folder or value it concerns. */
function stepLines(results: readonly StepResult[]): string {
  const w = Math.max(...results.map((r) => t(`wiz.step.${r.step}`).length));
  return results.map((r) => {
    const label = t(`wiz.step.${r.step}`).padEnd(w);
    const detail = r.detail ? (r.detail.startsWith('/') ? paint.path(r.detail) : paint.dim(r.detail)) : '';
    return r.ok ? `${sym.ok()} ${label}  ${detail}`.trimEnd() : `${sym.warn()} ${paint.warn(label)}  ${paint.dim(t('wiz.stepFailed'))}`;
  }).join('\n');
}

/** `okb init` (first time) and `okb new` (another KB): the guided setup. */
export async function cmdInit(ctx: Ctx, options: { first: boolean }): Promise<number> {
  const { args, out } = ctx;
  const wctx = await wizardContext();
  const first = options.first && wctx.kbs.length === 0;

  if (!canAsk(ctx)) {
    // No KB unless one is named: OKB never connects a KB by default.
    const name = flagString(args, 'name') ?? args.positionals[0];
    const ui = (flagString(args, 'lang') as Lang | undefined) ?? 'auto';
    if (!name) {
      if (!options.first) throw new OkbError('E_INVALID', 'okb new needs a name when it cannot ask: okb new --name <name> [--dir <folder>]', { key: 'initNeedsName' });
      const results: StepResult[] = [];
      await runTools({ uiLanguage: ui, plugin: flagBool(args, 'plugin', false), launcher: flagString(args, 'launcher') ?? null }, (r) => results.push(r));
      if (ctx.mode === 'json') { out.json({ ok: true, kb: null, steps: results }); return 0; }
      out.ok(t('wiz.toolsOnly'));
      out.info(t('kb.noneConnected'));
      out.next(['okb new', 'okb kb add <dossier>']);
      return 0;
    }
    // A KB for code: one repository, or a team's repositories (a workspace).
    const kind = flagString(args, 'kind');
    if (kind && !['topic', 'repo', 'workspace'].includes(kind)) throw new OkbError('E_INVALID', `--kind must be topic, repo or workspace`, { key: 'usage', params: { usage: 'okb init --kind topic|repo|workspace' } });
    if (kind === 'repo' || kind === 'workspace') {
      return createForCode(ctx, kind, { name, folder: flagString(args, kind === 'repo' ? 'repo' : 'workspace') ?? process.cwd(), dir: flagString(args, 'dir') ?? null, inRepo: flagBool(args, 'in-repo') });
    }
    // --folder and --kb-root (the 0.3 name) mean --dir: a folder given must never be silently ignored.
    const dir = flagString(args, 'dir') ?? flagString(args, 'folder') ?? flagString(args, 'kb-root');
    const answers: WizardAnswers = {
      ...defaultAnswers(wctx, name, ui === 'auto' ? systemLanguage() : ui),
      uiLanguage: ui,
      ...(dir ? { root: resolve(expandHome(dir)) } : {}),
      ...(flagString(args, 'writing-lang') ? { writingLanguage: flagString(args, 'writing-lang')! } : {}),
      ...(flagString(args, 'preset') ? { preset: flagString(args, 'preset') as WizardAnswers['preset'] } : {}),
      plugin: flagBool(args, 'plugin', false),
      launcher: flagString(args, 'launcher') ?? null,
      adopt: flagBool(args, 'adopt', false),
      kind: 'topic',
    };
    const results: StepResult[] = [];
    const brainPreset = flagString(args, 'brain');
    if (brainPreset && !['work', 'projects', 'topics', 'career'].includes(brainPreset)) throw new OkbError('E_INVALID', '--brain must be work, projects, topics or career', { key: 'usage', params: { usage: 'okb init --name <name> --brain work|projects|topics|career' } });
    const created = await runWizard(answers, (r) => results.push(r));
    // A brain (OKB 1.0): drawers and subjects; a work brain is confidential by default.
    if (brainPreset) {
      const { setBrainConfig } = await import('../../brain/config.js');
      await setBrainConfig(created.id, { preset: brainPreset as 'work', names: answers.writingLanguage.startsWith('fr') ? 'fr' : 'en' });
    }
    if (flagBool(args, 'confidential', brainPreset === 'work')) {
      const { writeSetting } = await import('../../settings/settings.js');
      await writeSetting(created.id, 'kb.confidential', true);
    }
    if (ctx.mode === 'json') { out.json({ ok: true, ...created, ...(brainPreset ? { brain: brainPreset } : {}), steps: results }); return 0; }
    out.ok(t('wiz.done', { name: paint.name(answers.name) }));
    out.line(stepLines(results).split('\n').map((l) => `  ${l}`).join('\n'));
    out.next([`okb status --kb ${created.id}`]);
    return 0;
  }

  out.line(banner(await productVersion(), t('wiz.banner')));
  intro(paint.bold(first ? t('wiz.intro.first') : t('wiz.intro.new')));

  let uiLanguage: Lang | 'auto' = 'auto';
  if (first) {
    uiLanguage = await choose<Lang | 'auto'>('Langue d’OKB · OKB language', [
      { value: 'fr', label: 'Français', recommended: systemLanguage() === 'fr' },
      { value: 'en', label: 'English', recommended: systemLanguage() === 'en' },
      { value: 'auto', label: 'Auto (système · system)', hint: languageName(systemLanguage()) },
    ]);
    setLanguage(uiLanguage === 'auto' ? systemLanguage() : uiLanguage);
  } else {
    const { readRootConfig } = await import('../../kb/registry.js');
    const root = await readRootConfig();
    uiLanguage = root.ui?.language ?? 'auto';
  }

  // OKB connects no KB by default: create one, connect an existing folder, or later.
  const start = await choose<'create' | 'add' | 'later'>(t('wiz.start.q'), [
    { value: 'create', label: t('wiz.start.create'), hint: t('wiz.start.createHint'), recommended: true },
    { value: 'add', label: t('wiz.start.add'), hint: t('wiz.start.addHint') },
    ...(first ? [{ value: 'later' as const, label: t('wiz.start.later'), hint: t('wiz.start.laterHint') }] : []),
  ]);
  if (start === 'add') {
    if (first) await runTools({ uiLanguage, plugin: false, launcher: null }, () => undefined);
    const { doAdd } = await import('./kb.js');
    const code = await doAdd(ctx, null);
    if (code === 0 && first) await offerTools(ctx, wctx);
    return code;
  }
  if (start === 'later') {
    await runTools({ uiLanguage, plugin: false, launcher: null }, () => undefined);
    await offerTools(ctx, wctx);
    out.info(t('kb.noneConnected'));
    outro(t('wiz.laterOutro'));
    return 0;
  }

  // What the KB is for: a subject, one code repository, or a team's repositories.
  const { gitRoot } = await import('../../repo/git.js');
  const { reposIn } = await import('../../work/workspaces.js');
  const { dirname } = await import('node:path');
  const here = await gitRoot(process.cwd());
  const reposHere = await reposIn(process.cwd()).catch(() => [] as string[]);
  const siblings = here ? (await reposIn(dirname(here)).catch(() => [] as string[])).filter((r) => resolve(r) !== resolve(here)) : [];
  const teamHere = reposHere.length > 1 || siblings.length > 0;
  const kind = await choose<'topic' | 'repo' | 'workspace'>(t('wiz.kind.q'), [
    { value: 'topic', label: t('wiz.kind.topic'), hint: t('wiz.kind.topicHint'), recommended: !here && !reposHere.length },
    { value: 'repo', label: t('wiz.kind.repo'), hint: t('wiz.kind.repoHint'), recommended: Boolean(here) && !teamHere },
    { value: 'workspace', label: t('wiz.kind.workspace'), hint: t('wiz.kind.workspaceHint'), recommended: teamHere },
  ]);
  if (kind !== 'topic') {
    const suggested = kind === 'repo' ? here ?? '' : reposHere.length ? process.cwd() : siblings.length && here ? dirname(here) : '';
    const folder = resolve(expandHome(await input(t(kind === 'repo' ? 'wiz.kind.repoPath' : 'wiz.kind.workspacePath'), {
      ...(suggested ? { initial: suggested } : {}),
      validate: (v) => (v.trim() ? undefined : t('wiz.required')),
    })));
    const takenIds = new Set((await listKbs()).map((k) => k.id));
    const name = await input(t(kind === 'repo' ? 'repo.add.repoKbName' : 'repo.add.newKbName'), {
      placeholder: kind === 'repo' ? folder.split('/').pop() ?? '' : t('repo.add.newKbDefault'),
      validate: (v) => (!v.trim() ? t('wiz.required') : takenIds.has(kbNames(v).id) ? t('wiz.name.taken', { id: kbNames(v).id }) : undefined),
    });
    const inRepo = kind === 'repo' && await choose(t('repo.add.whereQ'), [
      { value: false, label: t('repo.add.whereOutside'), hint: t('repo.add.whereOutsideHint'), recommended: true },
      { value: true, label: t('repo.add.whereInside'), hint: t('repo.add.whereInsideHint') },
    ]);
    if (first) {
      await runTools({ uiLanguage, plugin: false, launcher: null }, () => undefined);
      await offerTools(ctx, wctx);
    }
    return createForCode(ctx, kind, { name, folder, dir: null, inRepo });
  }

  const mode = await choose<'quick' | 'custom'>(t('wiz.mode.q'), [
    { value: 'quick', label: t('wiz.mode.quick'), hint: t('wiz.mode.quickHint'), recommended: true },
    { value: 'custom', label: t('wiz.mode.custom'), hint: t('wiz.mode.customHint') },
  ]);

  const taken = new Set((await listKbs()).map((k) => k.id));
  // The person names the KB: nothing is suggested in the field.
  const name = await input(t('wiz.name.q'), {
    placeholder: t('wiz.name.placeholder'),
    validate: (v) => {
      if (!v.trim()) return t('wiz.required');
      if (taken.has(kbNames(v).id)) return t('wiz.name.taken', { id: kbNames(v).id });
      return undefined;
    },
  });
  const names = kbNames(name);
  step.info(t('wiz.name.derived', { folder: paint.code(names.folder), id: paint.code(names.id) }));

  const answers = { ...defaultAnswers(wctx, name, lang()), kind: 'topic' as const };
  answers.uiLanguage = uiLanguage;
  const where = await askLocation(wctx, name, answers.root);
  answers.root = where.root;
  answers.adopt = where.adopt;

  answers.writingLanguage = await choose(t('wiz.writing.q'), [
    ...WRITING_LANGUAGES.map((l) => ({ value: l.code, label: l[lang()], recommended: l.code === lang() })),
  ]);

  if (mode === 'custom') {
    answers.readerLevel = await choose(t('wiz.reader.q'), (['beginner', 'intermediate', 'expert'] as const).map((v) => ({
      value: v, label: t(`settings.opt.reader.level.${v}`), hint: t(`settings.hint.reader.level.${v}`), recommended: v === 'intermediate',
    })));
    answers.preset = await choose(t('wiz.style.q'), (['standard', 'pedagogique', 'expert'] as const).map((v) => ({
      value: v, label: t(`settings.opt.writing.preset.${v}`), hint: t(`settings.hint.writing.preset.${v}`), recommended: v === (answers.readerLevel === 'beginner' ? 'pedagogique' : 'standard'),
    })));
    answers.conceptAssist = await choose(t('wiz.help.q'), (['targeted', 'pedagogical', 'off'] as const).map((v) => ({
      value: v, label: t(`settings.opt.conceptAssist.level.${v}`), hint: t(`settings.hint.conceptAssist.level.${v}`), recommended: v === 'targeted',
    })));
    answers.requireTemplate = await confirm(t('wiz.templates.q'), true);
    answers.focus = await choose(t('wiz.focus.q'), [
      ...(wctx.sharedFocus ? [{ value: 'shared' as const, label: t('wiz.focus.shared'), hint: tilde(wctx.sharedFocus.file), recommended: true }] : []),
      { value: 'create' as const, label: t('wiz.focus.create'), hint: t('wiz.focus.createHint'), recommended: !wctx.sharedFocus },
      { value: 'later' as const, label: t('wiz.focus.later') },
    ]);
  }

  if (wctx.claude.cli && !wctx.claude.installed) answers.plugin = await confirm(t('wiz.plugin.q'), true);
  else answers.plugin = false;
  if (!wctx.launcher.onPath && wctx.launcher.candidates[0]) {
    answers.launcher = (await confirm(t('wiz.launcher.q', { dir: tilde(wctx.launcher.candidates[0]) }), true)) ? wctx.launcher.candidates[0] : null;
  } else answers.launcher = null;
  answers.activate = first || (await confirm(t('wiz.activate.q', { name }), true));

  note(recap(answers, wctx), t('wiz.recap.title'));
  const go = await choose<'go' | 'cancel'>(t('wiz.go.q'), [
    { value: 'go', label: t('wiz.go.yes'), recommended: true },
    { value: 'cancel', label: t('wiz.go.cancel') },
  ]);
  if (go === 'cancel') { outro(t('ui.cancelledNothing')); return 130; }

  const s = spin(t('wiz.running'));
  const results: StepResult[] = [];
  let created: { id: string; root: string };
  try {
    created = await runWizard(answers, (r) => results.push(r));
    s.done(paint.ok(t('wiz.configured')));
  } catch (e) {
    s.fail(t('wiz.failed'));
    throw e;
  }
  note(stepLines(results), t('wiz.doneTitle'));
  const next = [
    `${sym.arrow()} ${t('wiz.next.claude', { cmd: paint.code('/okb:ingest') })}`,
    `${sym.arrow()} ${paint.code('okb status')}  ${paint.dim(t('wiz.next.status'))}`,
    `${sym.arrow()} ${paint.code('okb serve')}   ${paint.dim(t('wiz.next.reader'))}`,
  ];
  if (results.some((r) => r.step === 'plugin' && r.ok)) next.unshift(`${paint.warn('!')} ${paint.bold(t('wiz.next.newSession'))}`);
  note(next.join('\n'), t('ui.nextSteps'));
  outro(t('wiz.outro', { name: paint.name(name), id: created.id }));
  return 0;
}

/** The plugin and the `okb` command, offered when no KB is created now. */
async function offerTools(ctx: Ctx, wctx: WizardContext): Promise<void> {
  const plugin = Boolean(wctx.claude.cli) && !wctx.claude.installed && (await confirm(t('wiz.plugin.q'), true));
  const launcher = !wctx.launcher.onPath && wctx.launcher.candidates[0] && (await confirm(t('wiz.launcher.q', { dir: tilde(wctx.launcher.candidates[0]) }), true)) ? wctx.launcher.candidates[0] : null;
  if (!plugin && !launcher) return;
  const results: StepResult[] = [];
  await runTools({ uiLanguage: (await (await import('../../kb/registry.js')).readRootConfig()).ui?.language ?? 'auto', plugin, launcher }, (r) => results.push(r));
  note(stepLines(results), t('wiz.doneTitle'));
  void ctx;
}

/**
 * A KB for code, made and filled in one go: a repository KB with its
 * repository registered and mapped, or a work KB with every repository of
 * the folder (a workspace). Confidential, local, no AI involved.
 */
async function createForCode(ctx: Ctx, kind: 'repo' | 'workspace', input: { name: string; folder: string; dir: string | null; inRepo: boolean }): Promise<number> {
  const { createCodeKb, cmdRepo } = await import('./repo.js');
  const folder = resolve(expandHome(input.folder));
  // The name given is the KB's: the repository keeps its own, the workspace its folder's.
  const { name: _kbName, ...flags } = ctx.args.flags;
  void _kbName;
  if (kind === 'repo') {
    const { gitRoot } = await import('../../repo/git.js');
    const root = await gitRoot(folder, { strict: true });
    if (!root) throw new OkbError('E_NOT_FOUND', `not a Git repository: ${folder}`, { key: 'repoNotGit', params: { path: folder } });
    const id = await createCodeKb(ctx, { name: input.name, dir: input.dir, kind: 'repo', repoRoot: root, inRepo: input.inRepo });
    const code = await cmdRepo({ ...ctx, args: { ...ctx.args, positionals: ['add', root], flags: { ...flags, kb: id } } });
    if (code === 0 && ctx.mode === 'text') ctx.out.next([`cd ${tilde(root)} && claude`, '/okb-dev:onboard']);
    return code;
  }
  const id = await createCodeKb(ctx, { name: input.name, dir: input.dir, kind: 'workspace', repoRoot: null });
  const { workspaceAdd } = await import('./work.js');
  return workspaceAdd({ ...ctx, args: { ...ctx.args, flags: { ...flags, kb: id } } }, folder);
}
