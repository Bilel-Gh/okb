import { randomBytes } from 'node:crypto';
import { readRootConfig, writeRootConfig } from '../kb/registry.js';

/**
 * Who acts, for teams to come: a stable identifier per person and the job they
 * declare (dev, devops, sales…). The identifier is random, made once on this
 * computer, and never taken from a name, an e-mail or the computer account.
 * Receipts and decisions carry it, so reputation and sharing can rely on it
 * later without rewriting history.
 */
export type Person = { readonly id: string; readonly role: string };

export const ROLES = ['', 'dev', 'devops', 'sales', 'product', 'other'] as const;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newPersonId(): string {
  const bytes = randomBytes(10);
  return `p-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

const VALID = /^p-[a-z0-9]{10}$/;

/** The person using this computer: the id is created and saved on first use. */
export async function person(env: NodeJS.ProcessEnv = process.env): Promise<Person> {
  const read = (root: unknown) => (root as { person?: { id?: unknown; role?: unknown } }).person ?? {};
  const current = read(await readRootConfig(env).catch(() => ({})));
  const role = typeof current.role === 'string' ? current.role : '';
  if (typeof current.id === 'string' && VALID.test(current.id)) return { id: current.id, role };
  let id = newPersonId();
  await writeRootConfig((root) => {
    const known = read(root);
    // Another OKB process may have made one meanwhile: keep the first.
    if (typeof known.id === 'string' && VALID.test(known.id)) id = known.id;
    return { ...root, person: { ...known, id } };
  }, env);
  return { id, role };
}
