import { invoke } from '../../engine/registry.js';
import { t } from '../../i18n/index.js';
import { OkbError } from '../../util/errors.js';
import { actorOf, effective, type Ctx } from './common.js';

/** `okb keep <proposal>` (D71): file what was prepared — to review, or waiting for the person. */
export async function cmdKeep(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[0];
  if (!id) throw new OkbError('E_INVALID', 'usage: okb keep <proposal>', { key: 'usage', params: { usage: 'okb keep <proposal>' } });
  const { config } = await effective(ctx.args);
  const r = await invoke('notes.keep', { proposal: id }, { config, env: process.env, actor: actorOf() });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...r }); return 0; }
  for (const p of r.applied) ctx.out.ok(t('review.kept', { path: p }));
  if (r.waiting) ctx.out.info(t('review.waiting', { id: r.waiting }));
  return 0;
}
