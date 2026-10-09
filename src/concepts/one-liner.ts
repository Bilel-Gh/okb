import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import type { BundlePath } from '../util/paths.js';

/**
 * A concept card's one-line definition: the first sentence under « En une
 * phrase » (or, failing that, « En bref »), in plain words. It is the only text
 * shown when a reader hovers a word that has a card: without a valid sentence
 * the word stays a plain link, never a vague bubble. The sentence lives in the
 * card itself, where the person can correct it.
 */
export type OneLiner = { readonly text: string | null; readonly reason: 'ok' | 'missing' | 'too-long' | 'too-short' };

export const ONE_LINER_MAX_WORDS = 25;
export const ONE_LINER_MIN_WORDS = 3;

const FIRST = /^(en une phrase|in one sentence)$/;
const BRIEF = /^(en bref|in brief|in short)$/;

const headingText = (line: string) => line.replace(/^#{1,6}\s+/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s:.!?]+$/, '').trim().toLowerCase();

/** Markdown inline syntax down to the words a reader sees. */
export function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_]+)[*_](?=$|[^\p{L}\p{N}])/gu, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The paragraph right under a heading matching `which`, code blocks left out. */
function sectionParagraph(lines: readonly string[], which: RegExp): string | null {
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && which.test(headingText(l)));
  if (start < 0) return null;
  const para: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const t = line.trim();
    if (!t) { if (para.length) break; continue; }
    if (t.startsWith('|') || t.startsWith('<')) { if (para.length) break; continue; }
    para.push(t.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^>\s?/, ''));
  }
  return para.length ? para.join(' ') : '';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Abbreviations whose dot does not end a sentence: « p. ex. », « e.g. », « M. », an initial… */
const ABBREVIATION = /(?:\bp\. ?ex|\be\.g|\bi\.e|\bcf|\betc|\bvs|\bc\.-à-d|\bMmes?|\bMr?s?|\bDr|\bSt|\bn°|\b\p{Lu})$/u;

/** The text up to the end of its first sentence, abbreviations aside. */
export function firstSentence(text: string): string {
  const end = /[.!?…]\s+(?=[\p{Lu}«"“(])/gu;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    if (m[0].startsWith('.') && ABBREVIATION.test(text.slice(0, m.index))) continue;
    return text.slice(0, m.index + 1).trim();
  }
  return text.trim();
}

export function oneLiner(body: string, term: string): OneLiner {
  const lines = body.replace(/```[\s\S]*?```/g, '').split('\n');
  const raw = sectionParagraph(lines, FIRST) ?? sectionParagraph(lines, BRIEF);
  if (!raw) return { text: null, reason: 'missing' };
  let text = plain(raw);
  // The first sentence only.
  text = firstSentence(text);
  // « SLA : … », « Idempotence — … »: the term already titles the bubble.
  if (term) text = text.replace(new RegExp(`^${escape(plain(term))}\\s*(?::|—|–|-)\\s+`, 'iu'), '');
  text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const onlyTerm = text.replace(/[.!?…\s]+$/, '').toLowerCase() === plain(term).toLowerCase();
  if (onlyTerm || words.length < ONE_LINER_MIN_WORDS) return { text: null, reason: 'too-short' };
  if (words.length > ONE_LINER_MAX_WORDS) return { text: null, reason: 'too-long' };
  return { text, reason: 'ok' };
}

const CONCEPT_TYPES = new Set(['concept', 'acronym', 'Concept', 'Glossary']);

/** Is this entry a concept card (a brain type, a template or an OKF type)? */
export function isConceptEntry(entry: { type: string; ext: unknown }): boolean {
  const ext = entry.ext as { brain?: { type?: string }; template?: string } | undefined;
  return CONCEPT_TYPES.has(ext?.brain?.type ?? '') || CONCEPT_TYPES.has(ext?.template ?? '') || CONCEPT_TYPES.has(entry.type);
}

/** Concept cards without a valid one-line definition: each is worth a suggestion. */
export function conceptsWithoutOneLiner(_config: OkbConfig, bundle: Bundle): { path: BundlePath; title: string; reason: OneLiner['reason'] }[] {
  const out: { path: BundlePath; title: string; reason: OneLiner['reason'] }[] = [];
  for (const e of bundle.entries) {
    if (e.reserved || !isConceptEntry(e) || (e.ext as { translation?: unknown }).translation) continue;
    const r = oneLiner(bundle.docs.get(e.path)?.body ?? '', e.title);
    if (!r.text) out.push({ path: e.path, title: e.title, reason: r.reason });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
