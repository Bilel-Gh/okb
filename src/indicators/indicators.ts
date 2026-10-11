import { layoutOf } from '../brain/layout.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { sourceStates } from '../kb/provenance.js';
import { collectCards, dueCount, skillsMap } from '../learn/learn.js';
import { isStale } from '../okf/types.js';
import { scoresFor } from '../scores/cached.js';
import { conceptGaps } from '../suggest/gaps.js';
import { glossary } from '../brain/views.js';

/**
 * Honest indicators (F2.0-24). Four of them, never blended into one figure
 * that would hide a hole: coverage (do the terms the notes use have their
 * card?), freshness (did a source change, is a date passed?), quality (how the
 * notes are written) and understanding (what the person studied and knows).
 * Each says what it is made of — so many out of so many — and each gap comes
 * with what to do about it. When there is nothing to measure, there is no
 * figure: never a 100 by default. Computed without AI.
 */
export type GapAction = { readonly kind: 'note' | 'route' | 'command'; readonly to: string };
export type IndicatorGap = { readonly id: string; readonly count: number; readonly examples: readonly { readonly title: string; readonly path?: string }[]; readonly action: GapAction };
export type Indicator = {
  readonly id: 'coverage' | 'freshness' | 'quality' | 'understanding';
  /** 0–100, or null when there is nothing to measure yet. */
  readonly value: number | null;
  /** What the value is made of: `have` out of `total`. */
  readonly of: { readonly have: number; readonly total: number };
  readonly gaps: readonly IndicatorGap[];
};

const pct = (have: number, total: number) => (total ? Math.round((have / total) * 100) : null);
const LOCAL = /^urn:sha256:[a-f0-9]{64}$/i;
const WEAK = 50;

export async function indicators(config: OkbConfig, bundle: Bundle, _env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<Indicator[]> {
  const layout = layoutOf(config);
  const notes = bundle.entries.filter((e) => !e.reserved);

  // Coverage: the terms with a card, against the terms several notes use without one.
  const cards = glossary(layout, bundle).length;
  const missing = conceptGaps(layout, bundle, config.conceptAssist.stoplist);
  const coverage: Indicator = {
    id: 'coverage', value: pct(cards, cards + missing.length), of: { have: cards, total: cards + missing.length },
    gaps: missing.length ? [{ id: 'terms-without-card', count: missing.length, examples: missing.slice(0, 5).map((g) => ({ title: g.term })), action: { kind: 'command', to: 'okb suggest concepts --queue' } }] : [],
  };

  // Freshness: only the notes that can go stale count — a date to recheck, or a local source whose fingerprint is known.
  const dated: { path: string; title: string; past: boolean; resources: string[] }[] = [];
  for (const e of notes) {
    const fm = bundle.docs.get(e.path)?.data as { stale_after?: unknown; sources?: unknown } | undefined;
    if (!fm) continue;
    const resources = (Array.isArray(fm.sources) ? fm.sources as { resource?: unknown }[] : []).map((s) => (typeof s?.resource === 'string' ? s.resource : '')).filter((r) => LOCAL.test(r));
    const hasDate = fm.stale_after !== undefined && fm.stale_after !== null;
    if (hasDate || resources.length) dated.push({ path: e.path, title: e.title, past: hasDate && isStale(fm as never, now), resources });
  }
  const states = await sourceStates(config, dated.flatMap((d) => d.resources)).catch(() => new Map<string, string>());
  const changed = dated.filter((d) => d.resources.some((r) => states.get(r) === 'changed' || states.get(r) === 'missing'));
  const past = dated.filter((d) => d.past);
  const staleCount = new Set([...changed, ...past].map((d) => d.path)).size;
  const example = (d: { title: string; path: string }) => ({ title: d.title, path: d.path });
  const freshness: Indicator = {
    id: 'freshness', value: pct(dated.length - staleCount, dated.length), of: { have: dated.length - staleCount, total: dated.length },
    gaps: [
      ...(changed.length ? [{ id: 'source-changed', count: changed.length, examples: changed.slice(0, 5).map(example), action: { kind: 'note' as const, to: changed[0]!.path } }] : []),
      ...(past.length ? [{ id: 'past-date', count: past.length, examples: past.slice(0, 5).map(example), action: { kind: 'note' as const, to: past[0]!.path } }] : []),
    ],
  };

  // Quality: how the notes are written (structure, sources, clarity, links), note by note.
  const scores = await scoresFor(config, bundle);
  const scored = notes.flatMap((e) => { const s = scores.get(e.path); return s ? [{ path: e.path as string, title: e.title, quality: s.quality }] : []; });
  const weak = scored.filter((s) => s.quality < WEAK).sort((a, b) => a.quality - b.quality);
  const quality: Indicator = {
    id: 'quality', value: scored.length ? Math.round(scored.reduce((n, s) => n + s.quality, 0) / scored.length) : null, of: { have: scored.length - weak.length, total: scored.length },
    gaps: weak.length ? [{ id: 'weak-notes', count: weak.length, examples: weak.slice(0, 5).map(example), action: { kind: 'note', to: weak[0]!.path } }] : [],
  };

  // Understanding: what the person studied, card by card — not what the notes say.
  const study = collectCards(config, bundle);
  const levels = (await skillsMap(config, bundle)).reduce((sum, s) => ({ fresh: sum.fresh + s.levels.new, known: sum.known + s.levels.known + s.levels.mastered }), { fresh: 0, known: 0 });
  const due = await dueCount(config, now).catch(() => 0);
  const understanding: Indicator = {
    id: 'understanding', value: pct(levels.known, study.length), of: { have: levels.known, total: study.length },
    gaps: [
      ...(due ? [{ id: 'due-cards', count: due, examples: [], action: { kind: 'route' as const, to: 'learn' } }] : []),
      ...(levels.fresh ? [{ id: 'never-studied', count: levels.fresh, examples: study.slice(0, 3).map((c) => ({ title: c.title, path: c.path })), action: { kind: 'route' as const, to: 'learn' } }] : []),
    ],
  };
  return [coverage, freshness, quality, understanding];
}
