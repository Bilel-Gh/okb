import { checkIntegrity } from '../brain/integrity.js';
import { layoutOf } from '../brain/layout.js';
import { sessionBrief } from '../brain/session.js';
import type { OkbConfig } from '../config/schema.js';
import { findNotes, knowledgeGaps } from '../find/find.js';
import { journal } from '../journal/journal.js';
import type { Bundle } from '../kb/bundle.js';
import { scoreBundle } from '../scores/scores.js';
import { loadQueue } from '../suggest/suggest.js';
import { readEvents } from '../usage/events.js';
import { estimateTokens } from '../util/context-meter.js';

/**
 * The 1.0 success criteria, measured on the person's own brain, without AI and
 * without sending anything anywhere: control (no note without a yes), filing,
 * search (right note in the top 3, speed), quality, the start-up cost,
 * robustness, discretion, and how the brain is used. The beta reads this.
 */

export type Verdict = 'ok' | 'watch' | 'n/a';
export type Metric = {
  readonly id: string; readonly value: string; readonly target: string; readonly verdict: Verdict; readonly detail?: string;
  /** For people: the numbers behind `value`, put in their language by the CLI (`metrics.v.<id>`). */
  readonly params?: Readonly<Record<string, string | number>>; readonly variant?: string;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** A word with one letter swapped: what a hurried person types. */
function typo(word: string): string {
  if (word.length < 5) return word;
  const i = Math.floor(word.length / 2);
  return word.slice(0, i - 1) + word[i] + word[i - 1] + word.slice(i + 1);
}

export async function metrics(config: OkbConfig, bundle: Bundle, options: { days?: number; sample?: number; now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<{ metrics: Metric[]; period: { from: string; to: string } }> {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  const out: Metric[] = [];
  const layout = layoutOf(config);

  // ✨ Control: every note Claude prepared in a brain answers an accepted suggestion (the guard enforces it; this checks).
  const queue = await loadQueue(config).catch(() => []);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const linked = queue.reduce((n, s) => n + ((s as { proposalIds?: readonly string[] }).proposalIds ?? []).length, 0);
  const writes = (await readEvents(options.env).catch(() => [])).filter((e) => e.at >= since && e.by === 'claude' && e.ok && (!e.kb || e.kb === config.profile.id)
    && (e.command === 'ingest' || (e.command === 'repo' && e.sub === 'write'))).length;
  const unasked = Math.max(0, writes - linked);
  const decided = queue.filter((s) => s.status !== 'pending' && s.status !== 'expired');
  const accepted = decided.filter((s) => s.status === 'accepted' || s.status === 'done').length;
  out.push({ id: 'control', value: layout ? `${unasked} without a yes · ${accepted}/${decided.length} cards accepted` : 'classic KB', params: { unasked, accepted, decided: decided.length }, ...(layout ? {} : { variant: 'classic' }), target: '0 note without a yes', verdict: layout ? (unasked === 0 ? 'ok' : 'watch') : 'n/a' });

  // Filing: notes inside the brain's layout.
  if (layout) {
    const findings = await checkIntegrity(config, bundle, { now, disk: false }).catch(() => []);
    const outside = findings.filter((f) => f.code === 'outside-layout').length;
    const notes = bundle.entries.filter((e) => !e.reserved).length;
    out.push({ id: 'filing', value: `${pct(notes - outside, notes)} % filed (${outside} outside)`, params: { percent: pct(notes - outside, notes), outside }, target: '≥ 95 %', verdict: pct(notes - outside, notes) >= 95 ? 'ok' : 'watch' });
    const broken = findings.filter((f) => f.code === 'broken-link').length;
    const backup = findings.find((f) => f.code === 'no-backup' || f.code === 'old-backup' || f.code === 'unverified-backup');
    out.push({ id: 'robustness', value: `${broken} broken link(s)${backup ? ` · ${backup.code}` : ' · backups verified'}`, params: { broken, backup: backup?.code ?? 'verified' }, target: '0 broken link, a verified backup', verdict: broken === 0 && !backup ? 'ok' : 'watch' });
  } else {
    out.push({ id: 'filing', value: 'classic KB', target: '≥ 95 %', verdict: 'n/a', variant: 'classic' });
  }

  // Search: each sampled note looked up by two words of its title, one with a typo; right note in the top 3, and how fast.
  const sample = bundle.entries.filter((e) => !e.reserved && e.title.split(/\s+/).filter((w) => w.length > 3).length >= 2).slice(0, options.sample ?? 120);
  let top3 = 0;
  const times: number[] = [];
  // The first search builds the index (once per version of the KB); what a person feels is every search after it.
  findNotes(config, bundle, 'okb', { limit: 1 });
  for (const e of sample) {
    const words = e.title.split(/[\s—–:,()«»"]+/).filter((w) => w.length > 3);
    const query = `${typo(words[0]!)} ${words[1]}`;
    const t0 = performance.now();
    const r = findNotes(config, bundle, query, { limit: 3 });
    times.push(performance.now() - t0);
    if (r.hits.slice(0, 3).some((h) => h.path === e.path)) top3++;
  }
  times.sort((a, b) => a - b);
  const p95 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]! : 0;
  out.push({ id: 'search', value: `${pct(top3, sample.length)} % in the top 3 (${sample.length} queries with a typo)`, params: { percent: pct(top3, sample.length), queries: sample.length }, target: '≥ 90 %', verdict: sample.length ? (pct(top3, sample.length) >= 90 ? 'ok' : 'watch') : 'n/a' });
  out.push({ id: 'speed', value: `p95 ${Math.round(p95)} ms on ${bundle.entries.length} notes`, params: { p95: Math.round(p95), notes: bundle.entries.length }, target: '< 50 ms', verdict: times.length ? (p95 < 50 ? 'ok' : 'watch') : 'n/a' });
  const gaps = await knowledgeGaps(config).catch(() => []);
  out.push({ id: 'gaps', value: `${gaps.length} search(es) came back empty twice`, params: { count: gaps.length }, target: 'each one a suggestion', verdict: gaps.length ? 'watch' : 'ok', ...(gaps.length ? { detail: gaps.slice(0, 5).map((g) => g.query).join(' · ') } : {}) });

  // Quality: the notes' scores.
  const scores = await scoreBundle(config, bundle).catch(() => []);
  const avgQuality = scores.length ? Math.round(scores.reduce((n, s) => n + s.quality, 0) / scores.length) : 0;
  const good = scores.filter((s) => s.quality >= 80).length;
  out.push({ id: 'quality', value: `average ${avgQuality}/100 · ${pct(good, scores.length)} % at 80 or more`, params: { average: avgQuality, percent: pct(good, scores.length) }, target: '≥ 80/100', verdict: scores.length ? (avgQuality >= 80 ? 'ok' : 'watch') : 'n/a', detail: 'per model: claude plugin eval ./plugin --tag quality --model sonnet, then opus' });

  // Cost: what a session start costs, whatever the size of the brain.
  if (layout) {
    const brief = await sessionBrief(config, layout, bundle);
    const tokens = estimateTokens(brief);
    out.push({ id: 'cost', value: `start-up summary ≈ ${tokens} tokens`, params: { tokens }, target: '≤ 800 tokens', verdict: tokens <= 800 ? 'ok' : 'watch' });
  }

  // Discretion: suggestions shown on the spot per day, at most a few.
  const shown = queue.filter((s) => s.shownAt && s.shownAt >= since);
  const perDay = new Map<string, number>();
  for (const s of shown) perDay.set(s.shownAt!.slice(0, 10), (perDay.get(s.shownAt!.slice(0, 10)) ?? 0) + 1);
  const busiest = Math.max(0, ...perDay.values());
  out.push({ id: 'discretion', value: `${shown.length} card(s) shown in ${days} days · at most ${busiest} in a day`, params: { shown: shown.length, days, busiest }, target: '≤ 1 every 10 exchanges', verdict: busiest <= 8 ? 'ok' : 'watch' });

  // Use: what the brain gave back over the period.
  const j = await journal(config, bundle, { days, now }).catch(() => null);
  if (j) out.push({ id: 'use', value: `${j.totals.created} note(s) created, ${j.totals.updated} updated, ${j.totals.ticketsDone} ticket(s) done, ${j.totals.reviews} card(s) reviewed`, params: { created: j.totals.created, updated: j.totals.updated, done: j.totals.ticketsDone, reviews: j.totals.reviews }, target: 'the brain in daily use', verdict: j.totals.created + j.totals.updated + j.totals.reviews > 0 ? 'ok' : 'watch' });

  return { metrics: out, period: { from: since.slice(0, 10), to: now.toISOString().slice(0, 10) } };
}
