import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import YAML from 'yaml';
import { sendToAi } from '../ai/gate.js';
import { oneAtATime } from '../ai/queue.js';
import { glossary } from '../brain/views.js';
import { layoutOf } from '../brain/layout.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { saveProposal } from '../proposal/store.js';
import { isSecret } from '../security/confidential.js';
import { findSecrets } from '../security/secrets.js';
import { statePaths } from '../state/paths.js';
import { dailyBudget, spentToday } from '../suggest/suggest.js';
import { estimateTokens } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import { writeJsonAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { withStateLock } from '../util/state-lock.js';

/**
 * Translate a note on demand, one language at a time, never in advance. The
 * note is cut by headings; code, diagrams, quotes (evidence) and footnotes stay
 * as they are; link targets and inline code are protected. Each section's
 * translation is kept on disk, keyed by its source text: reading it again costs
 * no token, and a changed note only sends its changed sections. « En bref »
 * comes first; the whole note on request. Nothing is written into the KB: « save
 * as a note » prepares a proposal. Translations unread for 30 days are dropped.
 */
export type Segment = { readonly kind: 'text' | 'keep'; readonly text: string; readonly section: number };
export type Scope = 'brief' | 'full';

export const LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt'] as const;
const NAMES: Readonly<Record<string, string>> = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese' };
const KEEP_DAYS = 30;
const DAY = 86_400_000;
const BRIEF = /^#{1,6}\s+(?:[^\p{L}\p{N}]+\s*)?(en bref|in brief|in short|en une phrase|in one sentence)\b/iu;

/* ------------------------------------------------------------- cutting */

export function segments(body: string): Segment[] {
  const out: { kind: Segment['kind']; lines: string[]; section: number }[] = [];
  let section = 0;
  let fence: string | null = null;
  let comment = false;
  let indented = false;
  let previous = '';
  const push = (kind: Segment['kind'], line: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.section === section) last.lines.push(line);
    else out.push({ kind, lines: [line], section });
  };
  for (const line of body.split('\n')) {
    const prev = previous;
    previous = line.trim() ? line : prev;
    if (fence) {
      push('keep', line);
      // A fence closes with the same mark, at least as long, and nothing after it.
      if (new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (comment) { push('keep', line); if (line.includes('-->')) comment = false; continue; }
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) { fence = open[1]!; push('keep', line); continue; }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) { comment = true; push('keep', line); continue; }
    // Indented code: four spaces after a blank line, not the continuation of a list item.
    if (/^( {4}|\t)/.test(line) && (indented || (!out.at(-1)?.lines.at(-1)?.trim() && !/^\s*([-*+]|\d+[.)])\s/.test(prev)))) { indented = true; push('keep', line); continue; }
    if (line.trim()) indented = false;
    if (/^#{1,6}\s/.test(line)) { section++; push('text', line); continue; }
    if (!line.trim() || /^\s*>/.test(line) || /^\[\^[^\]]+\]:/.test(line) || /^\s*<!--.*-->\s*$/.test(line)) { push('keep', line); continue; }
    push('text', line);
  }
  return out.map((s) => ({ kind: s.kind, text: s.lines.join('\n'), section: s.section }));
}

/** Link targets, inline code, footnote marks, wiki links and bare URLs become §n§, put back after. */
function protect(text: string): { text: string; parts: string[] } {
  const parts: string[] = [];
  const hold = (s: string) => { parts.push(s); return `§${parts.length}§`; };
  const out = text
    .replace(/`[^`\n]+`/g, (m) => hold(m))
    .replace(/\[\[[^\]]+\]\]/g, (m) => hold(m))
    .replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m) => `]${hold(m.slice(1))}`)
    .replace(/\[\^[^\]]+\]/g, (m) => hold(m))
    .replace(/\bhttps?:\/\/[^\s)>\]]+/g, (m) => hold(m));
  return { text: out, parts };
}

/** Put the protected parts back; a translation that lost one is not trusted (the source is kept). */
function restore(translated: string, parts: readonly string[], source: string): { text: string; ok: boolean } {
  for (let i = 1; i <= parts.length; i++) if (!translated.includes(`§${i}§`)) return { text: source, ok: false };
  return { text: translated.replace(/§(\d+)§/g, (_, n: string) => parts[Number(n) - 1] ?? ''), ok: true };
}

/* --------------------------------------------------------------- cache */

export type Cache = {
  v: 1; path: string; lang: string; lastRead: string; updatedAt: string;
  meta?: { hash: string; title: string; description: string };
  sections: Record<string, string[]>;
};

/**
 * The cache to save: what is on disk now (another translation may have written
 * it meanwhile) with this translation's sections on top. `live`: after a full
 * translation, the sections the note still holds; older versions go (F2.0-36).
 */
export function mergeCache(onDisk: Cache, mine: Cache, live: ReadonlySet<string> | null): Cache {
  const sections = { ...onDisk.sections, ...mine.sections };
  if (live) for (const k of Object.keys(sections)) if (!live.has(k)) delete sections[k];
  const meta = mine.meta ?? onDisk.meta;
  return { ...onDisk, ...mine, ...(meta ? { meta } : {}), sections };
}

const cacheDir = (config: OkbConfig) => resolve(statePaths(config).root, 'translations');
const cacheFile = (config: OkbConfig, path: string, lang: string) => resolve(cacheDir(config), `${sha256(path).slice(0, 20)}.${lang}.json`);

async function loadCache(config: OkbConfig, path: string, lang: string): Promise<Cache> {
  try {
    const c = JSON.parse(await readFile(cacheFile(config, path, lang), 'utf8')) as Cache;
    if (c.v === 1 && c.path === path) return c;
  } catch { /* none yet */ }
  return { v: 1, path, lang, lastRead: new Date().toISOString(), updatedAt: new Date().toISOString(), sections: {} };
}

/** Drop translations nobody read for 30 days. Returns how many were dropped. */
export async function purgeTranslations(config: OkbConfig, now = new Date()): Promise<number> {
  const dir = cacheDir(config);
  let dropped = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue;
    const file = resolve(dir, name);
    const c = await readFile(file, 'utf8').then((x) => JSON.parse(x) as Partial<Cache>, () => null);
    const last = Date.parse(c?.lastRead ?? '');
    if (!c || !Number.isFinite(last) || now.getTime() - last > KEEP_DAYS * DAY) { await rm(file, { force: true }); dropped++; }
  }
  return dropped;
}

/* ------------------------------------------------------------- planning */

type Plan = {
  readonly bundle: Bundle;
  readonly segs: readonly Segment[];
  /** Sections in scope, each with its source hash. */
  readonly sections: readonly { index: number; hash: string; texts: readonly Segment[] }[];
  readonly meta: { hash: string; title: string; description: string };
  readonly source: string;
  readonly cache: Cache;
  /** The note itself: 🔒 or not, and the content the person saw (their yes holds for it). */
  readonly note: { readonly secret: boolean; readonly hash: string };
};

/** The person's yes for a 🔒 note: `true` from the terminal (the note as it is now), or the content hash the web page showed. */
export type SecretYes = boolean | string;

const STOP: Readonly<Record<string, readonly string[]>> = {
  fr: ['le', 'la', 'les', 'des', 'est', 'une', 'pour', 'avec', 'dans', 'qui', 'que', 'pas', 'sur', 'au', 'du', 'et'],
  en: ['the', 'is', 'and', 'of', 'to', 'with', 'for', 'this', 'that', 'are', 'in', 'it', 'not', 'on', 'be', 'by'],
  es: ['el', 'los', 'las', 'es', 'una', 'para', 'con', 'que', 'por', 'del', 'y'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'ein', 'eine', 'auf'],
  it: ['il', 'gli', 'della', 'è', 'una', 'per', 'con', 'che', 'non', 'del'],
  pt: ['os', 'as', 'uma', 'para', 'com', 'que', 'não', 'por', 'do', 'da', 'é'],
};

/**
 * The language a note is written in: its own `lang` or `language`, else the one
 * its common words point to, else the profile's writing language.
 */
export function noteLanguage(data: Record<string, unknown>, body: string, fallback: string): string {
  const declared = data.lang ?? data.language;
  if (typeof declared === 'string' && /^[a-z]{2}/i.test(declared)) return declared.slice(0, 2).toLowerCase();
  const words = body.replace(/```[\s\S]*?```/g, ' ').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 8) return fallback;
  const counts = Object.entries(STOP).map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = counts;
  return best![1] >= 3 && best![1] > (second?.[1] ?? 0) * 1.5 ? best![0] : fallback;
}

function sourceLanguage(config: OkbConfig): string {
  return (config.writing.language ?? config.profile.answer.language ?? 'en').slice(0, 2);
}

async function plan(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, options: { confirmSecret?: SecretYes } = {}): Promise<Plan> {
  if (!(LANGUAGES as readonly string[]).includes(lang)) throw new OkbError('E_INVALID', `language ${lang} is not offered`, { key: 'translateLanguage', params: { lang, langs: LANGUAGES.join(', ') } });
  const bundle = await loadBundleFor(config);
  const doc = bundle.docs.get(path);
  const entry = bundle.byPath.get(path);
  if (!doc || !entry) throw new OkbError('E_NOT_FOUND', `no note ${path}`, { key: 'noteUnknown', params: { path } });
  const source = noteLanguage(doc.data as Record<string, unknown>, doc.body, sourceLanguage(config));
  if (lang === source) throw new OkbError('E_INVALID', `the note is already in ${lang}`, { key: 'translateSameLanguage', params: { lang } });
  if (isSecret(entry.ext) && !options.confirmSecret) throw new OkbError('E_SECRET', 'a 🔒 note leaves the computer only when the person confirms', { key: 'translateSecret', params: { path } });
  const segs = segments(doc.body);
  const textSegs = segs.filter((s) => s.kind === 'text' && s.text.trim());
  const found = new Set(textSegs.map((s) => s.section));
  let indexes = [...found].sort((a, b) => a - b);
  if (scope === 'brief') {
    const brief = textSegs.find((s) => BRIEF.test(s.text.split('\n')[0] ?? ''))?.section;
    // No « En bref »: the opening of the note (before the second heading) stands for it.
    indexes = brief !== undefined ? [brief] : indexes.slice(0, 1);
  }
  const sections = indexes.map((index) => {
    const texts = textSegs.filter((s) => s.section === index);
    return { index, hash: sha256(texts.map((s) => s.text).join('\n\u0000')).slice(0, 24), texts };
  });
  const meta = { hash: sha256(`${entry.title}\n\u0000${entry.description}`).slice(0, 24), title: entry.title, description: entry.description };
  const all = [meta.title, meta.description, ...sections.flatMap((s) => s.texts.map((x) => x.text))].join('\n');
  const secrets = findSecrets(all);
  if (secrets.length) throw new OkbError('E_SECRET', 'the note holds a secret: it is not sent to the AI', { key: 'translateHasSecret', params: { kind: secrets[0]!.kind } });
  return { bundle, segs, sections, meta, source, cache: await loadCache(config, path, lang), note: { secret: isSecret(entry.ext), hash: entry.sha256.slice(0, 24) } };
}

function missing(p: Plan): { metaNeeded: boolean; sections: Plan['sections'] } {
  return { metaNeeded: p.cache.meta?.hash !== p.meta.hash, sections: p.sections.filter((s) => !p.cache.sections[s.hash]) };
}

/**
 * The brain's terms, given to the model so it keeps them as written. Never the
 * terms of a 🔒 or private card: its title and aliases are what it hides (F2.0-30).
 */
function sendableTerms(bundle: Bundle, config: OkbConfig): string[] {
  return glossary(layoutOf(config), bundle)
    .filter((g) => {
      const ext = bundle.byPath.get(asBundlePath(g.path))?.ext as { confidentiality?: string } | undefined;
      return !isSecret(ext) && ext?.confidentiality !== 'private';
    })
    .flatMap((g) => [g.term, ...g.aliases])
    .filter((t) => !findSecrets(t).length);
}

function requestFor(p: Plan, lang: string, terms: readonly string[]) {
  const m = missing(p);
  const blocks: { key: string; protected: { text: string; parts: string[] }; source: string }[] = [];
  if (m.metaNeeded) {
    blocks.push({ key: 'title', protected: protect(p.meta.title), source: p.meta.title });
    blocks.push({ key: 'description', protected: protect(p.meta.description || '-'), source: p.meta.description });
  }
  for (const s of m.sections) s.texts.forEach((t, i) => blocks.push({ key: `${s.hash}:${i}`, protected: protect(t.text), source: t.text }));
  const system = [
    `You translate Markdown notes from ${NAMES[p.source] ?? p.source} to ${NAMES[lang] ?? lang}.`,
    'Keep the Markdown syntax, emoji, numbers, names of code and every §n§ placeholder exactly as they are.',
    terms.length ? `Terms of this knowledge base, keep them as written: ${terms.slice(0, 60).join(', ')}.` : '',
    'Answer with the same <<<n>>> markers, each followed by its translation, and nothing else.',
  ].filter(Boolean).join('\n');
  const prompt = blocks.map((b, i) => `<<<${i + 1}>>>\n${b.protected.text}`).join('\n');
  return { blocks, system, prompt, sections: m.sections, metaNeeded: m.metaNeeded };
}

function parseBlocks(text: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  const parts = text.split(/^<<<(\d+)>>>[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    if (n >= 1 && n <= count) out[n - 1] = (parts[i + 1] ?? '').replace(/^\n/, '').replace(/\n+$/, '');
  }
  return out;
}

/* ---------------------------------------------------------------- public */

export async function estimateTranslation(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, env: NodeJS.ProcessEnv = process.env, options: { confirmSecret?: SecretYes; now?: Date } = {}): Promise<{ tokens: number; cached: number; toTranslate: number; budget: { spent: number; daily: number }; hash: string }> {
  const p = await plan(config, path, lang, scope, options);
  // The same request as the translation itself, the brain's terms included.
  const r = requestFor(p, lang, sendableTerms(p.bundle, config));
  const tokens = r.blocks.length ? estimateTokens(r.system + r.prompt) * 2 : 0;
  const [spent, daily] = await Promise.all([spentToday(config, options.now ?? new Date()), dailyBudget(env)]);
  // `hash`: the content this estimate describes; a yes to send a 🔒 note is given for it.
  return { tokens, cached: p.sections.length - r.sections.length, toTranslate: r.sections.length, budget: { spent, daily }, hash: p.note.hash };
}

export function translateNote(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, env: NodeJS.ProcessEnv = process.env, options: { confirmSecret?: SecretYes; now?: Date } = {}): Promise<{ title: string; description: string; markdown: string; cached: number; translated: number; failed: number; tokens: number }> {
  return oneAtATime(() => translateNow(config, path, lang, scope, env, options));
}

async function translateNow(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, env: NodeJS.ProcessEnv, options: { confirmSecret?: SecretYes; now?: Date }): Promise<{ title: string; description: string; markdown: string; cached: number; translated: number; failed: number; tokens: number }> {
  const now = options.now ?? new Date();
  const p = await plan(config, path, lang, scope, options);
  const r = requestFor(p, lang, sendableTerms(p.bundle, config));
  let tokens = 0;
  let done = 0;
  let failed = 0;
  const cache = p.cache;
  if (r.blocks.length) {
    const cost = estimateTokens(r.system + r.prompt) * 2;
    const yes = options.confirmSecret === undefined || options.confirmSecret === false ? [] : [{ path, hash: options.confirmSecret === true ? p.note.hash : options.confirmSecret }];
    const answer = await sendToAi(config, {
      purpose: 'translate', system: r.system, prompt: r.prompt, size: 'small', maxTokens: Math.min(16_000, cost + 500), cost,
      notes: [{ path, secret: p.note.secret, hash: p.note.hash }], consent: yes,
    }, env, now);
    tokens = answer.tokens.input + answer.tokens.output;
    const parsed = parseBlocks(answer.text, r.blocks.length);
    // Only what came back whole is kept: a block missing, cut, or that lost a link target is asked again next time.
    const results = r.blocks.map((b, i) => {
      const t = parsed[i];
      if (t === null || t === undefined || !t.trim()) return null;
      const back = restore(t, b.protected.parts, b.source);
      return back.ok ? back.text : null;
    });
    if (!results.some((x) => x !== null)) throw new OkbError('E_IO', 'the AI gave no translation', { key: 'aiFailed', params: { error: answer.text.trim().slice(0, 160) || 'empty answer' } });
    if (r.metaNeeded && results[0] !== null && (!p.meta.description || results[1] !== null)) {
      cache.meta = { hash: p.meta.hash, title: results[0]!, description: p.meta.description ? results[1]! : '' };
    }
    for (const s of r.sections) {
      const texts = s.texts.map((_, i) => results[r.blocks.findIndex((b) => b.key === `${s.hash}:${i}`)] ?? null);
      if (texts.every((x) => x !== null)) { cache.sections[s.hash] = texts as string[]; done++; } else failed++;
    }
  }
  cache.lastRead = now.toISOString();
  if (r.blocks.length) cache.updatedAt = now.toISOString();
  await mkdir(cacheDir(config), { recursive: true });
  // Saved over what is on disk now: a translation that ran meanwhile (from the CLI or the app) keeps its sections.
  const live = scope === 'full' ? new Set(p.sections.map((s) => s.hash)) : null;
  const saved = await withStateLock(cacheFile(config, path, lang), async () => {
    const merged = mergeCache(await loadCache(config, path, lang), cache, live);
    await writeJsonAtomic(cacheFile(config, path, lang), merged);
    return merged;
  });
  cache.sections = saved.sections;
  if (saved.meta) cache.meta = saved.meta;
  void purgeTranslations(config, now).catch(() => 0);
  // The translated view: the sections in scope, text replaced, everything else as it was.
  const inScope = new Map(p.sections.map((s) => [s.index, cache.sections[s.hash] ?? s.texts.map((x) => x.text)]));
  const counters = new Map<number, number>();
  // The whole note keeps every part, even a section with nothing to translate (code only).
  const body = p.segs.filter((s) => scope === 'full' || inScope.has(s.section)).map((s) => {
    if (s.kind !== 'text' || !s.text.trim()) return s.text;
    const i = counters.get(s.section) ?? 0;
    counters.set(s.section, i + 1);
    return inScope.get(s.section)?.[i] ?? s.text;
  }).join('\n').trim();
  const title = cache.meta?.title ?? p.meta.title;
  return {
    title, description: cache.meta?.description ?? p.meta.description,
    // The brief view is titled once: the note's own H1, when it opened the brief, is left out.
    markdown: scope === 'brief' ? `# ${title}\n\n${body.replace(/^# .*\n*/, '')}\n` : `${body}\n`,
    cached: p.sections.length - r.sections.length, translated: done, failed, tokens,
  };
}

const TRANSLATION_OF: Readonly<Record<string, string>> = { fr: 'Traduction de', en: 'Translation of', es: 'Traducción de', de: 'Übersetzung von', it: 'Traduzione di', pt: 'Tradução de' };

/** « Save as a note »: a proposal for `<name> (EN).md` beside the original, linked to it. Nothing is written without approval. */
export async function proposeTranslation(config: OkbConfig, path: BundlePath, lang: string): Promise<Proposal> {
  const p = await plan(config, path, lang, 'full', { confirmSecret: true });
  if (p.cache.meta?.hash !== p.meta.hash || p.sections.some((s) => !p.cache.sections[s.hash])) {
    throw new OkbError('E_INVALID', 'translate the whole note first', { key: 'translateFirst', params: { path } });
  }
  const entry = p.bundle.byPath.get(path)!;
  const tag = lang.toUpperCase();
  const base = posix.basename(path, '.md');
  const target = asBundlePath(posix.join(posix.dirname(path), `${base} (${tag}).md`));
  const translated = await translateNote(config, path, lang, 'full', process.env, { confirmSecret: true });
  const front = {
    type: entry.type, title: `${translated.title} (${tag})`, description: translated.description || translated.title, status: 'draft',
    generated: { by: config.okf.machineActor, at: new Date().toISOString() },
    // The translation of a 🔒 or private note stays as protected as the note.
    x_okb: { ...(isSecret(entry.ext) || (entry.ext as { confidentiality?: string }).confidentiality === 'private' ? { confidentiality: (entry.ext as { confidentiality: string }).confidentiality } : {}), translation: { of: path, lang } },
  };
  const link = `./${encodeURI(`${base}.md`)}`;
  const content = `---\n${YAML.stringify(front, { lineWidth: 0 })}---\n\n> 🌐 ${TRANSLATION_OF[lang] ?? 'Translation of'} [${entry.title}](${link})\n\n${translated.markdown}`;
  const proposal = proposeFiles(config, p.bundle, new Map([[target, content]]), `translate ${path} → ${lang}`);
  await saveProposal(config, proposal);
  return proposal;
}
