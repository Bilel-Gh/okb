import { loadConfig } from '../../config/load.js';
import { languageName, t } from '../../i18n/index.js';
import { archiveKb, foreignNotes, listKbs, readOwner, writeOwner } from '../../kb/registry.js';
import { switchProfile } from '../../setup/setup.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagString } from '../args.js';
import { choose, confirm, input } from '../ui/prompt.js';
import { paint, sym, tilde } from '../ui/term.js';
import { canAsk, effective, type Ctx } from './common.js';
import { KIND_ICON, kindOf } from '../../work/kinds.js';


/** `okb kb` — every KB, the active one starred; switch, add an existing folder, remove, adopt. */
export async function cmdKb(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const sub = args.positionals[0] ?? (canAsk(ctx) ? 'menu' : 'list');
  const kbs = await listKbs();

  if (sub === 'list' || sub === 'menu') {
    const kinds = new Map(await Promise.all(kbs.map(async (k) => [k.id, await kindOf(k.id).catch(() => 'topic' as const)] as const)));
    // A brain says so, with its preset (work, projects, topics, career).
    const { loadConfig } = await import('../../config/load.js');
    const brains = new Map(await Promise.all(kbs.map(async (k) => [k.id, (await loadConfig({ profileId: k.id }).catch(() => null))?.config.kb.brain?.preset ?? null] as const)));
    const kindLabel = (id: string) => brains.get(id) ? `🧠 ${t(`brain.preset.${brains.get(id)}`)}` : `${KIND_ICON[kinds.get(id) ?? 'topic']} ${t(`kb.kind.${kinds.get(id) ?? 'topic'}`)}`;
    if (ctx.mode === 'json') { out.json({ ok: true, kbs: kbs.map((k) => ({ ...k, kind: kinds.get(k.id), brain: brains.get(k.id) })) }); return 0; }
    if (!kbs.length) { out.info(t('kb.none')); out.next(['okb new', 'okb kb add <dossier>']); return 0; }
    out.grid(kbs.map((k) => [
      k.active ? sym.star() : ' ',
      paint.bold(k.name) + (k.name !== k.id ? paint.dim(` (${k.id})`) : ''),
      kindLabel(k.id),
      languageName(k.writingLanguage),
      k.exists ? tilde(k.root) : paint.err(`${tilde(k.root)} — ${t('kb.missing')}`),
    ]), ['', t('kb.col.kb'), t('kb.col.kind'), t('kb.col.lang'), t('kb.col.folder')]);
    if (sub === 'list') { out.next(['okb kb switch <kb>', 'okb new', 'okb kb add <dossier>', 'okb kb remove <kb>']); return 0; }
    const action = await choose(t('kb.menu.q'), [
      { value: 'switch', label: t('kb.menu.switch'), recommended: kbs.length > 1 },
      { value: 'new', label: t('kb.menu.new') },
      { value: 'add', label: t('kb.menu.add') },
      { value: 'archive', label: t('kb.menu.archive') },
      { value: 'quit', label: t('ui.quit') },
    ]);
    if (action === 'quit') return 0;
    if (action === 'new') { const { cmdInit } = await import('./init.js'); return cmdInit(ctx, { first: false }); }
    if (action === 'add') return doAdd(ctx, null);
    const id = await choose(action === 'switch' ? t('kb.switch.q') : t('kb.archive.q'), kbs.map((k) => ({ value: k.id, label: k.name, hint: tilde(k.root), recommended: action === 'switch' ? !k.active : false })));
    return action === 'switch' ? doSwitch(ctx, id) : doArchive(ctx, id);
  }

  if (sub === 'switch' || sub === 'use') {
    let id = args.positionals[1];
    if (!id) {
      if (!canAsk(ctx)) throw new OkbError('E_INVALID', 'usage: okb kb switch <kb>', { key: 'usage', params: { usage: 'okb kb switch <kb>' } });
      id = await choose(t('kb.switch.q'), kbs.map((k) => ({ value: k.id, label: k.name, hint: tilde(k.root), recommended: !k.active })));
    }
    return doSwitch(ctx, id);
  }

  if (sub === 'archive' || sub === 'remove' || sub === 'rm' || sub === 'delete') {
    let id = args.positionals[1];
    if (!id) {
      if (!canAsk(ctx) || !kbs.length) throw new OkbError('E_INVALID', 'usage: okb kb remove <kb>', { key: 'usage', params: { usage: 'okb kb remove <kb>' } });
      id = await choose(t('kb.archive.q'), kbs.map((k) => ({ value: k.id, label: k.name, hint: tilde(k.root) })));
    }
    return doArchive(ctx, id);
  }

  if (sub === 'add' || sub === 'connect') return doAdd(ctx, args.positionals[1] ?? null);
  if (sub === 'merge') return doMerge(ctx);
  if (sub === 'convert') return doConvert(ctx);

  if (sub === 'adopt') {
    const { config } = await effective(args);
    const owner = await readOwner(config.kb.root);
    if (owner && owner !== config.profile.id && !flagBool(args, 'force')) {
      throw new OkbError('E_CONFLICT', `the folder belongs to the KB "${owner}"`, { key: 'kbOtherOwner', params: { owner, root: config.kb.root } });
    }
    const foreign = await foreignNotes(config.kb.root, 3);
    if (canAsk(ctx) && foreign.length) {
      out.warn(t('kb.adopt.warn', { root: tilde(config.kb.root), example: foreign[0]! }));
      if (!(await confirm(t('kb.adopt.q'), false))) return 130;
    } else if (foreign.length && !flagBool(args, 'yes')) {
      throw new OkbError('E_INVALID', 'adopting a folder with foreign notes needs --yes', { key: 'adoptNeedsYes', params: { root: config.kb.root } });
    }
    await writeOwner(config.kb.root, config.profile.id);
    if (ctx.mode === 'json') out.json({ ok: true, adopted: config.kb.root, profile: config.profile.id });
    else out.ok(t('kb.adopt.done', { root: tilde(config.kb.root), id: config.profile.id }));
    return 0;
  }

  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb kb [list|switch <kb>|add <dossier>|remove <kb>|convert|merge <kb> --into <kb>|adopt]' } });
}

async function doSwitch(ctx: Ctx, id: string): Promise<number> {
  await switchProfile(id);
  const { config } = await loadConfig({ profileId: id });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, active: id, kbRoot: config.kb.root });
  else ctx.out.ok(t('kb.switched', { name: config.profile.displayName || id, root: tilde(config.kb.root) }));
  return 0;
}

async function doArchive(ctx: Ctx, id: string): Promise<number> {
  const kb = (await listKbs()).find((k) => k.id === id);
  if (canAsk(ctx) && !(await confirm(t('kb.archive.confirm', { id, root: kb ? tilde(kb.root) : '' }), false))) return 130;
  if (!canAsk(ctx) && !flagBool(ctx.args, 'yes') && ctx.mode !== 'json') throw new OkbError('E_INVALID', 'removing needs --yes', { key: 'archiveNeedsYes', params: { id } });
  const where = await archiveKb(id);
  const left = await listKbs();
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, archived: id, settings: where, kbsLeft: left.length }); return 0; }
  ctx.out.ok(t('kb.archived', { id, where: tilde(where) }));
  if (kb) ctx.out.line(paint.dim(`  ${t('kb.archived.notes', { root: tilde(kb.root) })}`));
  if (!left.length) { ctx.out.info(t('kb.noneConnected')); ctx.out.next(['okb new', 'okb kb add <dossier>']); }
  return 0;
}

/**
 * `okb kb add [folder]` — connect a folder of notes as a KB, under a name the
 * person chooses. Notes written before OKB stay as they are; `okb kb convert`
 * then prepares their move to OKB's format, as a proposal.
 */
export async function doAdd(ctx: Ctx, folderArg: string | null): Promise<number> {
  const { out, args } = ctx;
  const { expandHome } = await import('../../config/load.js');
  const { resolve } = await import('node:path');
  const { kbNames } = await import('../../kb/registry.js');
  const { checkFolder } = await import('../../setup/wizard.js');
  const { connectKb } = await import('../../setup/connect.js');
  let folder = folderArg ?? flagString(args, 'dir');
  if (!folder) {
    if (!canAsk(ctx)) throw new OkbError('E_INVALID', 'usage: okb kb add <folder> --name <name>', { key: 'usage', params: { usage: 'okb kb add <dossier> --name <nom>' } });
    folder = await input(t('kb.add.where'), { placeholder: '~/Documents/mes-notes', validate: (v) => (v.trim() ? undefined : t('wiz.required')) });
  }
  const root = resolve(expandHome(folder.trim()));
  const kbs = await listKbs();
  const taken = new Set(kbs.map((k) => k.id));
  let name = flagString(args, 'name') ?? null;
  if (!name) {
    if (!canAsk(ctx)) throw new OkbError('E_INVALID', 'okb kb add needs --name <name> when it cannot ask', { key: 'kbAddNeedsName' });
    name = await input(t('wiz.name.q'), { placeholder: t('wiz.name.placeholder'), validate: (v) => (!v.trim() ? t('wiz.required') : taken.has(kbNames(v).id) ? t('wiz.name.taken', { id: kbNames(v).id }) : undefined) });
  }
  if (canAsk(ctx)) {
    const check = await checkFolder(root, kbNames(name).id).catch(() => null);
    if (check?.state === 'foreign') {
      out.info(t('kb.add.legacy', { root: tilde(root), example: check.examples[0]! }));
      if (!(await confirm(t('kb.adopt.q'), true))) return 130;
    }
  }
  const confidential = flagBool(args, 'confidential', false) || (canAsk(ctx) && (await confirm(t('kb.add.confidential'), false)));
  const activate = flagBool(args, 'activate', false) || (kbs.length > 0 && canAsk(ctx) && (await confirm(t('wiz.activate.q', { name }), true)));
  const created = await connectKb({ folder: root, name, confidential, activate });
  if (ctx.mode === 'json') { out.json({ ok: true, ...created, confidential }); return 0; }
  out.ok(t('kb.add.done', { name: paint.name(name), root: tilde(created.root) }));
  if (created.notesBeforeOkb) {
    out.line(`  ${t('kb.add.toConvert', { n: String(created.notesBeforeOkb) })}`);
    out.next([`okb kb convert --kb ${created.id}`, t('kb.add.askClaude')]);
  } else out.next([`okb status --kb ${created.id}`]);
  return 0;
}

/**
 * `okb kb convert` — what the notes written before OKB lack, and a plan to
 * complete; `--plan-file <plan>` turns the completed plan into one proposal.
 */
async function doConvert(ctx: Ctx): Promise<number> {
  const { out, args } = ctx;
  const { config } = await effective(args);
  const { buildConversion, scanConversion, writePlanSkeleton } = await import('../../kb/convert.js');
  const planFile = flagString(args, 'plan-file');
  if (planFile) {
    const { readFile } = await import('node:fs/promises');
    let raw: unknown;
    try { raw = JSON.parse(await readFile(planFile, 'utf8')); } catch (cause) { throw new OkbError('E_INVALID', `cannot read the plan ${planFile}`, { cause, key: 'convertPlanUnreadable', params: { path: planFile } }); }
    const result = await buildConversion(config, raw);
    const { saveProposal } = await import('../../proposal/store.js');
    await saveProposal(config, result.proposal);
    if (ctx.mode === 'json') { out.json({ ok: true, proposalId: result.proposal.id, converted: result.converted, kept: result.kept, moved: result.moved, linksRewritten: result.linksRewritten, manualLinks: result.manualLinks.slice(0, 40), files: result.proposal.changes.length }); return 0; }
    out.ok(t('kb.convert.prepared', { n: String(result.converted), files: String(result.proposal.changes.length) }));
    out.line(`  ${t('kb.convert.detail', { moved: String(result.moved.length), links: String(result.linksRewritten), kept: String(result.kept) })}`);
    if (result.manualLinks.length) out.warn(t('kb.convert.manual', { n: String(result.manualLinks.length) }));
    out.next([`okb review ${result.proposal.id}`, 'okb serve']);
    return 0;
  }
  const scan = await scanConversion(config, { limit: Number(flagString(args, 'limit') ?? 40), cursor: flagString(args, 'cursor') ?? null });
  const skeleton = await writePlanSkeleton(config);
  if (ctx.mode === 'json') { out.json({ ok: true, ...scan, planWritten: !skeleton.existed }); return 0; }
  out.line(paint.bold(t('kb.convert.title', { kb: config.profile.displayName || config.profile.id })));
  out.line(`  ${t('kb.convert.counts', { notes: String(scan.notes), legacy: String(scan.legacy), okb: String(scan.alreadyOkb), links: String(scan.wikilinks) })}`);
  if (scan.unreadable.length) out.warn(t('kb.convert.unreadable', { n: String(scan.unreadable.length), example: scan.unreadable[0]!.path }));
  if (!scan.legacy) { out.ok(t('kb.convert.nothing')); return 0; }
  const missing = new Map<string, number>();
  for (const n of scan.page) for (const f of n.missing) missing.set(f, (missing.get(f) ?? 0) + 1);
  if (missing.size) out.line(`  ${paint.dim(t('kb.convert.missing', { list: [...missing].map(([f, k]) => `${f} ${k}`).join(', ') }))}`);
  out.line();
  out.line(t('kb.convert.how'));
  out.line(`  ${paint.dim(t('kb.convert.plan', { path: tilde(skeleton.path) }))}`);
  out.next([t('kb.add.askClaude'), `okb kb convert --plan-file ${tilde(skeleton.path)}`]);
  return 0;
}

/**
 * `okb kb merge <repository KB> --into <workspace KB>`: first a proposal that
 * puts every note under `repos/<id>/` of the workspace; once it is approved
 * and applied, the same command finishes (state, registration) and offers to
 * retire the old KB from OKB — its folder stays as it is.
 */
async function doMerge(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const sourceId = args.positionals[1];
  const targetId = flagString(args, 'into');
  if (!sourceId || !targetId) throw new OkbError('E_INVALID', 'usage: okb kb merge <repository KB> --into <workspace KB>', { key: 'usage', params: { usage: 'okb kb merge <KB du repo> --into <KB de l’espace>' } });
  const { planMerge, mergeProposal, finishMerge } = await import('../../work/merge.js');
  const { saveProposal } = await import('../../proposal/store.js');
  const source = (await loadConfig({ profileId: sourceId })).config;
  const target = (await loadConfig({ profileId: targetId })).config;
  const plan = await planMerge(source, target);
  if (plan.applied || flagBool(args, 'finish')) {
    if (!plan.applied) throw new OkbError('E_CONFLICT', 'the merge proposal is not applied yet', { key: 'mergeNotApplied', params: { source: sourceId, target: targetId } });
    const done = await finishMerge(source, target, plan.repo);
    let retired = false;
    if (flagBool(args, 'retire') || (canAsk(ctx) && (await confirm(t('kb.merge.retireQ', { name: source.profile.displayName || sourceId }), true)))) {
      await archiveKb(sourceId);
      retired = true;
    }
    if (ctx.mode === 'json') { out.json({ ok: true, finished: true, repo: plan.repo.id, kb: targetId, ...done, retired }); return 0; }
    out.ok(t('kb.merge.finished', { repo: paint.name(plan.repo.name), kb: paint.name(target.profile.displayName || targetId) }));
    if (retired) out.line(paint.dim(`  ${t('kb.merge.retired', { root: tilde(source.kb.root) })}`));
    return 0;
  }
  const { proposal, reused } = await mergeProposal(source, target, plan);
  if (!reused) await saveProposal(target, proposal);
  if (ctx.mode === 'json') { out.json({ ok: true, finished: false, proposalId: proposal.id, reused, files: proposal.changes.length, conflicts: plan.conflicts, binaries: plan.binaries, repo: plan.repo.id }); return 0; }
  out.ok(t('kb.merge.proposed', { n: proposal.changes.length, repo: paint.name(plan.repo.name), kb: paint.name(target.profile.displayName || targetId) }));
  if (plan.conflicts.length) out.warn(t('kb.merge.conflicts', { files: plan.conflicts.slice(0, 5).join(', ') }));
  if (plan.binaries.length) out.line(paint.dim(`  ${t('kb.merge.binaries', { n: plan.binaries.length, root: tilde(source.kb.root) })}`));
  out.next([`okb review ${proposal.id} --kb ${targetId}`, `okb kb merge ${sourceId} --into ${targetId}`]);
  return 0;
}
