import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { provenanceOf, sourceStates } from '../src/kb/provenance.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { sha256 } from '../src/util/hash.js';
import type { BundlePath } from '../src/util/paths.js';
import { demoBrain } from './helpers/brain.js';

const HASH = 'a'.repeat(64);
const note = (lines: string[]) => `---\n${lines.join('\n')}\n---\n\n# Titre\n\nTexte.\n`;
async function put(kb: string, path: string, text: string) {
  await mkdir(dirname(resolve(kb, path)), { recursive: true });
  await writeFile(resolve(kb, path), text);
}

describe('sources and validity of a note (F2.0-27)', () => {
  it('says who wrote it, when, from which sources, and until when it holds', async () => {
    const { config, kb } = await demoBrain();
    await put(kb, '2 Produits/Export.md', note([
      'type: Guide', 'title: Export', 'description: x', 'stale_after: 2020-01-01',
      'generated:', '  by: okb/1.0', '  at: 2026-10-04T09:00:00Z',
      'sources:',
      '  - id: reunion', `    resource: urn:sha256:${HASH}`, '    title: Réunion du 3 octobre',
      '  - id: reunion-b1', `    resource: urn:sha256:${HASH}`, '    title: Réunion du 3 octobre', '    x_okb_claim_kind: reported',
      '  - id: reunion-c1', `    resource: urn:sha256:${HASH}`, '    title: Réunion du 3 octobre', '    x_okb_claim_kind: reported',
      '  - id: page', '    resource: https://example.com/doc', '    title: La documentation',
    ]));
    const p = await provenanceOf(config, await loadBundleFor(config), '2 Produits/Export.md' as BundlePath, new Date('2026-10-10T00:00:00Z'));
    expect(p.writtenBy).toBe('ai');
    expect(p.writtenAt).toBe('2026-10-04T09:00:00.000Z');
    expect(p.sources).toEqual([
      { title: 'Réunion du 3 octobre', resource: `urn:sha256:${HASH}`, kind: 'local', claims: 2 },
      { title: 'La documentation', resource: 'https://example.com/doc', kind: 'web', claims: 0 },
    ]);
    expect(p.staleAfter).toBe('2020-01-01');
    expect(p.stale).toBe(true);
    expect(p.approved).toBeNull();
  });

  it('a note the person wrote says so, and a note without sources has none', async () => {
    const { config, kb } = await demoBrain();
    await put(kb, '2 Produits/Main.md', note(['type: Guide', 'title: Main', 'description: x', 'generated:', '  by: human:test', '  at: 2026-09-01T10:00:00Z']));
    const p = await provenanceOf(config, await loadBundleFor(config), '2 Produits/Main.md' as BundlePath);
    expect(p).toMatchObject({ writtenBy: 'person', sources: [], stale: false, staleAfter: null });
  });

  it('the approval comes from the receipt of the change that wrote the note', async () => {
    const { config, kb } = await demoBrain();
    await put(kb, '2 Produits/Export.md', note(['type: Guide', 'title: Export', 'description: x']));
    const state = statePaths(config);
    await ensureState(state);
    const receipt = (id: string, at: string, extra: Record<string, unknown> = {}) => writeFile(resolve(state.receipts, `${id}.json`), JSON.stringify({
      id, proposalId: 'p-1', kbRoot: config.kb.root, appliedAt: at, complete: true, approval: { approvedBy: 'human:test', approvedAt: at },
      results: [{ path: '2 Produits/Export.md', action: 'created', sha256: 'x' }], ...extra,
    }));
    await receipt('r-old', '2026-10-01T10:00:00.000Z');
    await receipt('r-new', '2026-10-04T10:00:00.000Z');
    await receipt('r-undone', '2026-10-05T10:00:00.000Z', { rolledBack: true });
    const p = await provenanceOf(config, await loadBundleFor(config), '2 Produits/Export.md' as BundlePath);
    expect(p.approved).toEqual({ at: '2026-10-04T10:00:00.000Z' });
  });

  it('a local source that changed since it was read is seen; an unknown one is not guessed', async () => {
    const { config, dir } = await demoBrain();
    const state = statePaths(config);
    await ensureState(state);
    const source = resolve(dir, 'reunion.txt');
    await writeFile(source, 'première version');
    const read = sha256('première version');
    await mkdir(resolve(state.runs, 'run-1'), { recursive: true });
    await writeFile(resolve(state.runs, 'run-1', 'checkpoint.json'), JSON.stringify({ sourceSha256: read, sourceUri: `file://${source}` }));
    expect((await sourceStates(config, [read, HASH])).get(read)).toBe('unchanged');
    await writeFile(source, 'deuxième version');
    const after = await sourceStates(config, [read, HASH]);
    expect(after.get(read)).toBe('changed');
    expect(after.get(HASH)).toBe('unknown');
  });

  it('reading a note through the engine gives its sources and validity', async () => {
    const { config, env, kb } = await demoBrain();
    await put(kb, '2 Produits/Export.md', note(['type: Guide', 'title: Export', 'description: x', 'generated:', '  by: okb/1.0', '  at: 2026-10-04T09:00:00Z']));
    const read = await invoke('notes.read', { path: '2 Produits/Export.md' }, { config, env, actor: 'agent' });
    expect(read.provenance).toMatchObject({ writtenBy: 'ai', sources: [] });
  });
});
