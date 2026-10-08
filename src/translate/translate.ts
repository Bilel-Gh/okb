import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import YAML from 'yaml';
import { complete } from '../ai/provider.js';
import { recordAiUsage } from '../ai/usage.js';
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
  const push = (kind: Segment['kind'], line: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.section === section) last.lines.push(line);
    else out.push({ kind, lines: [line], section });
  };
  for (const line of body.split('\n')) {
    if (fence) {
      push('keep', line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    const open = /^\s*(```|~~~)/.exec(line);
    if (open) { fence = open[1]!; push('keep', line); continue; }
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

type Cache = {
  v: 1; path: string; lang: string; lastRead: string; updatedAt: string;
  meta?: { hash: string; title: string; description: string };
  sections: Record<string, string[]>;
};

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
};

function sourceLanguage(config: OkbConfig): string {
  return (config.writing.language ?? config.profile.answer.language ?? 'en').slice(0, 2);
}

async function plan(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, options: { confirmSecret?: boolean } = {}): Promise<Plan> {
  if (!(LANGUAGES as readonly string[]).includes(lang)) throw new OkbError('E_INVALID', `language ${lang} is not offered`, { key: 'translateLanguage', params: { lang, langs: LANGUAGES.join(', ') } });
  const source = sourceLanguage(config);
  if (lang === source) throw new OkbError('E_INVALID', `the note is already in ${lang}`, { key: 'translateSameLanguage', params: { lang } });
  const bundle = await loadBundleFor(config);
  const doc = bundle.docs.get(path);
  const entry = bundle.byPath.get(path);
  if (!doc || !entry) throw new OkbError('E_NOT_FOUND', `no note ${path}`, { key: 'noteUnknown', params: { path } });
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
  return { bundle, segs, sections, meta, source, cache: await loadCache(config, path, lang) };
}

function missing(p: Plan): { metaNeeded: boolean; sections: Plan['sections'] } {
  return { metaNeeded: p.cache.meta?.hash !== p.meta.hash, sections: p.sections.filter((s) => !p.cache.sections[s.hash]) };
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

export async function estimateTranslation(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, env: NodeJS.ProcessEnv = process.env, options: { confirmSecret?: boolean } = {}): Promise<{ tokens: number; cached: number; toTranslate: number }> {
  void env;
  const p = await plan(config, path, lang, scope, options);
  const r = requestFor(p, lang, []);
  const tokens = r.blocks.length ? estimateTokens(r.system + r.prompt) * 2 : 0;
  return { tokens, cached: p.sections.length - r.sections.length, toTranslate: r.sections.length };
}

export async function translateNote(config: OkbConfig, path: BundlePath, lang: string, scope: Scope, env: NodeJS.ProcessEnv = process.env, options: { confirmSecret?: boolean; now?: Date } = {}): Promise<{ title: string; description: string; markdown: string; cached: number; translated: number; tokens: number }> {
  const now = options.now ?? new Date();
  const p = await plan(config, path, lang, scope, options);
  const terms = glossary(layoutOf(config), p.bundle).flatMap((g) => [g.term, ...g.aliases]);
  const r = requestFor(p, lang, terms);
  let tokens = 0;
  const cache = p.cache;
  if (r.blocks.length) {
    const cost = estimateTokens(r.system + r.prompt) * 2;
    const [spent, budget] = await Promise.all([spentToday(config, now), dailyBudget(env)]);
    if (spent + cost > budget) throw new OkbError('E_INVALID', `daily budget reached (${spent} + ${cost} > ${budget} tokens)`, { key: 'budgetExceeded', params: { spent, cost, budget } });
    const answer = await complete({ system: r.system, prompt: r.prompt, size: 'small', maxTokens: Math.min(16_000, cost + 500) }, env);
    tokens = answer.tokens.input + answer.tokens.output;
    await recordAiUsage(config, { tokens, purpose: 'translate', provider: answer.provider }, now);
    const parsed = parseBlocks(answer.text, r.blocks.length);
    const value = (i: number) => {
      const b = r.blocks[i]!;
      const t = parsed[i];
      return t === null || t === undefined ? b.source : restore(t, b.protected.parts, b.source).text;
    };
    if (r.metaNeeded) cache.meta = { hash: p.meta.hash, title: value(0), description: p.meta.description ? value(1) : '' };
    for (const s of r.sections) {
      cache.sections[s.hash] = s.texts.map((_, i) => value(r.blocks.findIndex((b) => b.key === `${s.hash}:${i}`)));
    }
  }
  // Keep only what the current note still holds (old versions of a section go).
  if (scope === 'full') {
    const live = new Set(p.sections.map((s) => s.hash));
    for (const k of Object.keys(cache.sections)) if (!live.has(k)) delete cache.sections[k];
  }
  cache.lastRead = now.toISOString();
  if (r.blocks.length) cache.updatedAt = now.toISOString();
  await mkdir(cacheDir(config), { recursive: true });
  await writeJsonAtomic(cacheFile(config, path, lang), cache);
  void purgeTranslations(config, now).catch(() => 0);
  // The translated view: the sections in scope, text replaced, everything else as it was.
  const inScope = new Map(p.sections.map((s) => [s.index, cache.sections[s.hash] ?? s.texts.map((x) => x.text)]));
  const counters = new Map<number, number>();
  const body = p.segs.filter((s) => inScope.has(s.section)).map((s) => {
    if (s.kind !== 'text' || !s.text.trim()) return s.text;
    const i = counters.get(s.section) ?? 0;
    counters.set(s.section, i + 1);
    return inScope.get(s.section)![i] ?? s.text;
  }).join('\n').trim();
  const title = cache.meta?.title ?? p.meta.title;
  return {
    title, description: cache.meta?.description ?? p.meta.description,
    markdown: scope === 'brief' ? `# ${title}\n\n${body}\n` : `${body}\n`,
    cached: p.sections.length - r.sections.length, translated: r.sections.length, tokens,
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
    x_okb: { translation: { of: path, lang } },
  };
  const link = `./${encodeURI(`${base}.md`)}`;
  const content = `---\n${YAML.stringify(front, { lineWidth: 0 })}---\n\n> 🌐 ${TRANSLATION_OF[lang] ?? 'Translation of'} [${entry.title}](${link})\n\n${translated.markdown}`;
  const proposal = proposeFiles(config, p.bundle, new Map([[target, content]]), `translate ${path} → ${lang}`);
  await saveProposal(config, proposal);
  return proposal;
}
