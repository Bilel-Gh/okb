import { useSyncExternalStore } from 'react';

export type Toast = { id: number; text: string; kind: 'info' | 'err' };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let next = 1;

function emit() { for (const l of listeners) l(); }

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = next++;
  toasts = [...toasts, { id, text, kind }].slice(-4);
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, kind === 'err' ? 7000 : 3500);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
}
