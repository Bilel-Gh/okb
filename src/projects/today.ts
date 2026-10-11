import { isConceptEntry } from '../concepts/one-liner.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { dueCount } from '../learn/learn.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import { scoresFor } from '../scores/cached.js';
import { localDay, shiftDay, startOfDay } from '../util/day.js';
import { readReceipts } from '../weekly/weekly.js';
import { listActions, type Action } from './actions.js';
import { listEntries, type Entry } from './journal.js';
import { listProjects, type Project } from './projects.js';
import { backupStatus } from '../brain/backup.js';
import { eveningView } from '../evening/evening.js';
import { moduleNotesToRecheck, type NoteToRecheck } from './sources.js';

/**
 * Today (F2.0-04) answers six questions: what do I pick up, what did I do,
 * what do I wait for, what did I learn, what is to review, what is there to
 * understand. Read from the projects, the actions, the journal, the receipts
 * and the review cards; nothing is computed by an AI.
 */
export type TodayAction = Action & { readonly late: boolean; readonly project: { readonly id: string; readonly title: string } | null };
export type TodayView = {
  readonly day: string;
  /** The projects to pick up: those the person left last, with where they were. */
  readonly resume: readonly Project[];
  readonly todo: readonly TodayAction[];
  readonly waiting: readonly TodayAction[];
  /** What happened today and yesterday. */
  readonly done: readonly Entry[];
  /** The notes that entered the memory in the last seven days. */
  readonly learned: readonly { readonly path: string; readonly title: string; readonly at: string }[];
  readonly review: { readonly due: number };
  /** Where the daily backup stands, for a line the person sees every day. */
  readonly backup: { readonly state: 'ok' | 'late' | 'never' | 'off'; readonly date: string | null };
  /** What an assistant prepared and waits for the person's yes: notes to write, changes ready (the evening screen). */
  readonly toValidate: number;
  /** Cited code changed; notes need rechecking, not an automatic rewrite. */
  readonly notesToRecheck: readonly NoteToRecheck[];
  readonly recheckUnavailable: readonly string[];
  /** One thing to understand: a concept the notes use and the person never opened. */
  readonly understand: { readonly path: string; readonly title: string; readonly usedBy: number } | null;
};

const DAY = 86_400_000;

function unreadConcept(bundle: Bundle, used: (path: string) => number): TodayView['understand'] {
  const incoming = new Map<string, number>();
  for (const [path, doc] of bundle.docs) {
    for (const link of extractLinks(doc.body)) {
      const target = resolveInternal(path, link.url);
      if (target && target !== path) incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  const best = bundle.entries
    .filter((e) => !e.reserved && isConceptEntry(e) && used(e.path) === 0 && (incoming.get(e.path) ?? 0) > 0)
    .sort((a, b) => (incoming.get(b.path) ?? 0) - (incoming.get(a.path) ?? 0) || a.path.localeCompare(b.path))[0];
  return best ? { path: best.path, title: best.title, usedBy: incoming.get(best.path) ?? 0 } : null;
}

export async function todayView(config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle, now = new Date()): Promise<TodayView> {
  const day = localDay(now);
  const projects = await listProjects(config, env);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const open = await listActions(config, env);
  const shape = (a: Action): TodayAction => {
    const p = a.projectId ? byId.get(a.projectId) : undefined;
    return { ...a, late: Boolean(a.due && a.due < day), project: p ? { id: p.id, title: p.title } : null };
  };
  // What was left last comes first; then the projects touched last.
  const resume = [...projects.filter((p) => p.status === 'active')]
    .sort((a, b) => (b.leftOff?.at ?? '').localeCompare(a.leftOff?.at ?? '') || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const entries = await listEntries(config, env, { since: startOfDay(shiftDay(now, -1)), limit: 60 });
  const receipts = await readReceipts(config).catch(() => []);
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const learned = new Map<string, { path: string; title: string; at: string }>();
  for (const r of receipts.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))) {
    if (r.appliedAt < weekAgo) continue;
    for (const res of r.results) {
      const entry = res.action === 'created' ? bundle.byPath.get(res.path) : undefined;
      if (entry && !entry.reserved && !learned.has(res.path)) learned.set(res.path, { path: res.path, title: entry.title, at: r.appliedAt });
    }
  }
  const scores = await scoresFor(config, bundle);
  const recheck = await moduleNotesToRecheck(config, env, bundle);
  return {
    day,
    resume,
    todo: open.filter((a) => a.kind === 'todo' || a.kind === 'asked').slice(0, 12).map(shape),
    waiting: open.filter((a) => a.kind === 'waiting').slice(0, 12).map(shape),
    done: entries.filter((e) => e.kind !== 'resume').slice(0, 12),
    learned: [...learned.values()].slice(0, 8),
    review: { due: await dueCount(config, now).catch(() => 0) },
    backup: await backupStatus(config, env, now).then((b) => ({ state: b.state, date: b.last?.date ?? null }), () => ({ state: 'never' as const, date: null })),
    toValidate: await eveningView(config, env, now).then((e) => e.cards.length + e.changes.length + e.apart.length, () => 0),
    understand: unreadConcept(bundle, (path) => scores.get(path)?.parts.value.used ?? 0),
    notesToRecheck: recheck.notes,
    recheckUnavailable: recheck.unavailable,
  };
}
