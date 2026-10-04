import { OkbError } from '../util/errors.js';
import { findSecretsDeep, type SecretFinding } from './secrets.js';

export function secretError(findings: ReadonlyArray<SecretFinding & { at: string }>, what: string): OkbError {
  const where = findings.slice(0, 5).map((f) => `${f.kind} at ${f.at} (${f.masked})`).join('; ');
  return new OkbError('E_SECRET', `${what} would write a credential-shaped string into the knowledge bundle: ${where}`, {
    key: 'secret', params: { what, where: findings.slice(0, 3).map((f) => `${f.kind} (${f.masked})`).join(', ') },
    detail: { findings: findings.map(({ kind, at, line, masked }) => ({ kind, at, line, masked })) },
    hint: 'OKB never stores secrets. Leave the passage out of the dossier, or write a placeholder such as <API_KEY>; if it is a real key, revoke it.',
  });
}

/** Refuse before anything is saved: nothing credential-shaped enters a proposal. */
export function assertNoSecrets(value: unknown, what: string): void {
  const findings = findSecretsDeep(value);
  if (findings.length) throw secretError(findings, what);
}
