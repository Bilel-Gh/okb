import { dirname, posix } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { isSecret } from '../security/confidential.js';
import { understandingOverview } from '../understanding/state.js';
import { dueCards } from './learn.js';

/**
 * Formations (chantier 5): a learning path an agent prepares when the person
 * wants to grow on a subject, kept as an ordinary note so it goes through the
 * usual proposal and review. A formation is a note of type `Formation` (or in
 * a `formations/` folder) whose links, in order, are its steps. Its optional
 * frontmatter says the goal (`goal: revision | certification | skill`) and the
 * date to be ready by (`by: 2026-12-15`).
 *
 * OKB reads it and adds what it already knows: how far the person went on
 * each step (the understanding levels, never decided for them) and the
 * revision cards of those notes, due or not, on their existing FSRS schedule.
 */
export type FormationStep = { readonly path: string; readonly title: string; readonly level: string | null; readonly cards: number; readonly due: number; readonly done: boolean };
export type Formation = {
  readonly path: string; readonly title: string; readonly description: string;
  readonly goal: 'revision' | 'certification' | 'skill';
  readonly by: string | null; readonly daysLeft: number | null;
  readonly steps: readonly FormationStep[]; readonly percent: number;
  readonly next: FormationStep | null; readonly due: number;
};

const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
const DONE = new Set(['explained', 'reused']);

export function isFormation(entry: { readonly type: string; readonly path: string }): boolean {
  return /^(formation|course|cours|parcours|learning[- ]?path)$/i.test(entry.type) || /(^|\/)formations\//i.test(entry.path);
}

/** The notes a formation links to, in the order it gives them. */
export function stepsOf(body: string, from: string, bundle: Bundle): string[] {
  const byTitle = new Map(bundle.entries.map((e) => [e.title.toLowerCase(), e.path as string]));
  const byName = new Map(bundle.entries.map((e) => [posix.basename(e.path, '.md').toLowerCase(), e.path as string]));
  const out: string[] = [];
  for (const m of body.matchAll(LINK)) {
    let path: string | undefined;
    if (m[1]) { const k = m[1].trim().toLowerCase(); path = bundle.byPath.has(`${m[1].trim()}.md` as never) ? `${m[1].trim()}.md` : byName.get(posix.basename(k)) ?? byTitle.get(k); }
    else if (m[2]) { const p = posix.normalize(posix.join(dirname(from), decodeURIComponent(m[2]))); path = bundle.byPath.has(p as never) ? p : undefined; }
    if (path && path !== from && !out.includes(path)) out.push(path);
  }
  return out;
}

export async function listFormations(config: OkbConfig, bundle: Bundle, now = new Date()): Promise<Formation[]> {
  const entries = bundle.entries.filter((e) => !e.reserved && !isSecret(e.ext) && isFormation(e));
  if (!entries.length) return [];
  const levels = new Map((await understandingOverview(config, now)).subjects.map((s) => [s.path, s.level]));
  const out: Formation[] = [];
  for (const e of entries) {
    const doc = bundle.docs.get(e.path);
    const data = (doc?.data ?? {}) as Record<string, unknown>;
    const paths = stepsOf(doc?.body ?? '', e.path, bundle);
    const steps: FormationStep[] = [];
    for (const path of paths) {
      const target = bundle.byPath.get(path as never);
      if (!target || isSecret(target.ext)) continue;
      const cards = await dueCards(config, bundle, { now, note: path, newPerDay: 1000, limit: 1000 }).catch(() => null);
      const level = levels.get(path) ?? null;
      steps.push({ path, title: target.title, level, cards: cards?.counts.cards ?? 0, due: cards?.counts.due ?? 0, done: level !== null && DONE.has(level) });
    }
    const goalRaw = String(data.goal ?? '').toLowerCase();
    const goal = /certif/.test(goalRaw) ? 'certification' : /revis|révis|exam/.test(goalRaw) ? 'revision' : 'skill';
    const by = typeof data.by === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data.by) ? data.by.slice(0, 10) : data.by instanceof Date ? data.by.toISOString().slice(0, 10) : null;
    const daysLeft = by ? Math.ceil((Date.parse(`${by}T23:59:59Z`) - now.getTime()) / 86_400_000) : null;
    const done = steps.filter((s) => s.done).length;
    out.push({
      path: e.path, title: e.title, description: e.description, goal, by, daysLeft, steps,
      percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
      next: steps.find((s) => !s.done) ?? null, due: steps.reduce((n, s) => n + s.due, 0),
    });
  }
  // The closest deadline first, then the ones under way.
  return out.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.percent - a.percent || a.title.localeCompare(b.title));
}
