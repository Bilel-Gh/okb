import { mkdtemp, rm, unlink, utimes, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSettled, loadBundle } from '../src/kb/bundle.js';
import type { BundlePath } from '../src/util/paths.js';

const note = (title: string, body = 'Texte.') => `---\ntype: Guide\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const p = (x: string) => x as BundlePath;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'okb-rev-'));
  await mkdir(join(root, 'a'), { recursive: true });
  await writeFile(join(root, 'a', 'one.md'), note('One'));
  await writeFile(join(root, 'a', 'two.md'), note('Two'));
  await writeFile(join(root, 'a', 'image.png'), 'png');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('reading a KB by revision (F2.0-22)', () => {
  it('a KB that did not change is not read again: the same bundle comes back', async () => {
    const first = await loadBundle(root);
    const second = await loadBundle(root);
    expect(second).toBe(first);
  });

  it('only the changed note is read again; the others keep their parsed document', async () => {
    const first = await loadBundle(root);
    await writeFile(join(root, 'a', 'one.md'), note('One, changed'));
    const second = await loadBundle(root);
    expect(second).not.toBe(first);
    expect(second.byPath.get(p('a/one.md'))?.title).toBe('One, changed');
    expect(second.docs.get(p('a/two.md'))).toBe(first.docs.get(p('a/two.md')));
    expect(second.snapshot.files.get(p('a/one.md'))).toContain('One, changed');
  });

  it('a note added or deleted is seen at the next read', async () => {
    await loadBundle(root);
    await writeFile(join(root, 'a', 'three.md'), note('Three'));
    await unlink(join(root, 'a', 'two.md'));
    const next = await loadBundle(root);
    expect(next.entries.map((e) => e.path).sort()).toEqual(['a/one.md', 'a/three.md']);
    expect(next.snapshot.files.has(p('a/two.md'))).toBe(false);
    expect(next.snapshot.files.has(p('a/image.png'))).toBe(true);
  });

  it('a rewrite of the same size whose modification time was put back is still seen', async () => {
    const file = join(root, 'a', 'one.md');
    const before = await stat(file);
    await loadBundle(root);
    await writeFile(file, note('Uno'));
    await utimes(file, before.atime, before.mtime);
    const next = await loadBundle(root);
    expect(next.byPath.get(p('a/one.md'))?.title).toBe('Uno');
  });

  it('requests that arrive together share one reading of each note', async () => {
    const all = await Promise.all([loadBundle(root), loadBundle(root), loadBundle(root)]);
    for (const b of all) expect(b.docs.get(p('a/one.md'))).toBe(all[0]!.docs.get(p('a/one.md')));
  });

  it('a different exclusion list is a different view of the KB', async () => {
    const all = await loadBundle(root);
    const some = await loadBundle(root, { exclude: ['a/two.md'] });
    expect(all.entries).toHaveLength(2);
    expect(some.entries.map((e) => e.path)).toEqual(['a/one.md']);
    expect((await loadBundle(root)).entries).toHaveLength(2);
  });

  it('an unreadable note stays reported until it is fixed', async () => {
    await writeFile(join(root, 'a', 'bad.md'), '---\ntitle: [unclosed\n---\nx');
    expect((await loadBundle(root)).unreadable.map((u) => u.path)).toEqual(['a/bad.md']);
    expect((await loadBundle(root)).unreadable.map((u) => u.path)).toEqual(['a/bad.md']);
    await writeFile(join(root, 'a', 'bad.md'), note('Fixed'));
    const fixed = await loadBundle(root);
    expect(fixed.unreadable).toEqual([]);
    expect(fixed.byPath.get(p('a/bad.md'))?.title).toBe('Fixed');
  });

  it('a fresh read checks every file on disk, and still reuses the notes whose text is unchanged', async () => {
    const first = await loadBundle(root);
    const fresh = await loadBundle(root, { fresh: true });
    expect(fresh.docs.get(p('a/two.md'))).toBe(first.docs.get(p('a/two.md')));
    expect(fresh.byPath.get(p('a/one.md'))?.title).toBe('One');
  });

  it('a file changed less than two seconds before it was seen is not trusted from its stamp', () => {
    expect(isSettled({ mtimeMs: 10_000, ctimeMs: 10_000 }, 10_500)).toBe(false);
    expect(isSettled({ mtimeMs: 10_000, ctimeMs: 11_900 }, 13_000)).toBe(false);
    expect(isSettled({ mtimeMs: 10_000, ctimeMs: 10_000 }, 12_500)).toBe(true);
  });
});
