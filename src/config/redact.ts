const SECRET_KEY_RE =
  /(secret|token|password|passwd|apikey|api_key|credential|cookie|authorization|private_key|bearer)/i;

const SECRET_VALUE_RE = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:sk|pk)-[A-Za-z0-9]{20,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export const REDACTED = '«redacted»';

/**
 * Strip anything that looks like a credential before a config is printed or
 * written to a log. Key-name matching catches the structured cases, pattern
 * matching catches a token pasted into a free-text field.
 */
export function redact<T>(value: T): T {
  return redactValue(value, false) as T;
}

function redactValue(value: unknown, parentIsSecret: boolean): unknown {
  if (typeof value === 'string') {
    if (parentIsSecret) return REDACTED;
    let out = value;
    for (const re of SECRET_VALUE_RE) out = out.replace(re, REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, parentIsSecret));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, parentIsSecret || SECRET_KEY_RE.test(k));
    }
    return out;
  }
  return value;
}

/** Home directories leak the operator's identity; keep paths readable without it. */
export function anonymizeHome(text: string, home: string): string {
  if (!home) return text;
  return text.split(home).join('~');
}
