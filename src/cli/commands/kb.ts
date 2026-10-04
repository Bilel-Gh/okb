import { loadConfig } from '../../config/load.js';
import { languageName, t } from '../../i18n/index.js';
import { archiveKb, foreignNotes, listKbs, readOwner, writeOwner } from '../../kb/registry.js';
import { switchProfile } from '../../setup/setup.js';
import { OkbError } from '../../util/errors.js';
import { flagBool } from '../args.js';
import { choose, confirm } from '../ui/prompt.js';
import { paint, sym, tilde } from '../ui/term.js';
import { canAsk, effective, type Ctx } from './common.js';


/** `okb kb` — every KB, the active one starred; switch, archive, adopt. */
export async function cmdKb(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const sub = args.positionals[0] ?? (canAsk(ctx) ? 'menu' : 'list');
  const kbs = await listKbs();

  if (sub === 'list' || sub === 'menu') {
    if (ctx.mode === 'json') { out.json({ ok: true, kbs }); return 0; }
    if (!kbs.length) { out.info(t('kb.none')); out.next(['okb init']); return 0; }
    out.grid(kbs.map((k) => [
      k.active ? sym.star() : ' ',
      paint.bold(k.name) + (k.name !== k.id ? paint.dim(` (${k.id})`) : ''),
      languageName(k.writingLanguage),
      k.exists ? tilde(k.root) : paint.err(`${tilde(k.root)} — ${t('kb.missing')}`),
    ]), ['', t('kb.col.kb'), t('kb.col.lang'), t('kb.col.folder')]);
    if (sub === 'list') { out.next(['okb kb switch <kb>', 'okb new']); return 0; }
    const action = await choose(t('kb.menu.q'), [
      { value: 'switch', label: t('kb.menu.switch'), recommended: kbs.length > 1 },
      { value: 'new', label: t('kb.menu.new') },
      { value: 'archive', label: t('kb.menu.archive') },
      { value: 'quit', label: t('ui.quit') },
    ]);
    if (action === 'quit') return 0;
    if (action === 'new') { const { cmdInit } = await import('./init.js'); return cmdInit(ctx, { first: false }); }
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

  if (sub === 'archive') {
    const id = args.positionals[1];
    if (!id) throw new OkbError('E_INVALID', 'usage: okb kb archive <kb>', { key: 'usage', params: { usage: 'okb kb archive <kb>' } });
    return doArchive(ctx, id);
  }

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

  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb kb [list|switch <kb>|archive <kb>|adopt]' } });
}

async function doSwitch(ctx: Ctx, id: string): Promise<number> {
  await switchProfile(id);
  const { config } = await loadConfig({ profileId: id });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, active: id, kbRoot: config.kb.root });
  else ctx.out.ok(t('kb.switched', { name: config.profile.displayName || id, root: tilde(config.kb.root) }));
  return 0;
}

async function doArchive(ctx: Ctx, id: string): Promise<number> {
  if (canAsk(ctx) && !(await confirm(t('kb.archive.confirm', { id }), false))) return 130;
  if (!canAsk(ctx) && !flagBool(ctx.args, 'yes') && ctx.mode !== 'json') throw new OkbError('E_INVALID', 'archiving needs --yes', { key: 'archiveNeedsYes', params: { id } });
  const where = await archiveKb(id);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, archived: id, settings: where });
  else ctx.out.ok(t('kb.archived', { id, where: tilde(where) }));
  return 0;
}
