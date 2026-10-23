import { useSyncExternalStore } from 'react';

export type Toast = { id: number; text: string; kind: 'info' | 'err'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let next = 1;

function emit() { for (const l of listeners) l(); }

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  const id = next++;
  toasts = [...toasts, { id, text, kind, ...(action ? { action } : {}) }].slice(-4);
  emit();
  // A toast that can be undone stays long enough to reach its button.
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, action ? 9000 : kind === 'err' ? 7000 : 3500);
}

/** Close a toast now (after its action ran). */
export function dismissToast(id: number): void { toasts = toasts.filter((t) => t.id !== id); emit(); }

export function useToasts(): Toast[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
}
