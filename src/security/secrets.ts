/**
 * Credential-shaped strings must never reach a knowledge bundle: a quotation is
 * copied verbatim, so a key pasted in a transcript, a README or a course would
 * otherwise land in a note that may be synced or shared. Detection favours
 * precision (known token formats, explicit `key = value` assignments with a
 * realistic value) so placeholders such as `<API_KEY>` or `sk-...` pass.
 */
export type SecretFinding = {
  readonly kind: string;
  /** 1-based line inside the scanned text. */
  readonly line: number;
  /** Never the secret itself: kind-specific prefix, ellipsis and length. */
  readonly masked: string;
};

type Pattern = { kind: string; re: RegExp; group?: number };

/** Formats that are credentials whatever surrounds them. */
export const TOKEN_PATTERNS: readonly Pattern[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'api-key', re: /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{24,}\b/g },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const ASSIGNMENT: Pattern = {
  kind: 'assigned-secret',
  re: /\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret|auth[_-]?token)\b["']?\s*[:=]\s*["'`]?([^\s"'`,;)}\]]{12,})/gi,
  group: 1,
};

const URL_CREDENTIALS: Pattern = { kind: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s/@]{6,})@[^\s/]+/gi, group: 1 };

const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3}|<[^>]*>|\$\{?[A-Za-z_]|%[A-Za-z_]|\{\{|process\.env|os\.environ|env\(|getenv)|your[_-]?|example|changeme|placeholder|redacted|dummy|sample|fake|xxxx|\.\.\.|<|>|\$\{|«/i;

/** A realistic secret value mixes character classes; prose and identifiers rarely do. */
function looksLikeSecretValue(value: string): boolean {
  if (PLACEHOLDER.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (!/[0-9]/.test(value)) return false;
  return classes >= 3 || (classes >= 2 && value.length >= 20);
}

function mask(kind: string, value: string): string {
  const head = kind === 'private-key' ? '-----BEGIN' : value.slice(0, Math.min(4, Math.floor(value.length / 4)));
  return `${head}…(${value.length} chars)`;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** `sk-xxxxxxxx…`, `AKIA0000…`: documentation placeholders shaped like a token. */
const FILLER = /(.)\1{5,}|x{4,}|X{4,}|example|your|dummy|placeholder|1234567890|abcdef/i;

export function findSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = [];
  const seen = new Set<number>();
  for (const { kind, re } of TOKEN_PATTERNS) {
    for (const m of text.matchAll(re)) {
      seen.add(m.index);
      if (kind !== 'private-key' && FILLER.test(m[0])) continue;
      found.push({ kind, line: lineOf(text, m.index), masked: mask(kind, m[0]) });
    }
  }
  for (const { kind, re, group } of [ASSIGNMENT, URL_CREDENTIALS]) {
    for (const m of text.matchAll(re)) {
      const value = m[group ?? 0] ?? '';
      const at = m.index + m[0].lastIndexOf(value);
      if (seen.has(at) || !looksLikeSecretValue(value)) continue;
      if ([...seen].some((s) => s >= m.index && s < m.index + m[0].length)) continue;
      found.push({ kind, line: lineOf(text, at), masked: mask(kind, value) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Every string inside a JSON-like value, with a readable path to where it sits. */
export function findSecretsDeep(value: unknown, path = ''): Array<SecretFinding & { at: string }> {
  if (typeof value === 'string') return findSecrets(value).map((f) => ({ ...f, at: path || '(text)' }));
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretsDeep(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => findSecretsDeep(v, path ? `${path}.${k}` : k));
  }
  return [];
}
