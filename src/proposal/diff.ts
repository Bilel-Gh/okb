/** Minimal unified diff. Keeping it in-tree avoids a dependency for one screen of output. */

type Op = { kind: 'equal' | 'insert' | 'delete'; line: string };

function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Memory guard: fall back to a whole-block replace on very large files.
  if (n * m > 4_000_000) {
    return [
      ...a.map((line) => ({ kind: 'delete' as const, line })),
      ...b.map((line) => ({ kind: 'insert' as const, line })),
    ];
  }
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', line: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: 'delete', line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'insert', line: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: 'delete', line: a[i++]! });
  while (j < m) ops.push({ kind: 'insert', line: b[j++]! });
  return ops;
}

export type DiffStats = { added: number; removed: number };

export function unifiedDiff(
  before: string,
  after: string,
  options: { path: string; context?: number } = { path: 'file' },
): { text: string; stats: DiffStats } {
  const context = options.context ?? 3;
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const ops = lcsOps(a, b);

  const stats: DiffStats = {
    added: ops.filter((o) => o.kind === 'insert').length,
    removed: ops.filter((o) => o.kind === 'delete').length,
  };
  if (stats.added === 0 && stats.removed === 0) return { text: '', stats };

  const lines: string[] = [`--- a/${options.path}`, `+++ b/${options.path}`];
  let aLine = 1;
  let bLine = 1;
  let buffer: string[] = [];
  let hunkA = 0;
  let hunkB = 0;
  let hunkCountA = 0;
  let hunkCountB = 0;
  let pendingContext: { text: string }[] = [];
  let inHunk = false;

  const flush = () => {
    if (!inHunk) return;
    lines.push(`@@ -${hunkA},${hunkCountA} +${hunkB},${hunkCountB} @@`);
    lines.push(...buffer);
    buffer = [];
    inHunk = false;
    hunkCountA = 0;
    hunkCountB = 0;
  };

  for (const op of ops) {
    if (op.kind === 'equal') {
      if (inHunk) {
        pendingContext.push({ text: ` ${op.line}` });
        if (pendingContext.length > context * 2) {
          for (const c of pendingContext.slice(0, context)) {
            buffer.push(c.text);
            hunkCountA += 1;
            hunkCountB += 1;
          }
          pendingContext = [];
          flush();
        }
      } else {
        pendingContext.push({ text: ` ${op.line}` });
        if (pendingContext.length > context) pendingContext.shift();
      }
      aLine += 1;
      bLine += 1;
      continue;
    }

    if (!inHunk) {
      inHunk = true;
      hunkA = Math.max(1, aLine - pendingContext.length);
      hunkB = Math.max(1, bLine - pendingContext.length);
      for (const c of pendingContext) {
        buffer.push(c.text);
        hunkCountA += 1;
        hunkCountB += 1;
      }
    } else {
      for (const c of pendingContext) {
        buffer.push(c.text);
        hunkCountA += 1;
        hunkCountB += 1;
      }
    }
    pendingContext = [];

    if (op.kind === 'delete') {
      buffer.push(`-${op.line}`);
      hunkCountA += 1;
      aLine += 1;
    } else {
      buffer.push(`+${op.line}`);
      hunkCountB += 1;
      bLine += 1;
    }
  }

  if (inHunk) {
    for (const c of pendingContext.slice(0, context)) {
      buffer.push(c.text);
      hunkCountA += 1;
      hunkCountB += 1;
    }
    flush();
  }

  return { text: lines.join('\n'), stats };
}
