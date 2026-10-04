/** Error codes are part of the CLI contract: callers branch on them, not on messages. */
export type OkbErrorCode =
  | 'E_CONFIG'
  | 'E_NOT_FOUND'
  | 'E_UNSUPPORTED'
  | 'E_EXTRACTION'
  | 'E_STALE'
  | 'E_FORBIDDEN_PATH'
  | 'E_NOT_APPROVED'
  | 'E_APPROVAL_MISMATCH'
  | 'E_CONFLICT'
  | 'E_INVALID'
  | 'E_SECRET'
  | 'E_IO'
  | 'E_INTERNAL';

export class OkbError extends Error {
  readonly code: OkbErrorCode;
  readonly detail: Record<string, unknown>;
  readonly hint: string | undefined;
  /**
   * Catalogue entry for people (`err.<key>.title|why|fix` in src/i18n). The
   * English `message` and `hint` stay the stable machine contract (`--json`).
   */
  readonly key: string | undefined;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(
    code: OkbErrorCode,
    message: string,
    options: { detail?: Record<string, unknown>; hint?: string; cause?: unknown; key?: string; params?: Record<string, string | number> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OkbError';
    this.code = code;
    this.detail = options.detail ?? {};
    this.hint = options.hint;
    this.key = options.key;
    this.params = options.params ?? {};
  }

  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail, hint: this.hint, ...(this.key ? { key: this.key } : {}) };
  }
}

/** Raised when a person leaves an interactive question (Esc, Ctrl+C). */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

export function isOkbError(value: unknown): value is OkbError {
  return value instanceof OkbError;
}
