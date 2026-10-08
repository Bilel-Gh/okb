import { createContext, useContext } from 'react';

/**
 * OKB's messages come from the server (`/api/i18n`): the same catalogue as the
 * terminal, in French or English.
 */
export type Messages = Record<string, string>;
export type Translate = ((key: string, params?: Record<string, string | number>) => string) & { lang: 'fr' | 'en'; has: (key: string) => boolean };

export function makeT(messages: Messages, lang: 'fr' | 'en'): Translate {
  const fn = ((key: string, params: Record<string, string | number> = {}) => {
    const text = messages[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  }) as Translate;
  fn.lang = lang;
  fn.has = (key) => key in messages;
  return fn;
}

export function tn(t: Translate, key: string, n: number, params: Record<string, string | number> = {}): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

export const I18n = createContext<Translate>(makeT({}, 'fr'));
export const useT = () => useContext(I18n);
