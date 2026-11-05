import type { Attempt, TicketState } from './ticket-state.js';
import type { JournalEntry } from './tickets.js';

/**
 * « How I solved it » (chantier 4): the ticket told as a story, from what was
 * already kept: its journal (filled by the scribe, D77), its attempts, and the
 * states of its PR and checks. Nothing is asked of a model, nothing invented.
 *
 * A ticket that met a blocker, a review asking for changes, failing checks or a
 * reopening is a timeline: explanation, review, fix, new explanation. One that
 * went through at once is a short explanation and its PR.
 */
export type StoryKind = 'start' | 'explain' | 'decision' | 'trap' | 'question' | 'blocker' | 'review' | 'fix' | 'commits' | 'done' | 'reopen';
export type StoryStep = { readonly at: string; readonly kind: StoryKind; readonly text: string };
export type TicketStory = {
  readonly shape: 'timeline' | 'straight' | 'empty';
  /** What was done, in the sheet's words when it has them. */
  readonly summary: string | null;
  readonly steps: readonly StoryStep[];
  readonly pr: string | null;
};

const ROUGH = new Set<StoryKind>(['trap', 'blocker', 'review', 'reopen']);

export function ticketStory(input: {
  readonly journal: readonly JournalEntry[];
  readonly attempts: readonly Attempt[];
  readonly states: readonly TicketState[];
  readonly summary?: string | null;
  readonly done?: string | null;
}): TicketStory {
  const steps: StoryStep[] = [];
  let commits: { at: string; texts: string[] } | null = null;
  const flush = () => { if (commits) steps.push({ at: commits.at, kind: 'commits', text: commits.texts.slice(0, 5).join(' · ') + (commits.texts.length > 5 ? ` (+${commits.texts.length - 5})` : '') }); commits = null; };
  for (const j of [...input.journal].sort((a, b) => a.at.localeCompare(b.at))) {
    if (j.kind === 'commit') { commits ??= { at: j.at, texts: [] }; commits.texts.push(j.text); continue; }
    const kind = ({ start: 'start', note: 'explain', decision: 'decision', trap: 'trap', question: 'question', done: 'done', reopen: 'reopen' } as const)[j.kind as 'start'];
    if (!kind) continue;
    flush();
    steps.push({ at: j.at, kind, text: j.text });
  }
  flush();
  for (const a of input.attempts) {
    steps.push({ at: a.at, kind: 'blocker', text: [a.approach, a.result].filter(Boolean).join(' : ') });
    if (a.next) steps.push({ at: a.at, kind: 'fix', text: a.next });
  }
  for (const s of input.states) {
    if (!s.at) continue;
    if (s.dimension === 'pr' && s.status === 'changes-requested') steps.push({ at: s.at, kind: 'review', text: s.detail });
    else if (s.dimension === 'pr' && (s.status === 'approved' || s.status === 'merged')) steps.push({ at: s.at, kind: 'fix', text: s.detail || s.status });
    else if (s.dimension === 'checks' && s.status === 'failed') steps.push({ at: s.at, kind: 'blocker', text: s.detail || 'CI' });
    else if (s.dimension === 'waiting' && s.status === 'blocked') steps.push({ at: s.at, kind: 'blocker', text: s.detail });
  }
  steps.sort((a, b) => a.at.localeCompare(b.at));
  const pr = input.states.find((s) => s.dimension === 'pr' && s.url)?.url ?? null;
  const summary = (input.done || input.summary || '').trim() || null;
  const meaningful = steps.filter((s) => s.kind !== 'start' && (s.text.trim() || s.kind === 'done'));
  const shape = steps.some((s) => ROUGH.has(s.kind)) ? 'timeline' : meaningful.length || summary ? 'straight' : 'empty';
  return { shape, summary, steps, pr };
}
