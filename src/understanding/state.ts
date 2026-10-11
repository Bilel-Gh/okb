import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle, type KbEntry } from '../kb/bundle.js';
import { buildGraph } from '../kb/graph.js';
import { levelOf as xpLevel, xpOf, type Activity } from '../progress/progress.js';
import { getProject } from '../projects/projects.js';
import { isSecret } from '../security/confidential.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { statePaths } from '../state/paths.js';
import { readLines } from '../util/fsx.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath } from '../util/paths.js';
import { resolve } from 'node:path';

/** F2.2-05: these are observed or declared acts, not an expertise score. */
export const UNDERSTANDING_LEVELS = ['encountered', 'consulted', 'practiced', 'explained', 'reused'] as const;
export type UnderstandingLevel = (typeof UNDERSTANDING_LEVELS)[number];
export const UNDERSTANDING_KINDS = [...UNDERSTANDING_LEVELS, 'unclear', 'resolved'] as const;
export type UnderstandingKind = (typeof UNDERSTANDING_KINDS)[number];
export type UnderstandingEvent = { id: string; path: string; subject: string; kind: UnderstandingKind; point: string; projectId: string | null; at: string };
export type UnderstandingInput = { path: string; kind: UnderstandingKind; point?: string; projectId?: string; eventId: string };
export type SubjectLevel = { path: string; subject: string; level: UnderstandingLevel | null; events: number; lastAt: string | null; evidence: UnderstandingEvent[] };
export type UnderstandingDebt = { id: string; path: string; subject: string; point: string; reason: 'unclear' | 'repeated'; encounters: number; since: string; minutes: 5 };
export const UNDERSTANDING_LIMITS = [
  'Les niveaux décrivent des gestes enregistrés ou déclarés ; ils ne certifient pas une compétence.',
  'Une citation exacte permet de retrouver le texte ; elle ne prouve pas que la note dit vrai.',
];

/** Same exclusion before reading, returning cached content, recording or proposing. */
export function understandingNote(bundle: Bundle, path: string): KbEntry {
  const p = asBundlePath(path);
  const e = bundle.byPath.get(p);
  if (!e || !bundle.docs.has(p) || e.reserved) throw new OkbError('E_NOT_FOUND', 'No readable note at this path.');
  if (isSecret(e.ext)) throw new OkbError('E_SECRET', 'A protected note is excluded from understanding tools.');
  return e;
}

export function savedUnderstandingEvents(config: OkbConfig): UnderstandingEvent[] {
  return openDb(config).all<UnderstandingEvent>('SELECT id,path,subject,kind,point,project_id AS projectId,at FROM understanding_events ORDER BY at,rowid');
}

function levelFor(events: readonly UnderstandingEvent[]): UnderstandingLevel | null {
  let level: UnderstandingLevel | null = null;
  for (const e of events) {
    if (!UNDERSTANDING_LEVELS.includes(e.kind as UnderstandingLevel)) continue;
    const k = e.kind as UnderstandingLevel;
    if (level === null || UNDERSTANDING_LEVELS.indexOf(k) > UNDERSTANDING_LEVELS.indexOf(level)) level = k;
  }
  return level;
}

/** Search hits mean encountered; actual opens mean consulted. Neither advances higher levels. */
async function visibleEvents(config: OkbConfig, bundle: Bundle): Promise<UnderstandingEvent[]> {
  const valid = new Set(bundle.entries.filter((e) => !e.reserved && !isSecret(e.ext)).map((e) => String(e.path)));
  const events = savedUnderstandingEvents(config).filter((e) => valid.has(e.path));
  const raw = await readLines(resolve(statePaths(config).root, 'usage', 'notes.jsonl'));
  const seen = new Set<string>();
  for (const line of raw) {
    let v: { path?: string; at?: string; kind?: string };
    try { v = JSON.parse(line) as typeof v; } catch { continue; }
    if (!v.path || !v.at || !valid.has(v.path) || !Number.isFinite(Date.parse(v.at)) || !['open', 'search', 'cited'].includes(v.kind ?? '')) continue;
    const kind: UnderstandingLevel = v.kind === 'open' ? 'consulted' : 'encountered';
    // Keystrokes and repeat opens in one day must not manufacture repeated exposure.
    const key = `${v.path}|${kind}|${v.at.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ id: `usage:${key}`, path: v.path, subject: bundle.byPath.get(asBundlePath(v.path))!.title, kind, point: '', projectId: null, at: v.at });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function debtsOf(events: readonly UnderstandingEvent[]): UnderstandingDebt[] {
  const byPath = new Map<string, UnderstandingEvent[]>();
  for (const e of events) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  const debts: UnderstandingDebt[] = [];
  for (const [path, es] of byPath) {
    const encounters = es.filter((e) => e.kind === 'encountered' || e.kind === 'consulted').length;
    const unclear = new Map<string, UnderstandingEvent>();
    for (const e of es) {
      if (e.kind === 'unclear') unclear.set(e.point, e);
      if (e.kind === 'resolved') unclear.delete(e.point);
    }
    for (const [point, e] of unclear) debts.push({ id: e.id, path, subject: e.subject, point, reason: 'unclear', encounters, since: e.at, minutes: 5 });
    const demonstrated = es.some((e) => e.kind === 'explained' || e.kind === 'reused' || e.kind === 'resolved');
    if (encounters >= 3 && !demonstrated && !unclear.size) {
      const e = es[0]!;
      debts.push({ id: `repeated:${path}`, path, subject: e.subject, point: '', reason: 'repeated', encounters, since: e.at, minutes: 5 });
    }
  }
  return debts.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'unclear' ? -1 : 1) || b.encounters - a.encounters || a.since.localeCompare(b.since));
}

/** Person-only operation: a stable event id makes double clicks/retries harmless. */
export async function recordUnderstanding(config: OkbConfig, input: UnderstandingInput, now = new Date()): Promise<UnderstandingEvent> {
  if (!UNDERSTANDING_KINDS.includes(input.kind) || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,149}$/.test(input.eventId)) throw new OkbError('E_INVALID', 'Invalid understanding event.');
  const bundle = await loadBundleFor(config);
  const entry = understandingNote(bundle, input.path);
  const point = (input.point ?? '').trim();
  if (point.length > 4000 || (['practiced', 'explained', 'reused', 'unclear'].includes(input.kind) && !point)) throw new OkbError('E_INVALID', 'Describe the act or the point that remains unclear.');
  assertNoSecrets({ point }, 'understanding event');
  if (input.projectId) getProject(config, input.projectId);
  const event: UnderstandingEvent = { id: input.eventId, path: entry.path, subject: entry.title, kind: input.kind, point, projectId: input.projectId ?? null, at: now.toISOString() };
  const db = openDb(config);
  const inherited = input.kind === 'resolved' ? (await visibleEvents(config, bundle)).filter((e) => e.id.startsWith('usage:')) : [];
  return db.tx(() => {
    const old = db.get<UnderstandingEvent>('SELECT id,path,subject,kind,point,project_id AS projectId,at FROM understanding_events WHERE id=?', event.id);
    if (old) {
      if (old.path !== event.path || old.kind !== event.kind || old.point !== event.point || old.projectId !== event.projectId) throw new OkbError('E_CONFLICT', 'This event id already describes a different act.');
      return old;
    }
    if (input.kind === 'resolved') {
      const debt = debtsOf([...inherited, ...savedUnderstandingEvents(config)].sort((a, b) => a.at.localeCompare(b.at))).find((d) => d.path === event.path && d.point === point);
      if (!debt) throw new OkbError('E_INVALID', 'Only an outstanding understanding debt can be marked resolved.');
    }
    db.run('INSERT INTO understanding_events(id,path,subject,kind,point,project_id,at) VALUES(?,?,?,?,?,?,?)', event.id, event.path, event.subject, event.kind, event.point, event.projectId, event.at);
    return event;
  });
}

export function setUnderstandingProgress(config: OkbConfig, enabled: boolean): void {
  openDb(config).run("INSERT INTO meta(key,value) VALUES('understanding.progress.enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", enabled ? '1' : '0');
}

function privateProgress(config: OkbConfig, events: readonly UnderstandingEvent[], now: Date) {
  const enabled = openDb(config).get<{ value: string }>("SELECT value FROM meta WHERE key='understanding.progress.enabled'")?.value === '1';
  const unique = new Map<string, UnderstandingEvent>();
  for (const e of events) if (['resolved', 'explained', 'reused'].includes(e.kind)) {
    // The same explanation or use is not rewarded again by replaying it later.
    const key = `${e.kind}|${e.path}|${e.point}`;
    if (!unique.has(key)) unique.set(key, e);
  }
  const acts: Activity[] = enabled ? [...unique.values()].map((e) => ({ kind: e.kind === 'resolved' ? 'review' : 'write', at: e.at, key: `${e.kind}:${e.path}:${e.point}` })) : [];
  const counts = { resolved: 0, explained: 0, reused: 0 };
  if (enabled) for (const e of unique.values()) counts[e.kind as keyof typeof counts]++;
  const xp = xpOf(acts, now);
  const badges = Object.entries(counts).map(([id, count]) => ({ id, count, tier: count >= 25 ? 'gold' : count >= 5 ? 'silver' : count >= 1 ? 'bronze' : 'none', next: count >= 25 ? null : count >= 5 ? 25 : count >= 1 ? 5 : 1 }));
  return { enabled, private: true as const, xp: xp.total, level: xpLevel(xp.total), counts, badges };
}

export async function understandingOverview(config: OkbConfig, now = new Date()) {
  const bundle = await loadBundleFor(config);
  const events = await visibleEvents(config, bundle);
  const byPath = new Map<string, UnderstandingEvent[]>();
  for (const e of events) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  const subjects: SubjectLevel[] = bundle.entries.filter((e) => !e.reserved && !isSecret(e.ext)).map((e) => {
    const es = byPath.get(e.path) ?? [];
    return { path: e.path, subject: e.title, level: levelFor(es), events: es.length, lastAt: es.at(-1)?.at ?? null, evidence: es.slice(-10) };
  });
  const debts = debtsOf(events);
  const visible = new Set(subjects.map((s) => s.path));
  const graph = { nodes: subjects.map((s) => ({ id: s.path, title: s.subject, level: s.level })), edges: buildGraph(bundle, []).edges.filter((e) => visible.has(e.source) && visible.has(e.target)) };
  return { subjects, graph, debts, today: debts[0] ?? null, progress: privateProgress(config, events, now), limitations: UNDERSTANDING_LIMITS };
}

export async function understandingLevel(config: OkbConfig, path: string, bundle?: Bundle): Promise<UnderstandingLevel | null> {
  const b = bundle ?? await loadBundleFor(config);
  understandingNote(b, path);
  return levelFor((await visibleEvents(config, b)).filter((e) => e.path === path));
}
