import { useT } from './i18n';

/** F2.1: the same local objects as the sharing engine; all writes remain explicit. */
export type SharedHit = { drawer: string; by: string; path: string; title: string; snippet: string; score: number };
export type SharedIssue = { code: string; key?: string; message: string };
export type SharePreview = {
  previewHash: string;
  leaving: { path: string; title: string; markdown: string }[];
  held: { path: string; title: string; reason: 'secret' | 'private' | 'holds-secret' | 'career' }[];
  removed: { path: string; title: string }[];
};
export type ShareStatus = { ready: false } | {
  ready: true; folder: string; drawer: string; allowedAt: string; git: boolean; remote: string | null; marked: string[]; leaving: number;
  held: SharePreview['held']; drawers: { drawer: string; name: string; person: string; notes: number; updatedAt: string; mine: boolean }[];
};
export type SharedNote = { drawer: string; by: string; path: string; title: string; description: string; markdown: string; html: string };
export type BrainMap = { drawer: string; by: string; both: { path: string; title: string }[]; mine: { path: string; title: string }[]; theirs: { path: string; title: string }[]; holes: { term: string }[]; fromThem: { term: string; path: string }[] };
export type CommonTerm = { term: string; definitions: { by: string | null; drawer: string | null; definition: string; path: string }[] };

/** Kept beside the interface until these new messages join the server catalogue. */
export function useShareWords() {
  const t = useT();
  return (fr: string, en: string) => t.lang === 'en' ? en : fr;
}
