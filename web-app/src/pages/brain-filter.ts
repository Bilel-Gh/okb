/**
 * The explorer's filters, kept in the address so a view can be bookmarked or
 * saved: types (several), status, quality (from the stars), date, 🔒, and the
 * order of the list. Pure functions, tested in tests/web-app/brain-filter.test.ts.
 */
export type Sort = 'title' | 'recent' | 'quality';
export type Since = '' | '7d' | '30d' | '1y';
export type Filters = {
  readonly cats: readonly string[];
  readonly status: '' | 'draft' | 'stable' | 'deprecated';
  /** weak: two stars or fewer · good: four or more. */
  readonly quality: '' | 'weak' | 'good';
  readonly since: Since;
  readonly secret: '' | 'only' | 'hide';
  readonly sort: Sort;
};
export type Filterable = { readonly title: string; readonly category: string; readonly status: string; readonly at?: string | null; readonly stars?: number | null; readonly secret?: boolean };

const one = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const DAYS: Record<Exclude<Since, ''>, number> = { '7d': 7, '30d': 30, '1y': 365 };

export function readFilters(query: Readonly<Record<string, string | undefined>>): Filters {
  return {
    cats: (query.cat ?? '').split(',').map((c) => c.trim()).filter(Boolean),
    status: one(query.status, ['draft', 'stable', 'deprecated'] as const, '' as const),
    quality: one(query.quality, ['weak', 'good'] as const, '' as const),
    since: one(query.since, ['7d', '30d', '1y'] as const, '' as const),
    secret: one(query.secret, ['only', 'hide'] as const, '' as const),
    sort: one(query.sort, ['title', 'recent', 'quality'] as const, 'title' as const),
  };
}

/** The address keys of the filters: empty for a default, so `setFilter` removes them. */
export function writeFilters(f: Filters): Record<string, string> {
  return { cat: f.cats.join(','), status: f.status, quality: f.quality, since: f.since, secret: f.secret, sort: f.sort === 'title' ? '' : f.sort };
}

/** How many filters narrow the list (the order is not one). */
export function activeFilters(f: Filters): number {
  return [f.cats.length > 0, f.status, f.quality, f.since, f.secret].filter(Boolean).length;
}

export function applyFilters<T extends Filterable>(notes: readonly T[], f: Filters, now = Date.now()): T[] {
  const cats = new Set(f.cats);
  const after = f.since ? now - DAYS[f.since] * 86_400_000 : 0;
  return notes.filter((n) => {
    if (cats.size && !cats.has(n.category)) return false;
    if (f.status && n.status !== f.status) return false;
    if (f.quality === 'weak' && !(typeof n.stars === 'number' && n.stars <= 2)) return false;
    if (f.quality === 'good' && !(typeof n.stars === 'number' && n.stars >= 4)) return false;
    if (after && !(n.at && Date.parse(n.at) >= after)) return false;
    if (f.secret === 'only' && !n.secret) return false;
    if (f.secret === 'hide' && n.secret) return false;
    return true;
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortNotes<T extends Filterable>(notes: readonly T[], sort: Sort): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);
  const time = (n: T) => (n.at ? Date.parse(n.at) : Number.NEGATIVE_INFINITY);
  const stars = (n: T) => (typeof n.stars === 'number' ? n.stars : -1);
  const out = [...notes];
  if (sort === 'recent') return out.sort((a, b) => time(b) - time(a) || byTitle(a, b));
  if (sort === 'quality') return out.sort((a, b) => stars(b) - stars(a) || byTitle(a, b));
  return out.sort(byTitle);
}
