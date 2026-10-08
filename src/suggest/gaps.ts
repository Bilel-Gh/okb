import type { Bundle } from '../kb/bundle.js';
import { normalizeSurface } from '../kb/search.js';
import { glossary } from '../brain/views.js';
import type { BrainLayout } from '../brain/layout.js';
import type { BundlePath } from '../util/paths.js';

/**
 * Important terms without a concept card, found without AI: acronyms,
 * `code-like` terms and capitalised phrases that come back across several
 * notes, minus what already has a card (by title or alias) and common words.
 * The most widespread first: they are the ones a one-minute card helps most.
 */
export type Gap = { readonly term: string; readonly notes: number; readonly examples: readonly BundlePath[] };

const COMMON = new Set(['OK', 'ID', 'URL', 'URI', 'API', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'HTML', 'CSS', 'PDF', 'CSV', 'UTC', 'ISO', 'FAQ', 'PR', 'CI', 'CD', 'UI', 'UX', 'OS', 'IT', 'AI', 'ML', 'TODO', 'NOTE', 'OKB', 'KB', 'MD', 'README', 'SQL', 'TIP', 'WARNING', 'IMPORTANT']);
const ACRONYM = /\b([A-Z][A-Z0-9]{1,6})\b/g;
const CODEISH = /`([A-Za-z][\w.-]{2,30})`/g;

export function conceptGaps(layout: BrainLayout | null, bundle: Bundle, stop: readonly string[] = []): Gap[] {
  const known = new Set<string>();
  for (const g of glossary(layout, bundle)) { known.add(normalizeSurface(g.term)); for (const a of g.aliases) known.add(normalizeSurface(a)); }
  for (const s of stop) known.add(normalizeSurface(s));
  const seen = new Map<string, { term: string; notes: Set<BundlePath> }>();
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved) continue;
    const body = doc.body.replace(/```[\s\S]*?```/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
    const terms = new Set<string>();
    for (const m of body.matchAll(ACRONYM)) if (!COMMON.has(m[1]!)) terms.add(m[1]!);
    for (const m of body.matchAll(CODEISH)) if (!/[/.](md|ts|js|json|yaml|yml)$/i.test(m[1]!) && !m[1]!.includes('/')) terms.add(m[1]!);
    for (const t of terms) {
      const k = normalizeSurface(t);
      if (known.has(k) || k.length < 2) continue;
      const entry = seen.get(k) ?? { term: t, notes: new Set<BundlePath>() };
      entry.notes.add(path);
      seen.set(k, entry);
    }
  }
  return [...seen.values()].filter((e) => e.notes.size >= 2).map((e) => ({ term: e.term, notes: e.notes.size, examples: [...e.notes].slice(0, 3) })).sort((a, b) => b.notes - a.notes || a.term.localeCompare(b.term));
}
