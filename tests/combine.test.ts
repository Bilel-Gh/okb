import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal, rollback } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { combineProposals } from '../src/proposal/combine.js';
import { buildNavigation } from '../src/nav/nav.js';
import { loadBundleFor, withPendingFiles } from '../src/kb/bundle.js';
import { buildConceptCard } from '../src/concepts/card.js';
import { materializeFile } from '../src/proposal/materialize.js';
import { saveProposal } from '../src/proposal/store.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { resolveStyle } from '../src/style/resolve.js';
import { asBundlePath, type BundlePath } from '../src/util/paths.js';
import type { OkbConfig } from '../src/config/schema.js';
import type { Proposal } from '../src/proposal/model.js';
import type { NormalizedDoc } from '../src/sources/types.js';
import { FIXTURE_SOURCES, makeSandbox, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(boxes.splice(0).map((s) => s.cleanup()));
});

async function setup() {
  const s = await makeSandbox({ profileId: 'builder', answerLanguage: 'fr', writing: { preset: 'pedagogique' } });
  boxes.push(s);
  const config = await s.config();
  const notes = await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'dispatcher-notes.md'), config), config);
  const code = await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'dispatch.ts'), config), config);
  return { s, config, notes, code };
}

function dossier(config: OkbConfig, doc: NormalizedDoc, claim: { id: string; text: string; quote: string }, extra: Record<string, unknown> = {}) {
  const block = doc.blocks.find((b) => b.text.includes(claim.quote))!;
  return {
    version: 2,
    sources: [doc.source.sha256],
    style: resolveStyle(config).style,
    reviewedBlockIds: doc.blocks.map((b) => b.id),
    sections: [{ heading: 'Essentiel', claims: [{ id: claim.id, text: claim.text, kind: 'reported', evidence: [{ blockId: block.id, quote: claim.quote }] }] }],
    ...extra,
  };
}

const pendingOf = (p: Proposal) => ({
  files: new Map<BundlePath, string>(p.changes.filter((c) => c.kind === 'create-document').map((c) => [c.path, materializeFile(c.path, null, p.changes.filter((x) => x.path === c.path))])),
  proposalIds: [p.id],
});

describe('proposals that build on each other', () => {
  async function pair() {
    const f = await setup();
    const first = (await prepareProposal(f.config, f.notes, {
      target: { mode: 'create', path: asBundlePath('guide/01-dispatcher.md'), title: 'Le répartiteur' },
      analysis: dossier(f.config, f.notes, { id: 'one-job', text: 'Un seul travail par robot.', quote: 'The dispatcher assigns one job per robot.' }),
      conceptAssistLevel: 'off',
    })).proposal;
    await saveProposal(f.config, first);
    const second = (await prepareProposal(f.config, f.code, {
      target: { mode: 'create', path: asBundlePath('guide/02-retries.md'), title: 'Rejouer une requête' },
      analysis: dossier(f.config, f.code, { id: 'same-key', text: 'La même clé renvoie le même travail.', quote: 'if (existing) return existing;' }, {
        related: [{ path: 'guide/01-dispatcher.md', relation: 'prerequisite' }],
      }),
      conceptAssistLevel: 'off',
      pending: pendingOf(first),
    })).proposal;
    await saveProposal(f.config, second);
    return { ...f, first, second };
  }

  it('links to a note that a pending proposal will create, and says so', async () => {
    const f = await pair();
    const content = f.second.changes.find((c) => c.id === 'c-article')!.createDocument!.content;
    expect(content).toContain('**À lire avant :** [Le répartiteur](01-dispatcher.md)');
    expect(f.second.notes.join('\n')).toContain('may link to 1 note(s) that other prepared proposals create');
  });

  it('refuses to apply the dependent proposal first, because its link would be broken', async () => {
    const f = await pair();
    await grantApproval(f.config, f.second, f.second.changes.map((c) => c.id), 'human:testuser');
    await expect(applyProposal(f.config, f.second)).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(readFile(resolve(f.s.vault, 'guide', '02-retries.md'))).rejects.toThrow();
  });

  it('applies a combined proposal with one approval and rolls it back as one', async () => {
    const f = await pair();
    const combined = combineProposals(f.config, [f.first, f.second]);
    expect(combined.changes.map((c) => c.id)).toEqual(['p1-c-article', 'p2-c-article']);
    await saveProposal(f.config, combined);
    await grantApproval(f.config, combined, combined.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(f.config, combined);
    expect(receipt.results.map((r) => r.path).sort()).toEqual(['guide/01-dispatcher.md', 'guide/02-retries.md']);
    expect(await readFile(resolve(f.s.vault, 'guide', '02-retries.md'), 'utf8')).toContain('](01-dispatcher.md)');
    await rollback(f.config, receipt.id);
    await expect(readFile(resolve(f.s.vault, 'guide', '01-dispatcher.md'))).rejects.toThrow();
  });

  it('keeps dependencies inside each part when only some changes are selected', async () => {
    const f = await pair();
    const combined = combineProposals(f.config, [f.first, f.second]);
    const renamed = combined.changes.find((c) => c.id === 'p2-c-article')!;
    expect(renamed.evidenceIds.every((id) => id.startsWith('p2-'))).toBe(true);
  });

  it('generates navigation that includes pending notes in file order, whatever their titles', async () => {
    const f = await pair();
    const pending = pendingOf(f.first);
    for (const [k, v] of pendingOf(f.second).files) pending.files.set(k, v);
    const files = await buildNavigation(f.config, { bundle: withPendingFiles(await loadBundleFor(f.config), pending.files) });
    const guide = files.find((x) => x.path === 'guide/index.md')!.content;
    expect(guide.indexOf('01-dispatcher.md')).toBeLessThan(guide.indexOf('02-retries.md'));
  });

  it('describes a concept card by its sourced definition', async () => {
    const f = await setup();
    const card = buildConceptCard({
      candidate: { surface: 'Retry key', canonical: 'retry key', kind: 'phrase', occurrences: 1, firstBlockId: f.code.blocks[1]!.id, evidenceBlockIds: [f.code.blocks[1]!.id], score: 10, resolution: { status: 'missing' }, rationale: 'test', expansionFromSource: { text: 'the key that identifies a replayed request', blockId: f.code.blocks[1]!.id } },
      doc: f.code, bundle: await loadBundleFor(f.config), config: f.config, path: asBundlePath('concepts/retry-key.md'),
    });
    expect(card.content).toContain('description: "Retry key : the key that identifies a replayed request."');
  });

  it('shows and cites every source a concept card quotes', async () => {
    const f = await setup();
    const notesBlock = f.notes.blocks.find((b) => b.text.includes('The dispatcher assigns one job per robot.'))!;
    const codeBlock = f.code.blocks.find((b) => b.text.includes('if (existing) return existing;'))!;
    const card = buildConceptCard({
      candidate: { surface: 'Dispatcher', canonical: 'dispatcher', kind: 'phrase', occurrences: 2, firstBlockId: notesBlock.id, evidenceBlockIds: [notesBlock.id, codeBlock.id], score: 10, resolution: { status: 'missing' }, rationale: 'test',
        expansionFromSource: { text: 'assigns one job per robot and returns the same job on retry', blockId: notesBlock.id },
        evidenceQuotes: [{ blockId: notesBlock.id, quote: 'The dispatcher assigns one job per robot.' }, { blockId: codeBlock.id, quote: 'if (existing) return existing;' }] },
      doc: f.notes, otherDocs: [f.code], bundle: await loadBundleFor(f.config), config: f.config, path: asBundlePath('concepts/dispatcher-2.md'),
    });
    expect(card.content).toContain('> if (existing) return existing;');
    expect(card.content.match(/^\s+- id: /gm)).toHaveLength(2);
    expect(card.content).toMatch(/\[\^dispatch-[0-9a-f]{10}\]: okb-0\.2\.0\/tests\/fixtures\/sources\/dispatch\.ts|\[\^dispatch-[0-9a-f]{10}\]: .*dispatch\.ts/);
  });

  it('refuses parts that touch the same file or are no longer pending', async () => {
    const f = await pair();
    expect(() => combineProposals(f.config, [f.first, f.first])).toThrow(/listed twice/);
    expect(() => combineProposals(f.config, [f.first, { ...f.second, baseline: { ...f.second.baseline, 'guide/01-dispatcher.md': null } }])).toThrow(/changed by both/);
    expect(() => combineProposals(f.config, [f.first, { ...f.second, status: 'applied' }])).toThrow(/only prepared/);
  });

  it('refuses to append to, or plan links into, a note that only exists in a pending proposal', async () => {
    const f = await pair();
    await expect(prepareProposal(f.config, f.code, {
      target: { mode: 'append', path: asBundlePath('guide/01-dispatcher.md'), heading: 'Code' },
      analysis: dossier(f.config, f.code, { id: 'k', text: 'x', quote: 'MAX_RETRIES' }),
      pending: pendingOf(f.first),
    })).rejects.toThrow(/only exists in a pending proposal/);
  });
});
