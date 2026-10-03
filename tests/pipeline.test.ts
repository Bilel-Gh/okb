import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { loadBundle } from '../src/kb/bundle.js';
import { checkLinks } from '../src/links/check.js';
import { ask } from '../src/pipeline/ask.js';
import { checkpointIsUsable, loadCheckpoint, saveCheckpoint } from '../src/pipeline/checkpoint.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { saveProposal } from '../src/proposal/store.js';
import { maintain } from '../src/maintain/maintain.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { asBundlePath } from '../src/util/paths.js';
import { FIXTURE_SOURCES, makeSandbox, type Sandbox } from './helpers/sandbox.js';
import type { OkbConfig } from '../src/config/schema.js';
import type { NormalizedDoc } from '../src/sources/types.js';
import type { Proposal } from '../src/proposal/model.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function env(profileId = 'alpha') {
  const s = await makeSandbox({ profileId });
  sandboxes.push(s);
  return { s, config: await s.config() };
}

async function source(config: OkbConfig, file: string): Promise<NormalizedDoc> {
  return extractSource(await acquire(resolve(FIXTURE_SOURCES, file), config), config);
}

async function approveAndApply(config: OkbConfig, proposal: Proposal, only?: string[]) {
  const selection = only ?? proposal.changes.map((c) => c.id);
  await saveProposal(config, proposal);
  await grantApproval(config, proposal, selection, 'human:testuser');
  return applyProposal(config, proposal, only ? { only } : {});
}

describe('ingest pipeline', () => {
  it('prepares a proposal and writes nothing', async () => {
    const { s, config } = await env();
    const before = await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8');

    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync notes' },
    });

    expect(report.proposal.status).toBe('prepared');
    expect(report.proposal.changes.length).toBeGreaterThan(1);
    expect(await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8')).toBe(before);
  });

  it('records the extraction limits and the claim kind of every excerpt', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'fleet-article.html'), {
      target: { mode: 'create', path: asBundlePath('flows/fleet-article.md'), title: 'Fleet article' },
    });

    expect(report.proposal.notes.join(' ')).toContain('heuristic');
    expect(report.proposal.notes.join(' ')).toContain('nothing was invented');
    expect(report.proposal.evidence.every((e) => e.claimKind === 'reported')).toBe(true);
    expect(report.proposal.evidence[0]?.locator).toBeTruthy();
  });

  it('marks everything it creates as draft', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'create', path: asBundlePath('flows/sync.md'), title: 'Sync' },
    });
    for (const change of report.proposal.changes) {
      if (change.kind !== 'create-document') continue;
      expect(change.createDocument!.content).toContain('status: draft');
    }
  });

  it('adds nothing on a second import of the same source', async () => {
    const { s, config } = await env();
    const doc = await source(config, 'weekly-sync.vtt');
    const target = { mode: 'append' as const, path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync notes' };

    const first = await prepareProposal(config, doc, { target });
    await approveAndApply(config, first.proposal);
    const afterFirst = await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8');
    expect(afterFirst).toContain('# Weekly sync notes');

    const second = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), { target });
    expect(second.skipped.some((x) => x.reason === 'already-ingested')).toBe(true);
    expect(second.proposal.changes).toEqual([]);
    expect(second.proposal.notes.join(' ')).toContain('--reprocess');
  });

  it('reprocesses on demand after a change of method', async () => {
    const { config } = await env();
    const doc = await source(config, 'weekly-sync.vtt');
    const target = { mode: 'append' as const, path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync notes' };

    const first = await prepareProposal(config, doc, { target });
    await approveAndApply(config, first.proposal);

    const forced = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target,
      reprocess: true,
    });
    expect(forced.proposal.changes.some((c) => c.id === 'c-article')).toBe(true);
  });

  it('surfaces a contradiction between the source and an existing card', async () => {
    const { s, config } = await env();
    await writeFile(
      resolve(s.vault, 'concepts', 'drx.md'),
      [
        '---',
        'type: Concept',
        'title: DRX',
        'description: The Acme routing component.',
        'status: stable',
        'generated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }',
        '---',
        '',
        'DRX is the Depot Resource eXecutor, the component that drains the depot queue.',
        '',
      ].join('\n'),
    );
    const fresh = await env();
    void fresh;

    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync notes' },
    });

    const contradiction = report.proposal.contradictions.find((c) => c.path === 'concepts/drx.md');
    expect(contradiction).toBeDefined();
    expect(contradiction!.resolution).toBe('undecided');
    expect(contradiction!.existingClaim).toContain('Depot Resource eXecutor');
    expect(contradiction!.incomingClaim).toContain('Delivery Routing eXchange');
  });

  it('keeps a late correction visible in the proposed section', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'create', path: asBundlePath('flows/sync.md'), title: 'Sync' },
    });
    const article = report.proposal.changes.find((c) => c.id === 'c-article')!;
    expect(article.createDocument!.content).toContain('Corrections et exceptions');
    expect(article.createDocument!.content).toContain('is not a pipeline');
  });

  it('produces a bundle whose links still check out after apply', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'dispatcher-notes.md'), {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Dispatcher notes' },
    });
    await approveAndApply(config, report.proposal);

    const bundle = await loadBundle(config.kb.root);
    const links = checkLinks(bundle.snapshot, { renderers: config.kb.renderers, brokenTargetsAre: 'error' });
    expect(links.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('stays OKF-conformant after an ingest', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync' },
    });
    await approveAndApply(config, report.proposal);

    const maintained = await maintain(config);
    expect(maintained.okfConformant).toBe(true);
  });
});

describe('resumable extraction', () => {
  it('refuses to resume when the source or the extractor changed', async () => {
    const { config } = await env();
    const doc = await source(config, 'weekly-sync.vtt');

    await saveCheckpoint(config, {
      runId: 'run-1',
      sourceUri: doc.source.uri,
      sourceSha256: doc.source.sha256,
      adapter: doc.source.adapter,
      adapterVersion: doc.source.adapterVersion,
      totalBlocks: doc.blocks.length,
      cursor: 3,
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      carry: { note: 'half way' },
    });

    const loaded = (await loadCheckpoint(config, 'run-1'))!;
    expect(loaded.cursor).toBe(3);
    expect(loaded.carry).toEqual({ note: 'half way' });

    expect(
      checkpointIsUsable(loaded, {
        sha256: doc.source.sha256,
        adapter: doc.source.adapter,
        adapterVersion: doc.source.adapterVersion,
      }).usable,
    ).toBe(true);

    expect(
      checkpointIsUsable(loaded, { sha256: 'other', adapter: 'vtt', adapterVersion: '1' }),
    ).toMatchObject({ usable: false, reason: expect.stringContaining('source bytes changed') });

    expect(
      checkpointIsUsable(loaded, { sha256: doc.source.sha256, adapter: 'vtt', adapterVersion: '2' }),
    ).toMatchObject({ usable: false, reason: expect.stringContaining('changed version') });
  });
});

describe('ask', () => {
  it('returns located evidence and refuses to answer when nothing matches', async () => {
    const { config } = await env();

    const hit = await ask(config, 'dispatcher idempotence retry');
    expect(hit.hits.length).toBeGreaterThan(0);
    expect(hit.evidence.length).toBeGreaterThan(0);
    expect(hit.evidence[0]!.path).toBeTruthy();
    expect(hit.evidence[0]!.line).toBeGreaterThan(0);

    const miss = await ask(config, 'quantum submarine pricing');
    expect(miss.hits).toEqual([]);
    expect(miss.notes.join(' ')).toContain('no answer is better than an invented one');
  });

  it('flags draft and unverified matches instead of presenting them as facts', async () => {
    const { config } = await env();
    const result = await ask(config, 'telemetry channel');
    expect(result.hits.some((h) => h.status === 'draft')).toBe(true);
    expect(result.notes.join(' ')).toContain('draft');
  });

  it('finds content ingested in an earlier session', async () => {
    const { config } = await env();
    const report = await prepareProposal(config, await source(config, 'weekly-sync.vtt'), {
      target: { mode: 'create', path: asBundlePath('flows/weekly-sync.md'), title: 'Weekly sync' },
    });
    await approveAndApply(config, report.proposal);

    // A new session re-reads from disk; nothing is carried in memory.
    const fresh = await ask(config, 'Delivery Routing eXchange queue broker');
    expect(fresh.hits.map((h) => h.path)).toContain('flows/weekly-sync.md');
  });

  it('bounds its output and says how to get the rest', async () => {
    const { config } = await env();
    const page = await ask(config, 'dispatcher robot job depot delivery', { limit: 1 });
    expect(page.hits).toHaveLength(1);
    expect(page.truncation.truncated).toBe(true);
    expect(page.truncation.nextCursor).toBe('1');

    const next = await ask(config, 'dispatcher robot job depot delivery', {
      limit: 1,
      cursor: page.truncation.nextCursor,
    });
    expect(next.hits[0]!.path).not.toBe(page.hits[0]!.path);
  });
});
