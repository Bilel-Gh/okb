import { diffLines } from '../pages/diff';

/** A unified diff to read: added lines tinted green, removed ones red and struck, gaps marked. */
export function DiffView({ text }: { text: string }) {
  return (
    <div className="diff-body">
      {diffLines(text).map((l, i) => (
        <div key={i} className={`ln ${l.kind}`}>
          <em aria-hidden="true">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</em>
          <span>{l.kind === 'gap' ? '…' : l.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
