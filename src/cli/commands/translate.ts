import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { estimateTranslation, proposeTranslation, translateNote } from '../../translate/translate.js';
import { OkbError } from '../../util/errors.js';
import { asBundlePath, type BundlePath } from '../../util/paths.js';
import { flagBool, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb translate <note> --to en [--full] [--estimate] [--save]` — a note in
 * another language, on demand: « En bref » first, the whole note with --full,
 * the cost alone with --estimate. Kept on disk, never in the KB; --save
 * prepares a proposal for a translated note beside the original.
 */
export async function cmdTranslate(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const arg = ctx.args.positionals[0];
  const lang = flagString(ctx.args, 'to');
  if (!arg || !lang) throw new OkbError('E_INVALID', 'usage: okb translate <note> --to <lang>', { key: 'usage', params: { usage: 'okb translate <note> --to en [--full] [--estimate] [--save]' } });
  const path = await notePath(config, arg);
  const scope = flagBool(ctx.args, 'full') || flagBool(ctx.args, 'save') ? 'full' : 'brief';
  const confirmSecret = flagBool(ctx.args, 'confirm-secret');
  if (flagBool(ctx.args, 'estimate')) {
    const e = await estimateTranslation(config, path, lang, scope, process.env, { confirmSecret });
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, path, lang, scope, ...e }); return 0; }
    ctx.out.line(e.tokens ? t('translate.estimate', { tokens: e.tokens, n: e.toTranslate, cached: e.cached }) : t('translate.allCached'));
    return 0;
  }
  const r = await translateNote(config, path, lang, scope, process.env, { confirmSecret });
  if (flagBool(ctx.args, 'save')) {
    const proposal = await proposeTranslation(config, path, lang);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, path, lang, proposalId: proposal.id, target: proposal.changes[0]?.path }); return 0; }
    ctx.out.ok(t('translate.saved', { id: proposal.id, path: proposal.changes[0]?.path ?? '' }));
    ctx.out.next([`okb review ${proposal.id}`]);
    return 0;
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, path, lang, scope, ...r }); return 0; }
  ctx.out.line(r.markdown.trimEnd());
  ctx.out.line(paint.dim(t('translate.done', { translated: r.translated, cached: r.cached, tokens: r.tokens })));
  if (scope === 'brief') ctx.out.tip(t('translate.fullTip', { note: arg, lang }));
  return 0;
}

/** A note by its path in the KB, or by its exact title. */
async function notePath(config: Awaited<ReturnType<typeof effective>>['config'], arg: string): Promise<BundlePath> {
  const bundle = await loadBundleFor(config);
  const clean = arg.replace(/^\.\//, '');
  if (bundle.byPath.has(clean as BundlePath)) return asBundlePath(clean);
  const byTitle = bundle.entries.filter((e) => !e.reserved && e.title.toLowerCase() === arg.toLowerCase());
  if (byTitle.length === 1) return byTitle[0]!.path;
  throw new OkbError('E_NOT_FOUND', `no note ${arg}`, { key: 'noteUnknown', params: { path: arg } });
}
