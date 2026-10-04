/**
 * Names for the detected themes of a KB. A theme is a group of notes far more
 * linked to each other than to the rest (see communities.ts); its name must
 * tell what the group is about, at a glance:
 *
 * 1. an explaining note (guide, parcours, procedure, process) linked to at
 *    least half of the theme names it: "Le cycle d'une affaire";
 * 2. else a tag carried by most of the theme (60 %) and almost only by it
 *    (80 %): "Second cerveau";
 * 3. else an explaining note linked to at least a quarter of the theme;
 * 4. else the theme's most central note.
 *
 * A note scores by how much of the theme it reaches (coverage) and how much of
 * its own links stay inside (a home page linking everywhere names nothing).
 */
export type ThemeNote = {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly description?: string;
};

export type ThemeName = {
  /** The note that names or anchors the theme (opened when the theme is clicked). */
  readonly hub: string;
  readonly label: string;
  readonly namedBy: 'note' | 'tag';
  /** The tag, when the theme is named after one. */
  readonly tag?: string;
};

/** Categories whose notes explain a group of other notes, by weight. */
const EXPLAINS: Readonly<Record<string, number>> = { guide: 3, path: 2, howto: 2, process: 2 };

export function nameTheme(
  members: readonly ThemeNote[],
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  tagCounts: ReadonlyMap<string, number>,
): ThemeName {
  const inside = new Set(members.map((m) => m.id));
  const others = Math.max(1, members.length - 1);
  const rows = members.map((n) => {
    const links = neighbours.get(n.id) ?? new Set<string>();
    const within = [...links].filter((x) => inside.has(x)).length;
    const coverage = within / others;
    const embedded = links.size ? within / links.size : 0;
    return { n, coverage, score: coverage * embedded };
  });
  const byScore = (a: { score: number; n: ThemeNote }, b: { score: number; n: ThemeNote }) => b.score - a.score || a.n.id.localeCompare(b.n.id);
  const explainers = rows
    .filter((r) => EXPLAINS[r.n.category])
    .map((r) => ({ ...r, score: EXPLAINS[r.n.category]! * r.score }))
    .sort(byScore);
  const central = [...rows].sort(byScore)[0]!.n;
  const fromNote = (n: ThemeNote): ThemeName => ({ hub: n.id, label: themeTitle(n.title), namedBy: 'note' });

  const strong = explainers.find((r) => r.coverage >= 0.5);
  if (strong) return fromNote(strong.n);
  const tag = sharedTag(members, tagCounts);
  if (tag) return { hub: central.id, label: humaniseTag(tag, members), namedBy: 'tag', tag };
  const weaker = explainers.find((r) => r.coverage >= 0.25);
  return fromNote(weaker?.n ?? central);
}

/** A tag most of the theme carries, and that almost only the theme carries. */
function sharedTag(members: readonly ThemeNote[], tagCounts: ReadonlyMap<string, number>): string | null {
  if (members.length < 3) return null;
  const counts = new Map<string, number>();
  for (const m of members) for (const t of new Set(m.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const found = [...counts]
    .map(([tag, k]) => ({ tag, share: k / members.length, purity: k / (tagCounts.get(tag) ?? k) }))
    .filter((x) => x.share >= 0.6 && x.purity >= 0.8)
    .sort((a, b) => b.share * b.purity - a.share * a.purity || a.tag.localeCompare(b.tag));
  return found[0]?.tag ?? null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * "second-cerveau" → "Second cerveau", "securite-ia" → "Sécurité IA": words of a
 * tag get their accents and acronyms back from the theme's own titles.
 */
export function humaniseTag(tag: string, members: readonly ThemeNote[] = []): string {
  const spelled = new Map<string, string>();
  for (const m of members) {
    for (const word of `${m.title} ${m.description ?? ''}`.split(/[^\p{L}\p{N}]+/u)) {
      if (word && !spelled.has(fold(word))) spelled.set(fold(word), word);
    }
  }
  const words = tag.split(/[-_/\s]+/).filter(Boolean).map((w) => {
    const known = spelled.get(fold(w));
    if (known && known.length > 1 && known === known.toUpperCase() && /\p{L}/u.test(known)) return known;
    return (known ?? w).toLowerCase();
  });
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The topic part of a note title: no leading emoji, nothing after " : " or
 * " — ", nor after the first comma of a long title.
 * "🔄 Le cycle d’une affaire, de l’opportunité au REX" → "Le cycle d’une affaire".
 */
export function themeTitle(title: string): string {
  let t = String(title).replace(/^[^\p{L}\p{N}«"(]+/u, '').trim();
  const cut = t.search(/\s[:—–|]\s|\s-\s/);
  if (cut >= 8) t = t.slice(0, cut);
  const comma = t.indexOf(', ');
  if (comma >= 12 && t.slice(0, comma).split(/\s+/).length >= 3) t = t.slice(0, comma);
  return t.trim();
}
