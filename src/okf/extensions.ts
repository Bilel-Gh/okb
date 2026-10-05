/**
 * Product extensions to OKF.
 *
 * OKF allows arbitrary producer keys and asks consumers to preserve them. This
 * product keeps *all* of its own state under one frontmatter key, `x_okb`, so a
 * reader can tell at a glance what is standard OKF and what is ours.
 *
 * None of these are OKF fields. Another OKF consumer may ignore them entirely.
 */
import type { OkfFrontmatter } from './types.js';

export const OKB_EXT_KEY = 'x_okb' as const;

export type ConceptSense = {
  /** Disambiguator, e.g. `fleet` vs `support` for the word "agent". */
  key: string;
  domain?: string;
  summary?: string;
};

export type OkbExtension = {
  /** Schema version of the `x_okb` block itself. */
  v?: 1;
  /** Alternative surface forms that should resolve to this document. */
  aliases?: string[];
  /** Domain this document belongs to; drives per-domain concept-assist settings. */
  domain?: string;
  /** Prerequisite documents, as bundle paths. Used to build "Prérequis utiles". */
  prereqs?: string[];
  /** Declared senses when one surface form means several things. */
  senses?: ConceptSense[];
  /** True when the term is an internal acronym whose expansion is unproven. */
  needs_clarification?: boolean;
  /** Idempotence ledger: content keys already merged into this document. */
  ingested?: string[];
  /** Concept-assist links already injected, keyed by `${term}@${targetPath}`. */
  linked?: string[];
  /** Note template the note follows (`okb template list`). */
  template?: string;
  /** Category chosen by hand; otherwise derived from the template, type or folder (src/categories). */
  category?: string;
  /** Day a note written before OKB was converted to its format (`okb kb convert`). */
  converted?: string;
  /** Style the prose was last written in; lets maintenance list notes worth revising. */
  writing?: { preset: string; language: string };
  /** Verification events that covered an earlier version of the text. */
  prior_verified?: unknown[];
};

export function getExtension(fm: OkfFrontmatter): OkbExtension {
  const raw = fm[OKB_EXT_KEY];
  return raw && typeof raw === 'object' ? ({ ...(raw as OkbExtension) }) : {};
}

export function withExtension(fm: OkfFrontmatter, patch: OkbExtension): OkfFrontmatter {
  const current = getExtension(fm);
  const merged: OkbExtension = { v: 1, ...current, ...patch };
  for (const key of ['aliases', 'prereqs', 'ingested', 'linked'] as const) {
    const a = current[key] ?? [];
    const b = patch[key] ?? [];
    if (a.length || b.length) merged[key] = [...new Set([...a, ...b])].sort();
  }
  return { ...fm, [OKB_EXT_KEY]: merged };
}

export function hasIngested(fm: OkfFrontmatter, contentKey: string): boolean {
  return (getExtension(fm).ingested ?? []).includes(contentKey);
}

export function hasLinked(fm: OkfFrontmatter, linkKey: string): boolean {
  return (getExtension(fm).linked ?? []).includes(linkKey);
}
