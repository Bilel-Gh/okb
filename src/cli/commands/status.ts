import { formatDate, lang, languageName, relativeTime, t, tn } from '../../i18n/index.js';
import { computeStatus, type Status } from '../../status/status.js';
import { flagBool } from '../args.js';
import { paint, sym } from '../ui/term.js';
import { config, kbFlag, type Ctx } from './common.js';

/** One line for status bars: `📚 atlas · 🎯 3 j · 📥 2 · ⏳ 1`. */
export function statusLine(s: Status): string {
  const parts = [`📚 ${s.profile}`];
  if (s.focus.exists) parts.push(`🎯 ${s.focus.ageDays ?? 0}${t('ui.daysShort')}${s.focus.stale ? '!' : ''}`);
  if (s.inbox.open) parts.push(`📥 ${s.inbox.open}`);
  if (s.pending.length) parts.push(`⏳ ${s.pending.length}`);
  return parts.join(' · ');
}

export function printStatus(ctx: Ctx, s: Status): void {
  const { out } = ctx;
  const k = kbFlag(ctx.args);
  out.line(`${sym.kb()} ${paint.bold(s.name)}${s.name !== s.profile ? ` ${paint.dim(`(${s.profile})`)}` : ''}  ${paint.dim(s.kbRoot)}`);
  out.line(paint.dim(`   ${tn('status.notes', s.notes, { concepts: s.concepts })} · ${t('status.writing', { lang: languageName(s.writingLanguage) })}`));
  const rows: string[][] = [];
  rows.push(['🎯', t('status.focus'), s.focus.exists
    ? (s.focus.stale ? paint.warn(t('status.focusStale', { age: s.focus.ageDays ?? 0 })) : t('status.focusFresh', { age: relativeTime(new Date(Date.now() - (s.focus.ageDays ?? 0) * 86_400_000)) }))
    : paint.dim(t('status.focusNone'))]);
  rows.push(['📓', t('status.lastSession'), s.lastSession
    ? `${relativeTime(s.lastSession.at)}${s.lastSession.next ? ` — ${t('status.next')} ${s.lastSession.next}` : ''}`
    : paint.dim(t('status.noSession'))]);
  rows.push(['📥', t('status.inbox'), s.inbox.open ? tn('status.inboxOpen', s.inbox.open, { days: s.inbox.oldestDays ?? 0 }) : paint.dim(t('status.inboxEmpty'))]);
  rows.push(['⏳', t('status.pending'), s.pending.length ? paint.warn(tn('status.pendingCount', s.pending.length)) : paint.dim(t('status.pendingNone'))]);
  rows.push(['↩️', t('status.lastApply'), s.lastApply ? `${formatDate(s.lastApply.appliedAt)} · ${tn('status.files', s.lastApply.files)}` : paint.dim('—')]);
  if (s.toReview) rows.push(['🔁', t('status.toReview'), tn('status.toReviewCount', s.toReview)]);
  if (s.health) {
    const h = s.health;
    const tone = h.errors ? paint.err : h.warnings ? paint.warn : paint.ok;
    rows.push(['🩺', t('status.health'), tone(`${h.score}/100`) + paint.dim(` · ${tn('status.errors', h.errors)} · ${tn('status.warnings', h.warnings)}`)]);
  }
  if (s.git.repo) {
    rows.push(['🌿', 'Git', s.git.dirty ? paint.warn(tn('status.gitDirty', s.git.dirty)) : s.git.ahead ? paint.warn(tn('status.gitAhead', s.git.ahead)) : paint.ok(t('status.gitClean'))]);
  }
  out.grid(rows.map((r) => [r[0]!, r[1]!, r[2]!]));
  if (s.pending.length) {
    out.heading(t('status.waiting'));
    for (const p of s.pending.slice(0, 5)) out.line(`  ${paint.bold(`#${p.number}`)} ${p.title} ${paint.dim(`· ${tn('status.files', p.files)} · ${relativeTime(p.createdAt)}`)}`);
  }
  const steps: string[] = [];
  if (s.pending.length) steps.push(`okb review${s.pending.length === 1 ? ' 1' : ''}${k}`);
  if (!s.focus.exists) steps.push(`okb focus init${k}`);
  else if (s.focus.stale) steps.push(`okb focus${k}`);
  if (s.inbox.open) steps.push(`okb inbox${k}`);
  if (s.git.repo && (s.git.ahead ?? 0) > 0) steps.push(`git -C "${s.kbRoot}" push`);
  out.next(steps);
}

export async function cmdStatus(ctx: Ctx): Promise<number> {
  const cfg = await config(ctx.args);
  const s = await computeStatus(cfg, { light: flagBool(ctx.args, 'brief') });
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, ...s, line: statusLine(s), ui: lang() });
    return 0;
  }
  if (flagBool(ctx.args, 'brief')) {
    ctx.out.line(statusLine(s));
    return 0;
  }
  printStatus(ctx, s);
  return 0;
}
