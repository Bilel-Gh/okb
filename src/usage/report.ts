import { lang, t, tn } from '../i18n/index.js';
import type { Feedback, OkbEvent } from './events.js';
import type { QualitySignals } from './quality.js';
import type { UsageStats } from './stats.js';

/**
 * The usage report: cost, context, quality, failures and the person's own
 * remarks, in one Markdown page meant to be handed to Claude to improve OKB.
 * Numbers, command names and KB ids only — no note text, no source text, and
 * note paths only when asked for.
 */
export type CommandStats = { command: string; calls: number; failures: number; codes: Record<string, number>; medianMs: number; byClaude: number };

export function commandStats(events: readonly OkbEvent[], since: string): CommandStats[] {
  const by = new Map<string, { calls: number; failures: number; codes: Record<string, number>; ms: number[]; byClaude: number }>();
  for (const e of events) {
    if (e.at < since) continue;
    const key = e.sub ? `${e.command} ${e.sub}` : e.command;
    const s = by.get(key) ?? { calls: 0, failures: 0, codes: {}, ms: [], byClaude: 0 };
    s.calls += 1;
    if (!e.ok) { s.failures += 1; const c = e.code ?? 'E_UNKNOWN'; s.codes[c] = (s.codes[c] ?? 0) + 1; }
    s.ms.push(e.ms);
    if (e.by === 'claude') s.byClaude += 1;
    by.set(key, s);
  }
  return [...by].map(([command, s]) => {
    const sorted = [...s.ms].sort((a, b) => a - b);
    return { command, calls: s.calls, failures: s.failures, codes: s.codes, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, byClaude: s.byClaude };
  }).sort((a, b) => b.calls - a.calls);
}

/** Leads drawn from quality signals, next to the cost advice of the stats. */
export function qualityLeads(quality: readonly QualitySignals[]): { key: string; params: Record<string, string> }[] {
  const out: { key: string; params: Record<string, string> }[] = [];
  for (const q of quality) {
    if (q.changesProposed >= 10 && q.changesDropped / q.changesProposed >= 0.2) {
      const kind = Object.entries(q.droppedByKind).sort((a, b) => b[1] - a[1])[0];
      out.push({ key: 'report.lead.dropped', params: { kb: q.kb, share: String(Math.round((q.changesDropped / q.changesProposed) * 100)), kind: kind ? kind[0] : '' } });
    }
    if (q.appliedFiles >= 5 && q.editedAfter / q.appliedFiles >= 0.25) out.push({ key: 'report.lead.edited', params: { kb: q.kb, share: String(Math.round((q.editedAfter / q.appliedFiles) * 100)) } });
    if (q.pending >= 3 || (q.pendingOldestDays ?? 0) >= 7) out.push({ key: 'report.lead.pending', params: { kb: q.kb, count: String(q.pending), days: String(q.pendingOldestDays ?? 0) } });
    if (q.rolledBack) out.push({ key: 'report.lead.rolledBack', params: { kb: q.kb, count: String(q.rolledBack) } });
  }
  return out;
}

const num = (n: number, digits: number) => new Intl.NumberFormat(lang() === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
/** "2,52 $" in French, "2.52 $" in English. */
export const usd = (n: number) => `${num(n, n < 10 ? 2 : 0)} $`;
/** "3,3 M", "162 k". */
export const kTok = (n: number) => (n >= 1_000_000 ? `${num(n / 1_000_000, 1)} M` : n >= 1000 ? `${num(n / 1000, 0)} k` : num(n, 0));
const row = (cells: readonly (string | number)[]) => `| ${cells.join(' | ')} |`;

export function renderReport(input: {
  stats: UsageStats;
  quality: readonly QualitySignals[];
  commands: readonly CommandStats[];
  feedback: readonly Feedback[];
  version: string;
  withPaths?: boolean;
}): string {
  const { stats, quality, commands, feedback } = input;
  const okb = stats.okb;
  const lines: string[] = [];
  const day = (iso: string) => iso.slice(0, 10);
  lines.push(`# ${t('report.title', { from: day(stats.from), to: day(stats.to) })}`, '');
  lines.push(`> ${t('report.intro', { version: input.version, prices: stats.pricesAsOf })}`, '');

  lines.push(`## ${t('report.brief')}`, '');
  const share = okb.costUsd + stats.other.costUsd > 0 ? Math.round((okb.costUsd / (okb.costUsd + stats.other.costUsd)) * 100) : 0;
  lines.push(`- ${t('report.brief.runs', { runs: String(okb.runs), cost: usd(okb.costUsd), tokens: kTok(okb.tokens), share: String(share) })}`);
  if (okb.byWorkflow[0]) lines.push(`- ${t('report.brief.top', { workflow: okb.byWorkflow[0].workflow, cost: usd(okb.byWorkflow[0].costUsd) })}`);
  if (okb.cacheHitRatio !== null) lines.push(`- ${t('report.brief.cache', { ratio: String(Math.round(okb.cacheHitRatio * 100)) })}`);
  const q = quality.reduce((acc, x) => ({ applied: acc.applied + x.applied, proposals: acc.proposals + x.proposals - x.superseded, dropped: acc.dropped + x.changesDropped, changes: acc.changes + x.changesProposed, edited: acc.edited + x.editedAfter, files: acc.files + x.appliedFiles }), { applied: 0, proposals: 0, dropped: 0, changes: 0, edited: 0, files: 0 });
  if (q.proposals) lines.push(`- ${t('report.brief.quality', { applied: String(q.applied), proposals: String(q.proposals), dropped: String(q.dropped), changes: String(q.changes), edited: String(q.edited), files: String(q.files) })}`);
  const failures = commands.reduce((n, c) => n + c.failures, 0);
  const calls = commands.reduce((n, c) => n + c.calls, 0);
  if (calls) lines.push(`- ${t('report.brief.commands', { calls: String(calls), failures: String(failures) })}`);
  if (feedback.length) lines.push(`- ${tn('report.brief.feedback', feedback.length)}`);
  lines.push('');

  const leads = [...stats.advice, ...qualityLeads(quality)];
  lines.push(`## ${t('report.leads')}`, '');
  if (leads.length) for (const a of leads) lines.push(`- ${t(a.key, a.params)}`);
  else lines.push(t('report.leads.none'));
  lines.push('');

  lines.push(`## ${t('report.cost')}`, '');
  if (okb.byWorkflow.length) {
    lines.push(row([t('report.col.workflow'), t('report.col.runs'), t('report.col.total'), t('report.col.avg'), t('report.col.avgTokens'), t('report.col.agents'), t('report.col.minutes')]));
    lines.push(row(['---', '---:', '---:', '---:', '---:', '---:', '---:']));
    for (const w of okb.byWorkflow) lines.push(row([`\`${w.workflow}\``, w.runs, usd(w.costUsd), usd(w.avgCostUsd), kTok(w.avgTokens), usd(w.agentsCostUsd), num(w.medianMinutes, 1)]));
    lines.push('');
    lines.push(row([t('report.col.model'), t('report.col.total'), t('report.col.tokens')]));
    lines.push(row(['---', '---:', '---:']));
    for (const m of okb.byModel) lines.push(row([m.label, usd(m.costUsd), kTok(m.tokens)]));
    lines.push('');
    if (okb.byProfile.length > 1 || okb.byProfile[0]?.profile !== '?') {
      lines.push(row([t('report.col.kb'), t('report.col.runs'), t('report.col.total')]));
      lines.push(row(['---', '---:', '---:']));
      for (const p of okb.byProfile) lines.push(row([p.profile === '?' ? t('report.kbUnknown') : p.profile, p.runs, usd(p.costUsd)]));
      lines.push('');
    }
    const tk = okb.tokensByKind;
    lines.push(t('report.tokens', { read: kTok(tk.read), write: kTok(tk.write5m + tk.write1h), input: kTok(tk.input), output: kTok(tk.output) }), '');
  } else lines.push(t('report.noRuns'), '');

  lines.push(`## ${t('report.context')}`, '');
  lines.push(`- ${t('report.context.skills', { tokens: kTok(okb.skillTokensEstimated) })}`);
  if (okb.hook.runs) lines.push(`- ${t('report.context.hook', { runs: String(okb.hook.runs), tokens: kTok(Math.round(okb.hook.tokensEstimated / okb.hook.runs)) })}`);
  if (okb.outputs.length) {
    lines.push('', row([t('report.col.command'), t('report.col.calls'), t('report.col.outTokens'), t('report.col.perCall')]));
    lines.push(row(['---', '---:', '---:', '---:']));
    for (const o of okb.outputs.slice(0, 12)) lines.push(row([`\`okb ${o.command}\``, o.calls, kTok(o.tokensEstimated), kTok(Math.round(o.tokensEstimated / Math.max(1, o.calls)))]));
  }
  lines.push('');

  lines.push(`## ${t('report.quality')}`, '');
  if (quality.length) {
    lines.push(row([t('report.col.kb'), t('report.col.proposals'), t('report.col.applied'), t('report.col.dropped'), t('report.col.rolledBack'), t('report.col.pending'), t('report.col.review'), t('report.col.edited')]));
    lines.push(row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']));
    for (const x of quality) {
      lines.push(row([x.kb, x.proposals, `${x.applied}${x.partial ? ` (${t('report.partial', { n: String(x.partial) })})` : ''}`, `${x.changesDropped}/${x.changesProposed}`, x.rolledBack, x.pending ? `${x.pending} (${x.pendingOldestDays} j)` : '0', x.reviewHoursMedian === null ? '—' : `${num(x.reviewHoursMedian, 1)} h`, `${x.editedAfter}/${x.appliedFiles}`]));
    }
    const kinds = quality.flatMap((x) => Object.entries(x.droppedByKind));
    if (kinds.length) lines.push('', t('report.droppedKinds', { list: kinds.map(([k, n]) => `${k} ${n}`).join(', ') }));
    if (input.withPaths) {
      const edited = quality.flatMap((x) => x.editedPaths.map((p) => `${x.kb}: ${p}`));
      if (edited.length) lines.push('', t('report.editedList'), ...edited.map((p) => `- ${p}`));
    }
  } else lines.push(t('report.noQuality'));
  lines.push('');

  lines.push(`## ${t('report.commands')}`, '');
  if (commands.length) {
    lines.push(row([t('report.col.command'), t('report.col.calls'), t('report.col.byClaude'), t('report.col.failures'), t('report.col.medianMs')]));
    lines.push(row(['---', '---:', '---:', '---:', '---:']));
    for (const c of commands.slice(0, 20)) lines.push(row([`\`okb ${c.command}\``, c.calls, c.byClaude, c.failures ? `${c.failures} (${Object.entries(c.codes).map(([k, n]) => `${k}×${n}`).join(', ')})` : '0', c.medianMs]));
  } else lines.push(t('report.noCommands'));
  lines.push('');

  lines.push(`## ${t('report.feedback')}`, '');
  if (feedback.length) for (const f of feedback) lines.push(`- ${f.at.slice(0, 10)}${f.kb ? ` (${f.kb})` : ''} : ${f.text.replace(/\n+/g, ' ')}`);
  else lines.push(t('report.noFeedback'));
  lines.push('', '---', '', t('report.next'));
  return `${lines.join('\n')}\n`;
}
