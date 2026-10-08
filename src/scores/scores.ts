import { isConceptEntry, oneLiner } from '../concepts/one-liner.js';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle, KbEntry } from '../kb/bundle.js';
import { normalizeSurface } from '../kb/search.js';
import { checkLinks } from '../links/check.js';
import { resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import { statePaths } from '../state/paths.js';
import { getTemplate } from '../templates/registry.js';
import { appendLine, readLines } from '../util/fsx.js';
import type { BundlePath } from '../util/paths.js';

/**
 * A note's score, without any AI call: its quality (as written) and its value
 * (what it brings, over time), each out of 100, and a global score shown as
 * stars and a percentage (60 % quality, 40 % value). The same grid serves the
 * template tests (src/templates/evals): what is measured in tests is measured
 * in real life.
 */
export type QualityParts = { readonly structure: number; readonly sources: number; readonly clarity: number; readonly links: number; readonly justness: number };
export type ValueParts = { readonly used: number; readonly fresh: number; readonly unique: number; readonly opinion: number };
export type NoteScore = {
  readonly path: BundlePath;
  readonly title: string;
  readonly quality: number;
  readonly value: number;
  readonly global: number;
  readonly stars: number;
  readonly parts: { readonly quality: QualityParts; readonly value: ValueParts };
  /** A note younger than 30 days: its value is still being built. */
  readonly young: boolean;
  readonly notes: readonly string[];
};

export type NoteEventKind = 'open' | 'search' | 'cited' | 'ticket' | 'up' | 'down';
type NoteEvent = { at: string; path: string; kind: NoteEventKind };

function eventsFile(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'usage', 'notes.jsonl');
}

/** Something happened to a note: read, found, cited by Claude, used in a ticket, rated. */
export async function noteEvent(config: OkbConfig, path: string, kind: NoteEventKind): Promise<void> {
  if (process.env.OKB_NO_EVENTS === '1' && kind !== 'up' && kind !== 'down') return;
  try { await appendLine(eventsFile(config), JSON.stringify({ at: new Date().toISOString(), path, kind })); } catch { /* never breaks a command */ }
}

async function events(config: OkbConfig): Promise<NoteEvent[]> {
  const out: NoteEvent[] = [];
  for (const r of await readLines(eventsFile(config)).catch(() => [] as string[])) {
    try { out.push(JSON.parse(r) as NoteEvent); } catch { /* cut line */ }
  }
  return out;
}

const DAY = 86_400_000;
const ACRONYM = /\b[A-Z][A-Z0-9]{2,6}\b/g;

function sentences(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').split(/(?<=[.!?])\s+|\n{2,}/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3 && !s.startsWith('#') && !s.startsWith('|') && !s.startsWith('>') && !s.startsWith('-'));
}

/** Quality: structure, sources, clarity, links — checked by OKB; justness from the reviewer, neutral without it. */
export async function qualityOf(config: OkbConfig, bundle: Bundle, entry: KbEntry, brokenFiles: ReadonlySet<string>): Promise<{ parts: QualityParts; notes: string[] }> {
  const doc = bundle.docs.get(entry.path)!;
  const body = doc.body;
  const notes: string[] = [];
  // Structure (20): the template's required sections, a « En bref », a sensible length.
  let structure = 10;
  const templateId = entry.ext.template;
  if (templateId) {
    const template = await getTemplate(config, templateId).catch(() => null);
    if (template) {
      const required = template.sections.filter((s) => s.required);
      const headings = entry.headings.map((h) => normalizeSurface(h));
      const present = required.filter((s) => headings.some((h) => h.includes(normalizeSurface(s.heading.fr)) || h.includes(normalizeSurface(s.heading.en)))).length;
      structure = required.length ? Math.round(14 * (present / required.length)) : 14;
      if (present < required.length) notes.push(`${required.length - present} required section(s) missing`);
    }
  } else if (entry.headings.length >= 2) structure = 12;
  if (/^#{2,3}\s+(?:\S+\s+)?(en bref|in short)/im.test(body) || (entry.description && entry.description.length >= 20)) structure += 4;
  else notes.push('no « En bref »');
  if (entry.bodyLength >= 200) structure += 2;
  // A concept card's one-line definition is what readers see on hover: without it, the card is incomplete.
  if (isConceptEntry(entry) && !oneLiner(body, entry.title).text) {
    structure -= 4;
    notes.push('no one-line definition');
  }
  structure = Math.max(0, Math.min(20, structure));
  // Sources (25): declared sources, cited claims, a level of confidence.
  const declared = Array.isArray(doc.data.sources) && doc.data.sources.length > 0;
  const citations = (body.match(/\[\^[^\]]+\]/g) ?? []).length;
  const sections = Math.max(1, entry.headings.length);
  let sources = (declared ? 10 : 0) + Math.min(10, Math.round((citations / sections) * 5)) + (entry.ext.confidence || /\b(rapporté|déduit|reported|inferred|vérifié|verified)\b/i.test(body) ? 5 : 0);
  if (entry.trust === 'human-reviewed') sources = Math.max(sources, 18);
  if (!declared) notes.push('no sources');
  sources = Math.min(25, sources);
  // Clarity (20): sentences of a readable length for the reader, jargon explained or linked.
  const level = config.reader.level;
  const target = level === 'beginner' ? 18 : level === 'expert' ? 28 : 23;
  const lens = sentences(body).map((s) => s.split(/\s+/).length);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : target;
  let clarity = avg <= target ? 12 : Math.max(2, 12 - Math.round((avg - target) / 2));
  const linked = new Set(extractLinks(body).map((l) => l.text?.toUpperCase?.() ?? ''));
  const acronyms = [...new Set(body.match(ACRONYM) ?? [])].filter((a) => !['API', 'URL', 'HTTP', 'JSON', 'SQL', 'CSV', 'PDF', 'OKB'].includes(a));
  const unexplained = acronyms.filter((a) => !linked.has(a) && !new RegExp(`${a}\\s*\\(`).test(body));
  clarity += Math.max(0, 8 - unexplained.length * 2);
  if (unexplained.length > 2) notes.push(`terms without a card: ${unexplained.slice(0, 4).join(', ')}`);
  clarity = Math.min(20, clarity);
  // Links (15): a way up (breadcrumb or parent), links to concept cards, nothing broken.
  const links = extractLinks(body);
  const targets = links.map((l) => resolveInternal(entry.path, l.url)).filter((x): x is BundlePath => Boolean(x));
  const up = body.includes('🧭') || targets.some((t) => t.split('/').length < entry.path.split('/').length);
  const toConcepts = targets.filter((t) => { const e = bundle.byPath.get(t); return e && (e.type === 'Concept' || e.ext.template === 'concept'); }).length;
  const linksScore = (up ? 5 : 0) + Math.min(5, toConcepts * 2 + (targets.length ? 1 : 0)) + (brokenFiles.has(entry.path) ? 0 : 5);
  if (!up) notes.push('no way up to its subject');
  // Justness (20): the reviewer's grade when the note went through one, neutral otherwise.
  const reviewed = (entry.ext as { review?: { score?: unknown } }).review?.score;
  const justness = typeof reviewed === 'number' ? Math.max(0, Math.min(20, reviewed)) : entry.trust === 'human-reviewed' ? 18 : 14;
  return { parts: { structure, sources, clarity, links: Math.min(15, linksScore), justness }, notes };
}

export async function scoreBundle(config: OkbConfig, bundle: Bundle, now = new Date()): Promise<NoteScore[]> {
  const broken = new Set(checkLinks(bundle.snapshot, { brokenTargetsAre: 'warning' }).issues.filter((i) => i.code === 'LINK_BROKEN_TARGET').map((i) => i.file as string));
  const ev = await events(config);
  const byPath = new Map<string, NoteEvent[]>();
  for (const e of ev) if (now.getTime() - Date.parse(e.at) <= 90 * DAY) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  const titles = new Map<string, number>();
  for (const e of bundle.entries) titles.set(normalizeSurface(e.title), (titles.get(normalizeSurface(e.title)) ?? 0) + 1);
  const out: NoteScore[] = [];
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const { parts: q, notes } = await qualityOf(config, bundle, entry, broken);
    const quality = q.structure + q.sources + q.clarity + q.links + q.justness;
    const mine = byPath.get(entry.path) ?? [];
    const weight = { open: 1, search: 1, cited: 3, ticket: 4, up: 0, down: 0 } as const;
    const points = mine.reduce((n, e) => n + weight[e.kind], 0);
    const used = Math.min(40, Math.round(Math.log2(1 + points) * 10));
    const generatedAt = (entry.ext as unknown as { converted?: string }).converted ?? ((bundle.docs.get(entry.path)?.data.generated as { at?: string } | undefined)?.at);
    const age = generatedAt ? (now.getTime() - Date.parse(generatedAt)) / DAY : 999;
    const checked = entry.ext.checked ? (now.getTime() - Date.parse(entry.ext.checked)) / DAY : age;
    const stale = entry.status === 'deprecated' || /(à rafraîchir|to refresh)/i.test(entry.tags.join(' '));
    const fresh = stale ? 5 : checked <= 180 ? 25 : checked <= 365 ? 18 : 12;
    const unique = (titles.get(normalizeSurface(entry.title)) ?? 0) > 1 ? 5 : 15;
    const ups = mine.filter((e) => e.kind === 'up').length;
    const downs = mine.filter((e) => e.kind === 'down').length;
    const opinion = ups > downs ? 20 : downs > ups ? 0 : 12;
    const value = used + fresh + unique + opinion;
    const young = age < 30;
    const global = young ? quality : Math.round(0.6 * quality + 0.4 * value);
    out.push({
      path: entry.path, title: entry.title, quality, value, global, stars: Math.round(global / 20), young,
      parts: { quality: q, value: { used, fresh, unique, opinion } }, notes,
    });
  }
  return out.sort((a, b) => a.global - b.global);
}
