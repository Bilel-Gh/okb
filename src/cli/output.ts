import { has, t } from '../i18n/index.js';
import { Cancelled, isOkbError } from '../util/errors.js';
import { truncationNotice, type Truncation } from '../util/context-meter.js';
import { box, paint, sym, table, type Tone } from './ui/term.js';

export type OutputMode = 'text' | 'json';
export type Verbosity = 'quiet' | 'normal' | 'verbose';

let verbosity: Verbosity = 'normal';
export function setVerbosity(v: Verbosity): void {
  verbosity = v;
}

/**
 * Everything a command prints goes through here: plain lines for scripts,
 * symbols and colours for people, one JSON document for machines. Warnings
 * that do not stop the command are kept for the end, so results stay together.
 */
export class Output {
  private readonly deferred: string[] = [];

  constructor(
    private readonly mode: OutputMode,
    private readonly write: (text: string) => void = (s) => process.stdout.write(s),
  ) {}

  get isText(): boolean {
    return this.mode === 'text';
  }

  line(text = ''): void {
    if (this.mode === 'text') this.write(`${text}\n`);
  }

  /** Plain aligned columns (stable for scripts and tests). */
  table(rows: readonly (readonly string[])[]): void {
    if (this.mode !== 'text' || rows.length === 0) return;
    this.line(table(rows, { border: false }));
  }

  /** A rounded table for people. */
  grid(rows: readonly (readonly string[])[], head?: readonly string[]): void {
    if (this.mode !== 'text' || rows.length === 0) return;
    this.line(table(rows, { ...(head ? { head } : {}) }));
  }

  json(value: unknown): void {
    this.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  ok(text: string): void { if (verbosity !== 'quiet') this.line(`${sym.ok()} ${text}`); }
  info(text: string): void { if (verbosity !== 'quiet') this.line(`${sym.info()} ${text}`); }
  warn(text: string): void { this.line(`${sym.warn()} ${paint.warn(text)}`); }
  tip(text: string): void { if (verbosity !== 'quiet') this.line(`${sym.tip()} ${paint.dim(text)}`); }
  fail(text: string): void { this.line(`${sym.err()} ${paint.err(text)}`); }
  heading(text: string): void { if (verbosity !== 'quiet') this.line(`\n${paint.bold(text)}`); }
  detail(text: string): void { if (verbosity === 'verbose') this.line(paint.dim(text)); }
  box(lines: readonly string[], title?: string, tone: Tone = 'plain'): void {
    if (this.mode === 'text' && lines.length) this.line(box(lines, { ...(title ? { title } : {}), tone }));
  }

  /** "Next step" lines: the exact commands, at most three. */
  next(steps: readonly string[]): void {
    if (this.mode !== 'text' || !steps.length || verbosity === 'quiet') return;
    this.line();
    this.line(paint.bold(steps.length === 1 ? t('ui.nextStep') : t('ui.nextSteps')));
    for (const s of steps.slice(0, 3)) this.line(`  ${sym.arrow()} ${paint.code(s)}`);
  }

  /** A warning shown after the result rather than in the middle of it. */
  later(text: string): void {
    this.deferred.push(text);
  }

  flush(): void {
    if (this.mode !== 'text' || !this.deferred.length) return;
    this.line();
    for (const w of this.deferred.splice(0)) this.warn(w);
  }

  /** Bounded output always says how to get the rest. */
  truncation(tr: Truncation, command: string): void {
    const notice = truncationNotice(tr, command);
    if (notice) this.line(paint.dim(notice));
  }
}

/** One readable error: what happened, why, what to do, then the code for reference. */
export function renderError(error: unknown): string {
  if (error instanceof Cancelled) return `${paint.dim(t('ui.cancelledNothing'))}\n`;
  if (!isOkbError(error)) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    return `${sym.err()} ${paint.bold(t('err.internal.title'))}\n  ${t('err.internal.why')}\n${paint.dim(message)}\n`;
  }
  const keyed = error.key && has(`err.${error.key}.title`);
  const params = { ...error.params, message: error.message };
  const title = keyed ? t(`err.${error.key}.title`, params) : t(`code.${error.code}.title`);
  const why = keyed && has(`err.${error.key}.why`) ? t(`err.${error.key}.why`, params) : error.message;
  const fix = keyed && has(`err.${error.key}.fix`) ? t(`err.${error.key}.fix`, params) : error.hint ?? (has(`code.${error.code}.fix`) ? t(`code.${error.code}.fix`) : '');
  const lines = [`${sym.err()} ${paint.bold(title)}`, `  ${why}`];
  if (fix) lines.push(`  ${sym.arrow()} ${fix}`);
  const detail = Object.keys(error.detail).length ? JSON.stringify(error.detail) : '';
  if (detail && verbosity === 'verbose') lines.push(paint.dim(`  ${detail}`));
  lines.push(paint.dim(`  ${error.code} · okb explain ${error.code}${keyed && verbosity === 'verbose' ? ` · ${error.message}` : ''}`));
  return `${lines.join('\n')}\n`;
}

export function reportError(error: unknown, mode: OutputMode): number {
  if (mode === 'json') {
    if (isOkbError(error)) process.stdout.write(`${JSON.stringify({ ok: false, error: error.toJSON() }, null, 2)}\n`);
    else if (error instanceof Cancelled) process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'E_CANCELLED', message: 'cancelled' } }, null, 2)}\n`);
    else process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message: error instanceof Error ? error.stack ?? error.message : String(error) } }, null, 2)}\n`);
  } else {
    process.stderr.write(renderError(error));
  }
  if (error instanceof Cancelled) return 130;
  return isOkbError(error) ? exitCodeFor(error.code) : 70;
}

function exitCodeFor(code: string): number {
  switch (code) {
    case 'E_CONFIG':
      return 78;
    case 'E_NOT_FOUND':
      return 66;
    case 'E_UNSUPPORTED':
      return 69;
    case 'E_FORBIDDEN_PATH':
    case 'E_NOT_APPROVED':
    case 'E_APPROVAL_MISMATCH':
      return 77;
    case 'E_STALE':
    case 'E_CONFLICT':
      return 75;
    default:
      return 65;
  }
}
