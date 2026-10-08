import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useT } from './i18n';

/** Note categories: the lines of the map, each with its colour for the current theme. */
export type Category = { id: string; emoji: string; label: { fr: string; en: string }; color: string; colorDark: string; count?: number };

export function useCategories() {
  const t = useT();
  const q = useQuery({ queryKey: ['categories'], queryFn: () => get<{ categories: Category[] }>('/api/categories'), staleTime: 60_000 });
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const byId = new Map((q.data?.categories ?? []).map((c) => [c.id, c]));
  return {
    list: q.data?.categories ?? [],
    color: (id: string | undefined) => { const c = byId.get(id ?? '') ?? byId.get('other'); return c ? (dark ? c.colorDark : c.color) : 'var(--ink-3)'; },
    label: (id: string | undefined) => { const c = byId.get(id ?? ''); return c ? c.label[t.lang] : id ?? ''; },
  };
}

/** Notes opened lately, kept on this browser only. */
const RECENT = 'okb-recent-notes';
export type Recent = { path: string; title: string; category?: string; at: string };
export function recentNotes(): Recent[] {
  try { return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as Recent[]).slice(0, 12); } catch { return []; }
}
export function rememberNote(r: Omit<Recent, 'at'>): void {
  try {
    const list = [{ ...r, at: new Date().toISOString() }, ...recentNotes().filter((x) => x.path !== r.path)].slice(0, 12);
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch { /* private window */ }
}
