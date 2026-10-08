import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { sessionsSince } from '../focus/focus.js';
import { listInbox } from '../inbox/inbox.js';
import type { Bundle } from '../kb/bundle.js';
import { loadQueue } from '../suggest/suggest.js';
import { readLines } from '../util/fsx.js';
import { readReceipts } from '../weekly/weekly.js';
import { listTickets } from '../work/tickets.js';

/**
 * What happened, day by day, from what OKB already records: notes created or
 * changed (receipts), tickets started and finished with their commits and
 * decisions, sessions journaled, suggestions decided, captures, cards
 * reviewed. No AI: the daily stand-up and the weekly report are written from it.
 */

type NoteRef = { readonly path: string; readonly title: string };

export type JournalDay = {
  readonly date: string;
  readonly created: readonly NoteRef[];
  readonly updated: readonly NoteRef[];
  readonly ticketsStarted: readonly { readonly ref: string; readonly title: string }[];
  readonly ticketsDone: readonly { readonly ref: string; readonly title: string }[];
  readonly commits: readonly { readonly ref: string; readonly repo: string | null; readonly text: string }[];
  readonly decisions: readonly { readonly ref: string; readonly text: string }[];
  readonly sessions: readonly { readonly summary: string; readonly next: string | null }[];
  readonly suggestions: { readonly accepted: number; readonly declined: number };
  readonly captures: number;
  readonly reviews: number;
};

export type Journal = { readonly from: string; readonly to: string; readonly days: readonly JournalDay[]; readonly totals: { readonly created: number; readonly updated: number; readonly ticketsDone: number; readonly commits: number; readonly sessions: number; readonly accepted: number; readonly reviews: number } };

const day = (iso: string) => iso.slice(0, 10);

export async function journal(config: OkbConfig, bundle: Bundle, options: { days?: number; now?: Date } = {}): Promise<Journal> {
  const now = options.now ?? new Date();
  const span = Math.max(1, Math.min(366, options.days ?? 7));
  const from = new Date(now.getTime() - (span - 1) * 86_400_000);
  const fromDay = day(from.toISOString());
  const toDay = day(now.toISOString());
  const inRange = (iso: string | null | undefined) => Boolean(iso) && day(iso!) >= fromDay && day(iso!) <= toDay;
  const titles = new Map(bundle.entries.map((e) => [e.path as string, e.title]));
  const ref = (path: string): NoteRef => ({ path, title: titles.get(path) ?? path.split('/').pop()!.replace(/\.md$/, '') });

  const days = new Map<string, {
    created: Map<string, NoteRef>; updated: Map<string, NoteRef>; ticketsStarted: { ref: string; title: string }[]; ticketsDone: { ref: string; title: string }[];
    commits: { ref: string; repo: string | null; text: string }[]; decisions: { ref: string; text: string }[]; sessions: { summary: string; next: string | null }[];
    accepted: number; declined: number; captures: number; reviews: number;
  }>();
  const at = (iso: string) => {
    const d = day(iso);
    if (!days.has(d)) days.set(d, { created: new Map(), updated: new Map(), ticketsStarted: [], ticketsDone: [], commits: [], decisions: [], sessions: [], accepted: 0, declined: 0, captures: 0, reviews: 0 });
    return days.get(d)!;
  };

  for (const r of await readReceipts(config)) {
    if (!inRange(r.appliedAt)) continue;
    const d = at(r.appliedAt);
    for (const res of r.results) {
      if (res.action === 'created') d.created.set(res.path, ref(res.path));
      else if (res.action === 'updated' && !d.created.has(res.path)) d.updated.set(res.path, ref(res.path));
    }
  }
  for (const tk of await listTickets(config).catch(() => [])) {
    if (inRange(tk.startedAt)) at(tk.startedAt).ticketsStarted.push({ ref: tk.ref, title: tk.title });
    if (tk.doneAt && inRange(tk.doneAt)) at(tk.doneAt).ticketsDone.push({ ref: tk.ref, title: tk.title });
    for (const j of tk.journal) {
      if (!inRange(j.at)) continue;
      if (j.kind === 'commit') at(j.at).commits.push({ ref: tk.ref, repo: j.repo ?? null, text: j.text });
      if (j.kind === 'decision') at(j.at).decisions.push({ ref: tk.ref, text: j.text });
    }
  }
  for (const s of await sessionsSince(config, new Date(`${fromDay}T00:00:00Z`)).catch(() => [])) {
    if (inRange(s.at)) at(s.at).sessions.push({ summary: s.summary, next: s.next });
  }
  for (const s of await loadQueue(config).catch(() => [])) {
    if (!s.decidedAt || !inRange(s.decidedAt)) continue;
    if (s.status === 'accepted' || s.status === 'done') at(s.decidedAt).accepted++;
    if (s.status === 'declined') at(s.decidedAt).declined++;
  }
  for (const item of await listInbox(config, { now }).catch(() => [])) if (inRange(item.capturedAt)) at(item.capturedAt).captures++;
  for (const line of await readLines(resolve(config.stateHome, 'learn', 'log.jsonl')).catch(() => [] as string[])) {
    try { const l = JSON.parse(line) as { at?: string }; if (l.at && inRange(l.at)) at(l.at).reviews++; } catch { /* a torn line */ }
  }

  const out: JournalDay[] = [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, d]) => ({
    date, created: [...d.created.values()], updated: [...d.updated.values()], ticketsStarted: d.ticketsStarted, ticketsDone: d.ticketsDone,
    commits: d.commits.slice(-30), decisions: d.decisions, sessions: d.sessions, suggestions: { accepted: d.accepted, declined: d.declined }, captures: d.captures, reviews: d.reviews,
  }));
  const sum = (f: (d: JournalDay) => number) => out.reduce((n, d) => n + f(d), 0);
  return {
    from: fromDay, to: toDay, days: out,
    totals: {
      created: sum((d) => d.created.length), updated: sum((d) => d.updated.length), ticketsDone: sum((d) => d.ticketsDone.length),
      commits: sum((d) => d.commits.length), sessions: sum((d) => d.sessions.length), accepted: sum((d) => d.suggestions.accepted), reviews: sum((d) => d.reviews),
    },
  };
}
