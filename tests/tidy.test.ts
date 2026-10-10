import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toTidy } from '../src/brain/tidy.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { demoBrain } from './helpers/brain.js';

const note = (title: string, body: string) => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}.\n---\n\n# ${title}\n\n${body}\n`;
async function put(kb: string, path: string, text: string) {
  await mkdir(dirname(resolve(kb, path)), { recursive: true });
  await writeFile(resolve(kb, path), text);
}

describe('notes to tidy, seen at a glance in the graph (F2.0-19)', () => {
  it('an isolated note has no link to or from another note, its breadcrumb aside; a misplaced one sits outside the drawers', async () => {
    const { config, kb } = await demoBrain();
    await put(kb, '3 Boîte à outils/Seule.md', note('Seule', '🧭 [Boîte à outils](Boîte%20à%20outils.md)\n\nPersonne ne me cite.'));
    await put(kb, '3 Boîte à outils/Citée.md', note('Citée', 'On me cite.'));
    await put(kb, '3 Boîte à outils/Cite.md', note('Cite', 'Voir [Citée](Cit%C3%A9e.md).'));
    await put(kb, 'vrac/Ailleurs.md', note('Ailleurs', 'Voir [Citée](../3%20Bo%C3%AEte%20%C3%A0%20outils/Cit%C3%A9e.md).'));
    const tidy = toTidy(config, await loadBundleFor(config));
    expect(tidy.isolated.map((n) => n.path)).toContain('3 Boîte à outils/Seule.md');
    expect(tidy.isolated.map((n) => n.path)).not.toContain('3 Boîte à outils/Citée.md');
    expect(tidy.isolated.map((n) => n.path)).not.toContain('3 Boîte à outils/Cite.md');
    expect(tidy.misplaced).toEqual([{ path: 'vrac/Ailleurs.md', title: 'Ailleurs' }]);
  });
});
