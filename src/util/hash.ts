import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Short, collision-resistant-enough id for human-facing handles (proposals, runs). */
export function shortId(seed?: string): string {
  const material = seed ?? randomBytes(16).toString('hex');
  return sha256(material).slice(0, 12);
}

export function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function newSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Canonical JSON so that a hash over a structure is stable across key ordering.
 * Arrays keep their order; objects are key-sorted.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function hashStructure(value: unknown): string {
  return sha256(canonicalJson(value));
}
