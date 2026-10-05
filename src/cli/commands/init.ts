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
    [t('wiz.recap.git'), a.git ? `${paint.ok(t('ui.yes'))}${a.github ? paint.dim(` · ${t('wiz.recap.github')}`) : ''}` : paint.dim(t('ui.no'))],
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
    // --folder and --kb-root (the 0.3 name) mean --dir: a folder given must never be silently ignored.
    const dir = flagString(args, 'dir') ?? flagString(args, 'folder') ?? flagString(args, 'kb-root');
    const answers: WizardAnswers = {
      ...defaultAnswers(wctx, name, ui === 'auto' ? systemLanguage() : ui),
      uiLanguage: ui,
      ...(dir ? { root: resolve(expandHome(dir)) } : {}),
      ...(flagString(args, 'writing-lang') ? { writingLanguage: flagString(args, 'writing-lang')! } : {}),
      ...(flagString(args, 'preset') ? { preset: flagString(args, 'preset') as WizardAnswers['preset'] } : {}),
      git: flagBool(args, 'git', wctx.git),
      github: flagBool(args, 'github', false),
      plugin: flagBool(args, 'plugin', false),
      launcher: flagString(args, 'launcher') ?? null,
      adopt: flagBool(args, 'adopt', false),
    };
    const results: StepResult[] = [];
    const created = await runWizard(answers, (r) => results.push(r));
    if (ctx.mode === 'json') { out.json({ ok: true, ...created, steps: results }); return 0; }
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

  const answers = defaultAnswers(wctx, name, lang());
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
    if (wctx.git) {
      answers.git = await confirm(t('wiz.git.q'), true);
      if (answers.git && wctx.gh.loggedIn) answers.github = await confirm(t('wiz.github.q', { user: wctx.gh.user ?? '' }), false);
    }
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

