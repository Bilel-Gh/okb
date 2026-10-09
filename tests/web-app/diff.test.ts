import { describe, expect, it } from 'vitest';
import { diffLines } from '../../web-app/src/pages/diff.js';

describe('a change to read, line by line', () => {
  it('keeps added, removed and unchanged lines, drops the file headers and marks the jumps', () => {
    const text = ['--- a/x.md', '+++ b/x.md', '@@ -1,3 +1,3 @@', ' Les messages', '-Un message peut arriver deux fois.', '+Un message peut arriver deux fois : chaque traitement est idempotent.', '@@ -10,2 +10,2 @@', ' fin', ''].join('\n');
    expect(diffLines(text)).toEqual([
      { kind: 'ctx', text: 'Les messages' },
      { kind: 'del', text: 'Un message peut arriver deux fois.' },
      { kind: 'add', text: 'Un message peut arriver deux fois : chaque traitement est idempotent.' },
      { kind: 'gap', text: '' },
      { kind: 'ctx', text: 'fin' },
    ]);
  });

  it('shows a new note as all added lines', () => {
    expect(diffLines('+# Titre\n+\n+Texte')).toEqual([{ kind: 'add', text: '# Titre' }, { kind: 'add', text: '' }, { kind: 'add', text: 'Texte' }]);
  });
});
