import { join } from 'node:path';
import { t, tn } from '../../i18n/index.js';
import { productVersion } from '../../integrations/system.js';
import { collectUsage } from '../../usage/collect.js';
import { addFeedback } from '../../usage/events.js';
import { kTok, renderReport, usd } from '../../usage/report.js';
import { usageDir } from '../../usage/stats.js';
import { OkbError } from '../../util/errors.js';
import { ensureDir, writeTextAtomic } from '../../util/fsx.js';
import { flagBool, flagNumber, flagString } from '../args.js';
import { columns, paint } from '../ui/term.js';
import type { Ctx } from './common.js';


/**
 * `okb usage` — what OKB costs: by workflow, model and KB, what fills the
 * context, and advice. Read from Claude Code's local logs: no token spent.
 */
export async function cmdUsage(ctx: Ctx): Promise<number> {
  const days = flagNumber(ctx.args, 'days') ?? 30;
  const data = await collectUsage({ days });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...data }); return 0; }
  const { stats } = data;
  const okb = stats.okb;
  ctx.out.line(paint.bold(t('usage.title', { days: String(days) })) + paint.dim(`  ${t('usage.subtitle', { prices: stats.pricesAsOf })}`));
  ctx.out.line();
  if (!okb.runs) {
    ctx.out.line(t('usage.none', { logs: String(stats.logs) }));
    ctx.out.line(paint.dim(t('usage.howItWorks')));
    qualityLines(ctx, data.quality);
    ctx.out.next(['okb serve', 'okb report']);
    return 0;
  }
  const total = okb.costUsd + stats.other.costUsd;
  ctx.out.line(`  ${paint.bold(usd(okb.costUsd))} ${t('usage.okbCost', { runs: tn('usage.runs', okb.runs), tokens: kTok(okb.tokens) })}`);
  if (total > 0) ctx.out.line(`  ${paint.dim(t('usage.share', { share: String(Math.round((okb.costUsd / total) * 100)), other: usd(stats.other.costUsd) }))}`);
  if (okb.cacheHitRatio !== null) ctx.out.line(`  ${paint.dim(t('usage.cache', { ratio: String(Math.round(okb.cacheHitRatio * 100)) }))}`);
  ctx.out.line();
  const width = Math.max(10, Math.min(30, columns() - 60));
  const max = Math.max(...okb.byWorkflow.map((w) => w.costUsd), 0.0001);
  const nameW = Math.max(...okb.byWorkflow.map((w) => w.workflow.length)) + 2;
  ctx.out.line(paint.dim(`  ${t('usage.byWorkflow')}`));
  for (const w of okb.byWorkflow) {
    const bar = '█'.repeat(Math.max(1, Math.round((w.costUsd / max) * width)));
    ctx.out.line(`  ${w.workflow.padEnd(nameW)}${paint.ansi(36, bar.padEnd(width))} ${usd(w.costUsd).padStart(7)}  ${paint.dim(t('usage.perRun', { runs: String(w.runs), avg: usd(w.avgCostUsd), tokens: kTok(w.avgTokens) }))}`);
  }
  ctx.out.line();
  ctx.out.line(paint.dim(`  ${t('usage.byModel')}  `) + okb.byModel.map((m) => `${m.label} ${usd(m.costUsd)}`).join(paint.dim(' · ')));
  if (okb.agents.length) ctx.out.line(paint.dim(`  ${t('usage.agents')}  `) + okb.agents.map((a) => `${a.type.replace(/^okb:/, '')} ${usd(a.costUsd)} (${a.models.join('/')})`).join(paint.dim(' · ')));
  const heavy = okb.outputs.filter((o) => o.tokensEstimated / Math.max(1, o.calls) >= 1500).slice(0, 3);
  if (heavy.length) ctx.out.line(paint.dim(`  ${t('usage.outputs')}  `) + heavy.map((o) => `okb ${o.command} ~${kTok(Math.round(o.tokensEstimated / Math.max(1, o.calls)))}/${t('usage.call')}`).join(paint.dim(' · ')));
  qualityLines(ctx, data.quality);
  if (stats.advice.length) {
    ctx.out.line();
    for (const a of stats.advice) ctx.out.line(`  ${paint.warn('→')} ${t(a.key, a.params)}`);
  }
  ctx.out.next(['okb report', 'okb serve']);
  return 0;
}

function qualityLines(ctx: Ctx, quality: Awaited<ReturnType<typeof collectUsage>>['quality']): void {
  for (const q of quality) {
    ctx.out.line(paint.dim(`  ${t('usage.quality', { kb: q.kb })}  `) + t('usage.qualityLine', { applied: String(q.applied), proposals: String(q.proposals - q.superseded), dropped: String(q.changesDropped), changes: String(q.changesProposed), edited: String(q.editedAfter), files: String(q.appliedFiles) }));
  }
}

/** `okb report` — the usage report as a Markdown file, to hand to Claude. */
export async function cmdReport(ctx: Ctx): Promise<number> {
  const days = flagNumber(ctx.args, 'days') ?? 30;
  const data = await collectUsage({ days });
  const text = renderReport({ ...data, version: await productVersion(), withPaths: flagBool(ctx.args, 'with-paths') });
  const dir = join(usageDir(), 'reports');
  const out = flagString(ctx.args, 'out') ?? join(dir, `okb-report-${new Date().toISOString().slice(0, 10)}.md`);
  await ensureDir(flagString(ctx.args, 'out') ? join(out, '..') : dir);
  await writeTextAtomic(out, text);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, path: out, report: text }); return 0; }
  if (flagBool(ctx.args, 'print')) { ctx.out.line(text); return 0; }
  ctx.out.ok(t('report.written', { path: paint.code(out) }));
  ctx.out.line(paint.dim(`  ${t('report.howToUse')}`));
  return 0;
}

/** `okb feedback "…"` — note a problem or an idea, for the next report. */
export async function cmdFeedback(ctx: Ctx): Promise<number> {
  const text = ctx.args.positionals.join(' ').trim();
  if (!text) throw new OkbError('E_INVALID', 'usage: okb feedback "<what went wrong or what you would like>"', { key: 'usage', params: { usage: 'okb feedback "…"' } });
  const kb = flagString(ctx.args, 'kb') ?? undefined;
  await addFeedback({ at: new Date().toISOString(), text: text.slice(0, 2000), where: 'cli', ...(kb ? { kb } : {}) });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true }); return 0; }
  ctx.out.ok(t('feedback.saved'));
  return 0;
}
