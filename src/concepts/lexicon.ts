import type { Bundle, KbEntry } from '../kb/bundle.js';
import { normalizeSurface } from '../kb/search.js';
import type { BundlePath } from '../util/paths.js';

export type LexiconSense = {
  readonly path: BundlePath;
  readonly entry: KbEntry;
  readonly senseKey: string | null;
  readonly domain: string | null;
};

export type LexiconTerm = {
  readonly canonical: string;
  readonly surfaces: readonly string[];
  readonly senses: readonly LexiconSense[];
  /** True when the same surface form resolves to more than one document or sense. */
  readonly ambiguous: boolean;
};

export type Lexicon = {
  readonly byCanonical: ReadonlyMap<string, LexiconTerm>;
  /** Longest-first list of surfaces, so "Robot UI" wins over "GUI". */
  readonly surfacesByLength: readonly { surface: string; canonical: string }[];
};

/**
 * The lexicon is built from the bundle itself: titles, declared aliases and the
 * concepts folder. Nothing is fetched; a term the KB has never heard of simply
 * resolves to "missing".
 */
export function buildLexicon(bundle: Bundle, conceptsFolder: string): Lexicon {
  const acc = new Map<string, { surfaces: Set<string>; senses: LexiconSense[] }>();
  const conceptPrefix = `${conceptsFolder.replace(/\/$/, '')}/`;

  const add = (surface: string, entry: KbEntry, senseKey: string | null) => {
    const canonical = normalizeSurface(surface);
    if (canonical.length < 2) return;
    const bucket = acc.get(canonical) ?? { surfaces: new Set<string>(), senses: [] };
    bucket.surfaces.add(surface.trim());
    const already = bucket.senses.find((s) => s.path === entry.path && s.senseKey === senseKey);
    if (!already) {
      bucket.senses.push({
        path: entry.path,
        entry,
        senseKey,
        domain: entry.ext.domain ?? null,
      });
    }
    acc.set(canonical, bucket);
  };

  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const isConceptCard = entry.path.startsWith(conceptPrefix);
    const senses = entry.ext.senses ?? [];

    if (senses.length > 1) {
      for (const sense of senses) add(entry.title, entry, sense.key);
    } else {
      add(entry.title, entry, senses[0]?.key ?? null);
    }
    for (const alias of entry.ext.aliases ?? []) add(alias, entry, senses[0]?.key ?? null);
    if (isConceptCard) {
      add(entry.path.split('/').pop()!.replace(/\.md$/, '').replace(/-/g, ' '), entry, null);
    }
  }

  const byCanonical = new Map<string, LexiconTerm>();
  for (const [canonical, bucket] of acc) {
    const distinctTargets = new Set(bucket.senses.map((s) => `${s.path}#${s.senseKey ?? ''}`));
    byCanonical.set(canonical, {
      canonical,
      surfaces: [...bucket.surfaces],
      senses: bucket.senses,
      ambiguous: distinctTargets.size > 1,
    });
  }

  const surfacesByLength = [...byCanonical.values()]
    .flatMap((t) => t.surfaces.map((surface) => ({ surface, canonical: t.canonical })))
    .sort((a, b) => b.surface.length - a.surface.length);

  return { byCanonical, surfacesByLength };
}

export function lookup(lexicon: Lexicon, surface: string): LexiconTerm | undefined {
  return lexicon.byCanonical.get(normalizeSurface(surface));
}
