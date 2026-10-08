import { t } from '../../i18n/index.js';
import { progress } from '../../progress/progress.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

const MEDAL = { none: '·', bronze: '🥉', silver: '🥈', gold: '🥇' } as const;

/** `okb progress` — your experience, level, streak and badges in this brain: local and personal, never shared. */
export async function cmdProgress(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const p = await progress(config);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...p }); return 0; }
  ctx.out.line(paint.bold(t('progress.level', { level: p.level.level, xp: p.xp, next: p.level.to })));
  ctx.out.line(t('progress.today', { xp: p.today, current: p.streak.current, best: p.streak.best }));
  for (const b of p.badges) ctx.out.line(`  ${MEDAL[b.tier]} ${t(`progress.badge.${b.id}`)}  ${paint.dim(b.next ? t('progress.toNext', { count: b.count, next: b.next }) : t('progress.done', { count: b.count }))}`);
  return 0;
}
