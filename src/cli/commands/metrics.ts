import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { metrics } from '../../metrics/metrics.js';
import { flagNumber } from '../args.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb metrics [--days N]` — the 1.0 success criteria measured on this brain,
 * locally and without AI: control, filing, search, speed, quality, start-up
 * cost, robustness, discretion, use. What a beta reads every week.
 */
export async function cmdMetrics(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const result = await metrics(config, await loadBundleFor(config), { days: flagNumber(ctx.args, 'days') ?? 30, ...(flagNumber(ctx.args, 'sample') ? { sample: flagNumber(ctx.args, 'sample')! } : {}) });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...result }); return 0; }
  ctx.out.line(paint.bold(t('metrics.title', { from: result.period.from, to: result.period.to })));
  const icon = { ok: '✅', watch: '⚠️ ', 'n/a': '· ' } as const;
  const value = (m: (typeof result.metrics)[number]) => {
    const params = Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, k === 'backup' ? t(`metrics.backup.${v}`) : String(v)]));
    return t(m.variant ? `metrics.v.${m.id}.${m.variant}` : `metrics.v.${m.id}`, params);
  };
  ctx.out.grid(result.metrics.map((m) => [`${icon[m.verdict]} ${t(`metrics.${m.id}`)}`, value(m), paint.dim(t(`metrics.t.${m.id}`))]));
  for (const m of result.metrics.filter((x) => x.detail && x.verdict === 'watch')) ctx.out.line(paint.dim(`   ${t(`metrics.${m.id}`)} — ${m.detail}`));
  return 0;
}
