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

  constructor(
    code: OkbErrorCode,
    message: string,
    options: { detail?: Record<string, unknown>; hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OkbError';
    this.code = code;
    this.detail = options.detail ?? {};
    this.hint = options.hint;
  }

  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail, hint: this.hint };
  }
}

export function isOkbError(value: unknown): value is OkbError {
  return value instanceof OkbError;
}
