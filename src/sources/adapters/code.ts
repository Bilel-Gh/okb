import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../util/hash.js';
import {
  buildOutline,
  makeBlock,
  type Acquired,
  type Adapter,
  type Block,
  type NormalizedDoc,
  type SourceRecord,
} from '../types.js';

/**
 * Source code and configuration read as text.
 *
 * The point is to let a note say "this is where it happens" with a verbatim
 * excerpt and a line range. Nothing is executed, compiled or type-checked: a
 * quote from code proves what the file says at this hash, not how it behaves.
 */
const CODE_EXT =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|java|kt|kts|scala|go|rs|rb|php|cs|c|h|cc|cpp|hpp|swift|sh|bash|zsh|ps1|sql|abap|cds|json|jsonc|ya?ml|toml|xml|gradle|vue|svelte|css|scss|prisma|graphql|gql|proto)$/i;

/** A block stops growing past either bound, at a line boundary. */
const MAX_LINES = 50;
const MAX_CHARS = 3500;

const DECLARATION =
  /^\s*(?:export\s+(?:default\s+)?)?(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|def|func|fn|struct|trait|impl|module|namespace|model|message|service|METHOD|FORM|CLASS)\s+([A-Za-z_$][\w$]*)/;
const COMMENT_OR_DECORATOR = /^\s*(\/\/|\/\*|\*|#|@|"""|''')/;

export const codeAdapter: Adapter = {
  name: 'code',
  version: '3',
  kind: 'code',

  matches(input: Acquired): boolean {
    return CODE_EXT.test(input.filename ?? '');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    const limitations: string[] = [];
    const bytes = Buffer.from(input.bytes);
    let blocks: Block[] = [];
    if (bytes.includes(0)) {
      limitations.push('the file contains NUL bytes; binary content is not read as code');
    } else {
      blocks = segment(bytes.toString('utf8'), sourceId);
      if (blocks.length === 0) limitations.push('the file contained no non-blank line');
    }

    const source: SourceRecord = {
      id: sourceId,
      uri: input.uri,
      kind: 'code',
      adapter: codeAdapter.name,
      adapterVersion: codeAdapter.version,
      sha256: sha256(input.bytes),
      bytes: input.bytes.byteLength,
      acquiredAt: new Date().toISOString(),
      support: blocks.length === 0 ? 'unsupported' : 'full',
      limitations,
      title: displayName(input),
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };
    return { source, blocks, outline: buildOutline(blocks) };
  },
};

/**
 * Split at blank lines that are followed by a top-level (unindented) line, so a
 * function keeps its inner blank lines and its leading comment. Long runs are
 * cut again on line boundaries; line numbers stay exact.
 */
export function segment(text: string, sourceId: string): Block[] {
  const lines = text.split('\n');
  const runs: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const blank = lines[i]!.trim() === '';
    if (blank) {
      if (start === null) continue;
      const next = lines.slice(i + 1).findIndex((l) => l.trim() !== '');
      const nextLine = next === -1 ? null : lines[i + 1 + next]!;
      if (nextLine === null || !/^\s/.test(nextLine)) {
        runs.push({ start, end: lastNonBlank(lines, i - 1) });
        start = null;
      }
      continue;
    }
    if (start === null) start = i;
  }
  if (start !== null) runs.push({ start, end: lastNonBlank(lines, lines.length - 1) });

  const blocks: Block[] = [];
  // A long function is cut into several blocks; the later ones keep the name of
  // the declaration they continue instead of picking up a local variable.
  let enclosing: string | undefined;
  for (const run of runs) {
    let from = run.start;
    while (from <= run.end) {
      let to = from;
      let chars = lines[from]!.length + 1;
      while (to + 1 <= run.end && to + 1 - from < MAX_LINES && chars + lines[to + 1]!.length + 1 <= MAX_CHARS) {
        to += 1;
        chars += lines[to]!.length + 1;
      }
      const slice = lines.slice(from, to + 1);
      const own = symbolOf(slice);
      if (own) enclosing = own;
      const symbol = own ?? enclosing;
      blocks.push(
        makeBlock(sourceId, blocks.length, 'code', slice.join('\n'), {
          kind: 'line',
          line: from + 1,
          endLine: to + 1,
          ...(symbol ? { symbol } : {}),
        }, symbol ? { section: [symbol] } : {}),
      );
      from = to + 1;
    }
  }
  return blocks;
}

function lastNonBlank(lines: readonly string[], from: number): number {
  let i = from;
  while (i > 0 && lines[i]!.trim() === '') i -= 1;
  return i;
}

/** Only a top-level (unindented) declaration names a block. */
function symbolOf(slice: readonly string[]): string | undefined {
  for (const line of slice.slice(0, 8)) {
    if (line.trim() === '' || COMMENT_OR_DECORATOR.test(line)) continue;
    return /^\s/.test(line) ? undefined : DECLARATION.exec(line)?.[1];
  }
  return undefined;
}

/** The package name when there is one: it survives a renamed or versioned folder. */
function projectName(dir: string): string {
  try {
    const name = (JSON.parse(readFileSync(`${dir}${sep}package.json`, 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string' && /^[@\w./-]+$/.test(name)) return name;
  } catch {
    // no package.json, or not JSON: fall back to the folder name
  }
  return basename(dir);
}

/**
 * "okb/src/apply/apply.ts" reads better in a footnote than "apply.ts", and it
 * avoids recording the absolute home path of the person who imported it.
 */
function displayName(input: Acquired): string {
  const fallback = input.filename ?? 'source';
  if (!input.uri.startsWith('file:')) return fallback;
  const abs = fileURLToPath(input.uri);
  let dir = dirname(abs);
  for (let depth = 0; depth < 12; depth++) {
    if (['package.json', '.git', 'pyproject.toml', 'go.mod', 'pom.xml', 'Cargo.toml'].some((m) => existsSync(`${dir}${sep}${m}`))) {
      return `${projectName(dir)}/${relative(dir, abs).split(sep).join('/')}`;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback;
}
