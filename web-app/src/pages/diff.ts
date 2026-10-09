/** A unified diff as lines to read: added, removed, unchanged, and a mark where the diff jumps ahead. */
export type DiffLine = { kind: 'add' | 'del' | 'ctx' | 'gap'; text: string };

export function diffLines(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let hunks = 0;
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\ ')) continue;
    if (line.startsWith('@@')) { if (hunks++ > 0) out.push({ kind: 'gap', text: '' }); continue; }
    if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1) });
    else out.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return out;
}
