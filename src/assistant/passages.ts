import { meaningQuery, roots } from '../find/meaning.js';

/** Ranked verbatim windows over the whole note. Neighbours preserve conditions and late corrections. */
export type LocatedPassage = { text: string; start: number; end: number; startLine: number; endLine: number };
export function locatedPassages(body: string, question: string, limit = 4000): LocatedPassage[] {
  const locate = (start: number, end: number): LocatedPassage => ({ text: body.slice(start, end), start, end, startLine: body.slice(0, start).split('\n').length, endLine: body.slice(0, end).split('\n').length });
  if (body.length <= limit) return [locate(0, body.length)];
  const terms = new Set(meaningQuery(question));
  const windows: { start: number; end: number; score: number }[] = [];
  // Fixed overlapping windows also handle one enormous paragraph or code block.
  const width = Math.min(1400, limit);
  for (let start = 0; start < body.length; start += Math.max(1, Math.round(width * 0.57))) {
    const end = Math.min(body.length, start + width);
    const matched = new Set(roots(body.slice(start, end)).filter((r) => terms.has(r)));
    const correction = /correction|rectification|rejet[eé]|remplac[eé]|supersed|instead|final/i.test(body.slice(start, end));
    windows.push({ start, end, score: matched.size + (matched.size && correction ? 0.25 : 0) });
  }
  const selected: typeof windows = [];
  for (const window of windows.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (selected.some((s) => window.start < s.end && window.end > s.start)) continue;
    if (!window.score && selected.length) break;
    if (selected.reduce((n, s) => n + s.end - s.start, 0) + window.end - window.start > limit) continue;
    selected.push(window);
    if (selected.length >= 2) break;
  }
  return selected.sort((a, b) => a.start - b.start).map((w) => locate(w.start, w.end));
}
/** Display framing is separate from the raw windows used to validate citations. */
export function relevantPassages(body: string, question: string, limit = 4000): string {
  return locatedPassages(body, question, Math.max(1, limit - 20)).map((w) => `${w.start ? '…\n' : ''}${w.text}${w.end < body.length ? '\n…' : ''}`).join('\n\n');
}
