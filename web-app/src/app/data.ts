import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useT } from './i18n';

/** Note categories, each with its emoji and its colour for light or dark. */
export type Category = { id: string; emoji: string; label: { fr: string; en: string }; color: string; colorDark: string; count?: number };

export function useCategories() {
  const t = useT();
  const q = useQuery({ queryKey: ['categories'], queryFn: () => get<{ categories: Category[] }>('/api/categories'), staleTime: 60_000 });
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.mode === 'dark';
  const byId = new Map((q.data?.categories ?? []).map((c) => [c.id, c]));
  return {
    list: q.data?.categories ?? [],
    color: (id: string | undefined) => { const c = byId.get(id ?? '') ?? byId.get('other'); return c ? (dark ? c.colorDark : c.color) : 'var(--ink-3)'; },
    label: (id: string | undefined) => { const c = byId.get(id ?? ''); return c ? c.label[t.lang] : id ?? ''; },
    emoji: (id: string | undefined) => byId.get(id ?? '')?.emoji ?? '📄',
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

/** Each drawer of a brain has its colour, for its number in the side lists. */
export const DRAWER_COLOR: Readonly<Record<string, string>> = { inbox: '#64748b', world: '#0891b2', subjects: '#2563eb', toolbox: '#059669', activity: '#7c3aed' };
export const DRAWER_BY_NUMBER: readonly string[] = ['inbox', 'world', 'subjects', 'toolbox', 'activity'];
