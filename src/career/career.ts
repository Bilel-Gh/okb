import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { noteKind } from '../brain/types.js';
import type { Bundle } from '../kb/bundle.js';
import { OkbError } from '../util/errors.js';
import { modulePrivateNames, moduleRawEvents, moduleWork } from '../projects/sources.js';

/**
 * The career side of a brain: achievements told as STAR stories, feedback
 * received, goals, one-on-ones and annual reviews, the development plan. OKB
 * reads them to show where the person stands, to gather the material of a
 * one-on-one or an annual review, and to check that nothing of the employer
 * leaks before the person takes a portable copy with them. Nothing is written
 * in the KB here.
 */

const CAREER_KINDS = ['achievements', 'story', 'goals', 'feedback', 'one-on-one', 'annual-review', 'development-plan', 'career-grid', 'cv', 'career-hub'] as const;
type Entry = Bundle['entries'][number];

export type Achievement = {
  readonly date: string | null;
  readonly title: string;
  readonly path: string;
  /** STAR parts present (situation, task, action, result). */
  readonly star: readonly ('situation' | 'task' | 'action' | 'result')[];
  readonly skills: readonly string[];
  readonly hasProof: boolean;
};

const STAR: Record<'situation' | 'task' | 'action' | 'result', RegExp> = {
  situation: /\*\*(Situation)\*\*/i, task: /\*\*(T[âa]che|Task)\*\*/i, action: /\*\*(Action)\*\*/i, result: /\*\*(R[ée]sultat|Result)\*\*/i,
};

/**
 * The STAR entries of a note: one dated heading each (`### 2026-10-06 — …`, or
 * the `# 2026-10-06 — …` an appended section gets); a story note is one entry.
 */
export function achievementsIn(path: string, title: string, body: string, single: boolean): Achievement[] {
  const parts = single ? [{ head: title, text: body }] : body.split(/^#{1,3} (?=\d{4}-\d{2})/m).slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    return { head: (nl < 0 ? chunk : chunk.slice(0, nl)).trim(), text: nl < 0 ? '' : chunk.slice(nl + 1) };
  });
  return parts.map(({ head, text }) => {
    const m = /^(\d{4}-\d{2}(?:-\d{2})?)\s*[—–-]\s*(.+)$/.exec(head);
    const skills = /\*\*(Comp[ée]tences|Skills)\*\*\s*[:：]\s*(.+)/i.exec(text)?.[2]?.split(/[,;·]/).map((s) => s.trim().replace(/\.$/, '')).filter(Boolean) ?? [];
    return {
      date: m?.[1] ?? null, title: m?.[2]?.trim() ?? head, path,
      star: (Object.keys(STAR) as (keyof typeof STAR)[]).filter((k) => STAR[k].test(text)),
      skills, hasProof: /\*\*(Preuves?|Proof|Evidence)\*\*/i.test(text) && /\]\(/.test(text),
    };
  });
}

export type CareerStatus = {
  readonly notes: readonly { readonly path: string; readonly title: string; readonly type: string }[];
  readonly achievements: readonly Achievement[];
  readonly feedback: { readonly count: number; readonly last: string | null };
  readonly goals: { readonly open: number; readonly done: number };
  readonly lastOneOnOne: string | null;
  readonly skills: readonly { readonly skill: string; readonly stories: number }[];
  /** What would make the career side more useful now, most useful first. */
  readonly hints: readonly { readonly key: string; readonly detail: string }[];
};

const dateOf = (e: Entry) => /^(\d{4}-\d{2}-\d{2})/.exec(posix.basename(e.path))?.[1] ?? null;

export function careerStatus(bundle: Bundle, now = new Date()): CareerStatus {
  const notes = bundle.entries.filter((e) => !e.reserved && (CAREER_KINDS as readonly string[]).includes(noteKind(e) ?? ''));
  const achievements: Achievement[] = [];
  let feedbackCount = 0; let feedbackLast: string | null = null; let lastOneOnOne: string | null = null;
  let open = 0; let done = 0;
  for (const e of notes) {
    const kind = noteKind(e);
    const body = bundle.docs.get(e.path)?.body ?? '';
    if (kind === 'achievements' || kind === 'story') achievements.push(...achievementsIn(e.path, e.title, body, kind === 'story'));
    if (kind === 'feedback') { feedbackCount++; const d = dateOf(e); if (d && (!feedbackLast || d > feedbackLast)) feedbackLast = d; }
    if (kind === 'one-on-one') { const d = dateOf(e); if (d && (!lastOneOnOne || d > lastOneOnOne)) lastOneOnOne = d; }
    if (kind === 'goals') { open += (body.match(/^\s*[-*] \[ \]/gm) ?? []).length; done += (body.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length; }
  }
  achievements.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const skillCount = new Map<string, number>();
  for (const a of achievements) for (const s of a.skills) skillCount.set(s, (skillCount.get(s) ?? 0) + 1);
  const hints: { key: string; detail: string }[] = [];
  const days = (d: string | null) => (d ? Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000) : Infinity);
  const lastAchievement = achievements.find((a) => a.date)?.date ?? null;
  if (!lastAchievement) hints.push({ key: 'noAchievement', detail: '' });
  else if (days(lastAchievement) > 30) hints.push({ key: 'noRecentAchievement', detail: lastAchievement });
  const partial = achievements.filter((a) => a.star.length < 4 || !a.hasProof);
  if (partial.length) hints.push({ key: 'incompleteStar', detail: partial.slice(0, 3).map((a) => a.title).join(' · ') });
  if (!notes.some((e) => noteKind(e) === 'goals')) hints.push({ key: 'noGoals', detail: '' });
  if (!lastOneOnOne) hints.push({ key: 'noOneOnOne', detail: '' });
  else if (days(lastOneOnOne) > 45) hints.push({ key: 'oneOnOneDue', detail: lastOneOnOne });
  return {
    notes: notes.map((e) => ({ path: e.path, title: e.title, type: noteKind(e) ?? '' })),
    achievements, feedback: { count: feedbackCount, last: feedbackLast }, goals: { open, done }, lastOneOnOne,
    skills: [...skillCount.entries()].map(([skill, stories]) => ({ skill, stories })).sort((a, b) => b.stories - a.stories || a.skill.localeCompare(b.skill)),
    hints,
  };
}

/** The material of a one-on-one or an annual review: what happened since a date. */
export async function careerPrep(config: OkbConfig, bundle: Bundle, since: string, now = new Date()) {
  const status = careerStatus(bundle, now);
  const after = (d: string | null) => d !== null && d >= since;
  // The work finished since then, as the modules know it (the developer module's tickets), with the decisions taken.
  const events = await moduleRawEvents(config).catch(() => []);
  const tickets = (await moduleWork(config).catch(() => [])).filter((t) => t.kind === 'ticket' && t.status === 'done' && after(t.doneAt?.slice(0, 10) ?? null))
    .map((t) => ({ ref: t.ref, title: t.title, doneAt: t.doneAt, decisions: events.filter((e) => e.kind === 'ticket' && e.ref === t.ref && e.entry === 'decision').map((e) => e.text).slice(-5) }));
  const feedback = bundle.entries.filter((e) => noteKind(e) === 'feedback' && after(dateOf(e))).map((e) => ({ path: e.path, title: e.title, date: dateOf(e) }));
  const reviews = bundle.entries.filter((e) => (noteKind(e) === 'one-on-one' || noteKind(e) === 'annual-review')).map((e) => ({ path: e.path, title: e.title, date: dateOf(e), type: noteKind(e) }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const goals = bundle.entries.filter((e) => noteKind(e) === 'goals').map((e) => ({ path: e.path, title: e.title }));
  return {
    since, achievements: status.achievements.filter((a) => after(a.date)), tickets, feedback, goals,
    previous: reviews[0] ?? null, skills: status.skills,
  };
}

/* ------------------------------------------------ the portable check */

export type Leak = { readonly path: string; readonly line: number; readonly text: string; readonly kind: 'product' | 'client' | 'repository' | 'ticket' | 'email' | 'url' | 'amount' | 'custom' };

const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const URL = /\bhttps?:\/\/[^\s)>\]]+/g;
const AMOUNT = /(?:\b\d[\d\s.,]*\s?(?:k€|M€|€|EUR|USD|\$)|[$€]\s?\d[\d\s.,]*)/g;
const PUBLIC_HOSTS = /^(https?:\/\/)?([\w-]+\.)*(wikipedia\.org|github\.com|developer\.mozilla\.org|nodejs\.org|claude\.com|anthropic\.com|npmjs\.com|w3\.org)\b/i;

/**
 * What would leak if the career notes left the company: product, client and
 * repository names, ticket references, emails, internal links, amounts, and the
 * person's own list of words. Run on the career notes before a portable copy.
 */
export async function careerLeaks(config: OkbConfig, bundle: Bundle, extraWords: readonly string[] = []): Promise<Leak[]> {
  const names: { re: RegExp; kind: Leak['kind'] }[] = [];
  const word = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu');
  const { listProducts } = await import('../brain/products.js');
  for (const p of await listProducts(config).catch(() => [])) if (p.name.length > 2) names.push({ re: word(p.name), kind: 'product' });
  for (const r of await modulePrivateNames().catch(() => [])) if (r.name.length > 2 && r.kind === 'repository') names.push({ re: word(r.name), kind: 'repository' });
  for (const e of bundle.entries) if (noteKind(e) === 'client' && e.title.length > 2) names.push({ re: word(e.title), kind: 'client' });
  for (const w of extraWords) if (w.trim().length > 1) names.push({ re: word(w.trim()), kind: 'custom' });
  const out: Leak[] = [];
  for (const e of bundle.entries) {
    if (!(CAREER_KINDS as readonly string[]).includes(noteKind(e) ?? '')) continue;
    const doc = bundle.docs.get(e.path);
    if (!doc) continue;
    doc.body.split('\n').forEach((line, i) => {
      if (line.startsWith('🧭')) return;
      const plain = line.replace(/\]\([^)]*\)/g, ']');
      const push = (text: string, kind: Leak['kind']) => out.push({ path: e.path, line: i + 1, text: text.trim(), kind });
      for (const n of names) { const m = n.re.exec(plain); if (m) push(m[0].replace(/^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/gu, ''), n.kind); }
      for (const m of plain.matchAll(TICKET)) push(m[0], 'ticket');
      for (const m of plain.matchAll(EMAIL)) push(m[0], 'email');
      for (const m of line.matchAll(URL)) if (!PUBLIC_HOSTS.test(m[0])) push(m[0], 'url');
      for (const m of plain.matchAll(AMOUNT)) if (/\d/.test(m[0])) push(m[0], 'amount');
    });
  }
  return out;
}

/** Copy the career notes into a new folder, only when nothing leaks any more. */
export async function exportCareer(config: OkbConfig, bundle: Bundle, target: string, extraWords: readonly string[] = []): Promise<{ written: string[] }> {
  const leaks = await careerLeaks(config, bundle, extraWords);
  if (leaks.length) throw new OkbError('E_SECRET', `${leaks.length} mention(s) would leave with the copy`, { key: 'careerLeaks', params: { count: String(leaks.length) }, detail: { leaks: leaks.slice(0, 50) } });
  const existing = await readdir(target).catch(() => null);
  if (existing && existing.length) throw new OkbError('E_INVALID', `${target} is not empty`, { key: 'careerTargetNotEmpty', params: { path: target } });
  const written: string[] = [];
  for (const e of bundle.entries) {
    if (!(CAREER_KINDS as readonly string[]).includes(noteKind(e) ?? '')) continue;
    const doc = bundle.docs.get(e.path);
    if (!doc) continue;
    // Links to work notes stay behind: the copy keeps their text, not a path that would break.
    const raw = doc.raw.split('\n').filter((l) => !l.startsWith('🧭')).join('\n').replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1');
    const file = resolve(target, posix.basename(e.path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, raw, { flag: 'wx' });
    written.push(posix.basename(e.path));
  }
  return { written };
}
