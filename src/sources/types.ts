import type { SourceKind } from '../config/schema.js';

export type Locator =
  | { readonly kind: 'timecode'; readonly startMs: number; readonly endMs: number }
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'section'; readonly path: readonly string[]; readonly line?: number }
  | { readonly kind: 'line'; readonly line: number };

export function formatLocator(loc: Locator): string {
  switch (loc.kind) {
    case 'timecode':
      return `${msToClock(loc.startMs)}–${msToClock(loc.endMs)}`;
    case 'page':
      return `p.${loc.page}`;
    case 'section':
      return loc.path.length > 0 ? loc.path.join(' › ') : `l.${loc.line ?? 1}`;
    case 'line':
      return `l.${loc.line}`;
  }
}

export function msToClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'code'
  | 'quote'
  | 'cue'
  | 'table';

export type Block = {
  readonly id: string;
  readonly index: number;
  readonly kind: BlockKind;
  readonly text: string;
  readonly locator: Locator;
  readonly speaker?: string;
  readonly part?: { readonly index: number; readonly total: number };
  /** Heading trail, so a quote can be placed inside a long document. */
  readonly section?: readonly string[];
};

export type SupportLevel = 'full' | 'partial' | 'unsupported';

export type SourceRecord = {
  readonly id: string;
  readonly uri: string;
  readonly kind: SourceKind | 'unknown';
  readonly adapter: string;
  readonly adapterVersion: string;
  /** Fingerprint of the acquired bytes; drives re-processing decisions. */
  readonly sha256: string;
  readonly bytes: number;
  readonly acquiredAt: string;
  readonly support: SupportLevel;
  /** What the extraction could not do. Never empty when support !== 'full'. */
  readonly limitations: readonly string[];
  readonly title?: string;
  readonly contentType?: string;
};

export type NormalizedDoc = {
  readonly source: SourceRecord;
  readonly blocks: readonly Block[];
  readonly outline: readonly { readonly depth: number; readonly text: string; readonly blockId: string }[];
};

export type Acquired = {
  readonly uri: string;
  readonly bytes: Uint8Array;
  readonly contentType?: string;
  readonly filename?: string;
};

export type Adapter = {
  readonly name: string;
  readonly version: string;
  readonly kind: SourceKind;
  /** Cheap check used for routing; the real decision is made by `extract`. */
  matches(input: Acquired): boolean;
  extract(input: Acquired, sourceId: string): Promise<NormalizedDoc>;
};

export function makeBlock(
  sourceId: string,
  index: number,
  kind: BlockKind,
  text: string,
  locator: Locator,
  extra: { speaker?: string; section?: readonly string[] } = {},
): Block {
  return {
    id: `${sourceId}#${index}`,
    index,
    kind,
    text,
    locator,
    ...(extra.speaker ? { speaker: extra.speaker } : {}),
    ...(extra.section ? { section: extra.section } : {}),
  };
}

export function buildOutline(blocks: readonly Block[]): NormalizedDoc['outline'] {
  return blocks
    .filter((b) => b.kind === 'heading')
    .map((b) => ({ depth: (b.section?.length ?? 1), text: b.text, blockId: b.id }));
}
