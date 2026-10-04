import * as clack from '@clack/prompts';
import { t } from '../../i18n/index.js';
import { Cancelled } from '../../util/errors.js';
import { sym } from './term.js';

/**
 * Questions with choices, for people at a terminal. Never for an agent: Claude's
 * Bash tool has no TTY, `--json`, `--yes`, CI and `OKB_NO_INTERACTIVE` turn it
 * off, and every command keeps a non-interactive form with flags.
 */
let forcedOff = false;
export function disableInteraction(): void {
  forcedOff = true;
}

export function interactive(): boolean {
  if (forcedOff || process.env.OKB_NO_INTERACTIVE || process.env.CI) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

let localized = false;
function localize(): void {
  if (localized) return;
  localized = true;
  clack.updateSettings({ messages: { cancel: t('ui.cancelled'), error: t('ui.error') } });
}

function check<T>(value: unknown): T {
  if (clack.isCancel(value)) {
    clack.cancel(t('ui.cancelled'));
    throw new Cancelled();
  }
  return value as T;
}

export type Choice<V> = { value: V; label: string; hint?: string; recommended?: boolean };

/** Arrow-key choice; the recommended option is starred and selected first. */
export async function choose<V>(message: string, choices: readonly Choice<V>[], initial?: V): Promise<V> {
  localize();
  const first = initial ?? choices.find((c) => c.recommended)?.value ?? choices[0]?.value;
  const options = choices.map((c) => ({
    value: c.value,
    label: c.recommended ? `${c.label}  ${sym.star()}` : c.label,
    ...(c.hint ? { hint: c.hint } : {}),
  }));
  return check<V>(await clack.select<V>({ message, options: options as never, initialValue: first }));
}

export async function chooseMany<V>(message: string, choices: readonly Choice<V>[], initial: readonly V[]): Promise<V[]> {
  localize();
  const options = choices.map((c) => ({ value: c.value, label: c.label, ...(c.hint ? { hint: c.hint } : {}) }));
  return check<V[]>(await clack.multiselect<V>({ message, options: options as never, initialValues: [...initial], required: false }));
}

export async function confirm(message: string, initial = true): Promise<boolean> {
  localize();
  return check<boolean>(await clack.confirm({ message, initialValue: initial, active: t('ui.yes'), inactive: t('ui.no') }));
}

export async function input(message: string, options: { initial?: string; placeholder?: string; validate?: (v: string) => string | undefined } = {}): Promise<string> {
  localize();
  const value = check<string>(await clack.text({
    message,
    ...(options.initial !== undefined ? { initialValue: options.initial } : {}),
    ...(options.placeholder !== undefined ? { placeholder: options.placeholder } : {}),
    ...(options.validate ? { validate: (v: string | undefined) => options.validate!(v ?? '') } : {}),
  }));
  return value.trim();
}

export async function search<V>(message: string, choices: readonly Choice<V>[]): Promise<V> {
  localize();
  const options = choices.map((c) => ({ value: c.value, label: c.label, ...(c.hint ? { hint: c.hint } : {}) }));
  return check<V>(await clack.autocomplete<V>({ message, options: options as never, maxItems: 12 }));
}

export const intro = (title: string) => { localize(); clack.intro(title); };
export const outro = (text: string) => clack.outro(text);
export const note = (text: string, title?: string) => clack.note(text, title);
export const step = {
  info: (text: string) => clack.log.info(text),
  ok: (text: string) => clack.log.success(text),
  warn: (text: string) => clack.log.warn(text),
  err: (text: string) => clack.log.error(text),
  message: (text: string) => clack.log.message(text),
};

/** A spinner on a terminal, nothing elsewhere. */
export function spin(text: string): { done: (end?: string) => void; fail: (end?: string) => void } {
  if (!interactive()) return { done: () => undefined, fail: () => undefined };
  const s = clack.spinner();
  s.start(text);
  return { done: (end) => s.stop(end ?? text), fail: (end) => s.error(end ?? text) };
}
