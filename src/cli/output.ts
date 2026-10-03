import { isOkbError } from '../util/errors.js';
import { truncationNotice, type Truncation } from '../util/context-meter.js';

export type OutputMode = 'text' | 'json';

export class Output {
  private readonly lines: string[] = [];

  constructor(
    private readonly mode: OutputMode,
    private readonly write: (text: string) => void = (t) => process.stdout.write(t),
  ) {}

  line(text = ''): void {
    if (this.mode === 'text') this.write(`${text}\n`);
    else this.lines.push(text);
  }

  table(rows: readonly (readonly string[])[]): void {
    if (this.mode !== 'text' || rows.length === 0) return;
    const widths: number[] = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i] ?? 0, cell.length);
      });
    }
    for (const row of rows) {
      this.line(row.map((cell, i) => cell.padEnd(i === row.length - 1 ? 0 : widths[i]!)).join('  ').trimEnd());
    }
  }

  json(value: unknown): void {
    this.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  /** Bounded output always says how to get the rest. */
  truncation(t: Truncation, command: string): void {
    const notice = truncationNotice(t, command);
    if (notice) this.line(notice);
  }
}

export function reportError(error: unknown, mode: OutputMode): number {
  if (isOkbError(error)) {
    if (mode === 'json') {
      process.stdout.write(`${JSON.stringify({ ok: false, error: error.toJSON() }, null, 2)}\n`);
    } else {
      process.stderr.write(`okb: ${error.code}: ${error.message}\n`);
      if (error.hint) process.stderr.write(`  hint: ${error.hint}\n`);
      const detail = Object.keys(error.detail).length > 0 ? error.detail : null;
      if (detail) process.stderr.write(`  detail: ${JSON.stringify(detail)}\n`);
    }
    return exitCodeFor(error.code);
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'E_INTERNAL', message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`okb: unexpected failure\n${message}\n`);
  }
  return 70;
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
