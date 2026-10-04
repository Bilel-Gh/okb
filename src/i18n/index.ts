import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { EN } from './en.js';
import { FR } from './fr.js';

/**
 * Interface language: menus, messages, errors, the local reader. It is a
 * person's setting, kept in `~/.okb/config.yaml` (`ui.language`), separate
 * from the language the notes of a KB are written in (`profile.answer.language`).
 * Machine output (`--json`) never changes with it.
 */
export type Lang = 'fr' | 'en';
export const UI_LANGUAGES: readonly Lang[] = ['fr', 'en'];
export type MessageKey = keyof typeof EN;
type Params = Readonly<Record<string, string | number>>;

const CATALOGS: Record<Lang, Readonly<Record<string, string>>> = { en: EN, fr: FR };
let current: Lang | null = null;

function fromLocale(value: string | undefined | null): Lang | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v || v === 'c' || v === 'posix') return null;
  return v.startsWith('fr') ? 'fr' : 'en';
}

let systemCache: Lang | null | undefined;
/** The system's language: environment first, then macOS's own setting. */
export function systemLanguage(env: NodeJS.ProcessEnv = process.env): Lang {
  const fromEnv = fromLocale(env.LC_ALL) ?? fromLocale(env.LC_MESSAGES) ?? fromLocale(env.LANG);
  if (fromEnv) return fromEnv;
  if (systemCache === undefined) {
    systemCache = null;
    if (process.platform === 'darwin') {
      try {
        systemCache = fromLocale(execFileSync('defaults', ['read', '-g', 'AppleLocale'], { encoding: 'utf8', timeout: 800, stdio: ['ignore', 'pipe', 'ignore'] }));
      } catch { /* not available: fall through */ }
    }
  }
  return systemCache ?? fromLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en';
}

/** `ui.language` from the OKB home, `auto` when unset. */
export function configuredLanguage(env: NodeJS.ProcessEnv = process.env): Lang | 'auto' {
  try {
    const home = env.OKB_HOME ? resolve(env.OKB_HOME) : resolve(homedir(), '.okb');
    const root = YAML.parse(readFileSync(resolve(home, 'config.yaml'), 'utf8')) as { ui?: { language?: unknown } } | null;
    const value = root?.ui?.language;
    return value === 'fr' || value === 'en' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function resolveLanguage(env: NodeJS.ProcessEnv = process.env): Lang {
  const forced = fromLocale(env.OKB_LANG);
  if (forced) return forced;
  const configured = configuredLanguage(env);
  return configured === 'auto' ? systemLanguage(env) : configured;
}

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function lang(): Lang {
  if (current === null) current = resolveLanguage();
  return current;
}

/** Translate a message; `{name}` placeholders take `params`. Unknown keys fall back to English, then to the key. */
export function t(key: MessageKey | string, params: Params = {}): string {
  const text = CATALOGS[lang()][key] ?? EN[key as MessageKey] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function has(key: string): boolean {
  return key in CATALOGS[lang()] || key in EN;
}

/** Plural helper: `{n}` is filled; keys `<key>.one` / `<key>.other`. */
export function tn(key: string, n: number, params: Params = {}): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000], ['month', 30 * 86_400_000], ['week', 7 * 86_400_000],
  ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
];

/** "il y a 2 h", "in 3 days": relative to now, in the interface language. */
export function relativeTime(date: Date | string, now: Date = new Date()): string {
  const at = typeof date === 'string' ? new Date(date) : date;
  const diff = at.getTime() - now.getTime();
  const format = new Intl.RelativeTimeFormat(lang() === 'fr' ? 'fr-FR' : 'en-GB', { numeric: 'auto', style: 'short' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return lang() === 'fr' ? "à l'instant" : 'just now';
}

/** "4 oct. 2026, 01:54" in the interface language and the machine's time zone. */
export function formatDate(date: Date | string): string {
  const at = typeof date === 'string' ? new Date(date) : date;
  return at.toLocaleString(lang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Language names for the writing-language question. */
export const WRITING_LANGUAGES: readonly { code: string; fr: string; en: string }[] = [
  { code: 'fr', fr: 'Français', en: 'French' },
  { code: 'en', fr: 'Anglais', en: 'English' },
  { code: 'es', fr: 'Espagnol', en: 'Spanish' },
  { code: 'de', fr: 'Allemand', en: 'German' },
  { code: 'it', fr: 'Italien', en: 'Italian' },
  { code: 'pt', fr: 'Portugais', en: 'Portuguese' },
];

export function languageName(code: string): string {
  const entry = WRITING_LANGUAGES.find((l) => l.code === code.toLowerCase().slice(0, 2));
  return entry ? entry[lang()] : code;
}
