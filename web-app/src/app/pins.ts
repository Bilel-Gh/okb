import { useSyncExternalStore } from 'react';

/**
 * Per-browser conveniences of the explorer: notes pinned at the top of the tree,
 * and views (a set of filters) saved under a name. Kept in this browser only;
 * a private window simply starts empty.
 */
export type Pin = { path: string; title: string; category?: string };
export type SavedView = { id: string; name: string; query: Record<string, string> };

const PINS = 'okb-pinned-notes';
const VIEWS = 'okb-brain-views';
const EVENT = 'okb-pins';

function load<T>(key: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown; return Array.isArray(v) ? (v as T[]) : []; } catch { return []; }
}
// Only when the browser refuses to store: the list then lasts for this visit.
const memory = new Map<string, unknown[]>();
function save<T>(key: string, list: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); memory.delete(key); } catch { memory.set(key, list); }
  window.dispatchEvent(new Event(EVENT));
}
const snapshot = new Map<string, { raw: string; value: unknown[] }>();
function read<T>(key: string): T[] {
  const value = (memory.get(key) as T[] | undefined) ?? load<T>(key);
  const raw = JSON.stringify(value);
  const prev = snapshot.get(key);
  if (prev && prev.raw === raw) return prev.value as T[];
  snapshot.set(key, { raw, value });
  return value;
}
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
};

export function usePins(): Pin[] {
  return useSyncExternalStore(subscribe, () => read<Pin>(PINS), () => []);
}
export function isPinned(pins: readonly Pin[], path: string): boolean {
  return pins.some((p) => p.path === path);
}
export function togglePin(pin: Pin): boolean {
  const pins = read<Pin>(PINS);
  const on = !pins.some((p) => p.path === pin.path);
  save(PINS, on ? [pin, ...pins].slice(0, 30) : pins.filter((p) => p.path !== pin.path));
  return on;
}

export function useSavedViews(): SavedView[] {
  return useSyncExternalStore(subscribe, () => read<SavedView>(VIEWS), () => []);
}
export function saveView(name: string, query: Record<string, string>): void {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v));
  save(VIEWS, [...read<SavedView>(VIEWS), { id: `v-${Date.now().toString(36)}`, name: name.trim().slice(0, 60), query: clean }].slice(-20));
}
export function removeView(id: string): void {
  save(VIEWS, read<SavedView>(VIEWS).filter((v) => v.id !== id));
}
