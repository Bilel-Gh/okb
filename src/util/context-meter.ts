import { OkbError } from './errors.js';
/**
 * Context accounting.
 *
 * Two different things get reported and must never be conflated:
 *  - `bytes`  — measured, exact UTF-8 byte count of what the product puts in front
 *               of the model.
 *  - `tokens` — estimated. No tokenizer ships with this product, so the estimate is
 *               a documented heuristic, flagged as such in every output.
 */
export type Measure = {
  readonly label: string;
  readonly bytes: number;
  readonly tokensEstimated: number;
  readonly kind: 'measured-bytes' | 'estimated-tokens';
};

export const TOKEN_ESTIMATE_DIVISOR = 3.8;

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / TOKEN_ESTIMATE_DIVISOR);
}

export function measure(label: string, text: string): Measure {
  return {
    label,
    bytes: Buffer.byteLength(text, 'utf8'),
    tokensEstimated: estimateTokens(text),
    kind: 'measured-bytes',
  };
}

export function totalMeasure(label: string, parts: readonly Measure[]): Measure {
  return {
    label,
    bytes: parts.reduce((a, p) => a + p.bytes, 0),
    tokensEstimated: parts.reduce((a, p) => a + p.tokensEstimated, 0),
    kind: 'measured-bytes',
  };
}

export type Truncation = {
  readonly truncated: boolean;
  readonly shown: number;
  readonly total: number;
  readonly nextCursor: string | null;
};

/** Bounded slice with a resumable cursor, so a truncated answer stays recoverable. */
export function paginate<T>(
  items: readonly T[],
  opts: { limit: number; cursor?: string | null },
): { page: T[]; truncation: Truncation } {
  const start = opts.cursor ? Number(opts.cursor) : 0;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(opts.limit) || opts.limit < 1) throw new OkbError('E_INVALID', 'cursor and limit must be valid nonnegative / positive integers');
  const safeStart = Math.max(0, Math.min(start, items.length));
  const page = items.slice(safeStart, safeStart + opts.limit);
  const end = safeStart + page.length;
  return {
    page,
    truncation: {
      truncated: end < items.length,
      shown: page.length,
      total: items.length,
      nextCursor: end < items.length ? String(end) : null,
    },
  };
}

export function truncationNotice(t: Truncation, command: string): string | null {
  if (!t.truncated) return null;
  return `[okb:truncated shown=${t.shown} total=${t.total} resume="${command} --cursor ${t.nextCursor}"]`;
}
