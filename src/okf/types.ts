/**
 * OKF v0.2 data model.
 *
 * Pinned revision of the specification this implementation targets:
 *   repo   https://github.com/GoogleCloudPlatform/knowledge-catalog
 *   file   okf/SPEC.md
 *   version declared by the document: 0.2
 *   pinned commit: see OKF_SPEC_PIN below
 *
 * Everything the spec does not define lives under the single `x_okb` frontmatter
 * key (see extensions.ts). Those are product extensions, not OKF fields.
 */

export const OKF_VERSION = '0.2' as const;

export const OKF_SPEC_PIN = {
  version: '0.2',
  repository: 'https://github.com/GoogleCloudPlatform/knowledge-catalog',
  path: 'okf/SPEC.md',
  commit: '62432a095456147ee71e70ac6e4dc0d2dea3ac30',
  sha256: '26aa5da029278939f914e578107242d9607d4f2dc5fe153272b82f9ed1030101',
  retrievedAt: '2026-10-02T00:00:00Z',
} as const;

/** `index.md` and `log.md` have defined meaning and are never concept documents. */
export const RESERVED_FILENAMES = ['index.md', 'log.md'] as const;

export type OkfStatus = 'draft' | 'stable' | 'deprecated';

export type OkfActor = string;

export type OkfTimestamped = {
  by: OkfActor;
  at?: string;
};

export type OkfSource = {
  /** Stable footnote key; required by the product whenever the body cites the source. */
  id?: string;
  /** REQUIRED by the spec within an entry. URL, bundle path, or scope descriptor. */
  resource: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
  usage_window?: { from?: string; to?: string };
  [key: string]: unknown;
};

export type OkfFrontmatter = {
  /** The only always-required key (spec §4.1). */
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  status?: OkfStatus | string;
  stale_after?: string;
  generated?: OkfTimestamped;
  verified?: OkfTimestamped | OkfTimestamped[];
  sources?: OkfSource[];
  usage_window?: { from?: string; to?: string };
  /** Attested Computation family (spec §10) — carried through, not interpreted. */
  runtime?: string;
  parameters?: unknown[];
  computation?: string;
  executor?: unknown;
  attester?: unknown;
  /** Unknown producer keys MUST survive a round-trip (spec §4.1 "Extensions"). */
  [key: string]: unknown;
};

export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed';

/** Spec §5.3. A bare mapping counts as a one-element list. */
export function trustTier(fm: OkfFrontmatter): TrustTier {
  const v = fm.verified;
  if (v === undefined || v === null) return 'unverified';
  const list = (Array.isArray(v) ? v : [v]).filter(e => e && isValidActor(e.by));
  if (list.length === 0) return 'unverified';
  return list.some((e) => typeof e?.by === 'string' && e.by.startsWith('human:'))
    ? 'human-reviewed'
    : 'machine-confirmed';
}

export function verifiedList(fm: OkfFrontmatter): OkfTimestamped[] {
  const v = fm.verified;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Spec §5.4: absent status means `stable`. */
export function effectiveStatus(fm: OkfFrontmatter): OkfStatus {
  const s = fm.status;
  return s === 'draft' || s === 'deprecated' ? s : 'stable';
}

export function isStale(fm: OkfFrontmatter, now: Date = new Date()): boolean {
  if (typeof fm.stale_after !== 'string') return false;
  const t = Date.parse(fm.stale_after);
  return Number.isFinite(t) && now.getTime() >= t;
}

const ACTOR_RE = /^(human:[^\s/]+|process:[^\s/]+|[^\s/]+\/[^\s]+)$/;

export function isValidActor(actor: unknown): actor is OkfActor {
  return typeof actor === 'string' && ACTOR_RE.test(actor);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Spec §5: every timestamp key is ISO 8601 with an explicit offset. */
export function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

export function nowIso(): string {
  return `${new Date().toISOString().replace(/\.\d{3}Z$/, '')}Z`;
}
