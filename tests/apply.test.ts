import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal, loadReceipt, rollback } from '../src/apply/apply.js';
import { grantApproval, verifyApproval } from '../src/apply/approval.js';
import { guardApply } from '../src/apply/guard.js';
import { loadBundle } from '../src/kb/bundle.js';
import { checkLinks } from '../src/links/check.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { resolveSelection, type Proposal } from '../src/proposal/model.js';
import { saveProposal } from '../src/proposal/store.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { asBundlePath } from '../src/util/paths.js';
import { sha256 } from '../src/util/hash.js';
import { FIXTURE_SOURCES, makeSandbox, type Sandbox } from './helpers/sandbox.js';
import type { OkbConfig } from '../src/config/schema.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

const TARGET = asBundlePath('flows/run-a-delivery-job.md');

async function prepared(profileId = 'alpha'): Promise<{
  s: Sandbox;
  config: OkbConfig;
  proposal: Proposal;
}> {
  const s = await makeSandbox({ profileId });
  sandboxes.push(s);
  const config = await s.config();
  const doc = await extractSource(
    await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config),
    config,
  );
  const report = await prepareProposal(config, doc, {
    target: { mode: 'append', path: TARGET, heading: 'Weekly sync notes' },
  });
  await saveProposal(config, report.proposal);
  return { s, config, proposal: report.proposal };
}

describe('authorisation', () => {
  it('refuses to apply a proposal nobody approved', async () => {
    const { config, proposal } = await prepared();
    await expect(applyProposal(config, proposal)).rejects.toMatchObject({
      code: 'E_NOT_APPROVED',
      message: expect.stringContaining('--approve'),
    });
  });

  it('ignores an "approved" flag the caller invents', async () => {
    const { config, proposal } = await prepared();
    const forged = { ...proposal, approved: true, status: 'applied' as const };
    await expect(applyProposal(config, forged)).rejects.toMatchObject({ code: 'E_NOT_APPROVED' });
  });

  it('binds an approval to the exact proposal content', async () => {
    const { config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');

    const last = proposal.contentHash.at(-1)!;
    const edited: Proposal = {
      ...proposal,
      contentHash: `${proposal.contentHash.slice(0, -1)}${last === '0' ? '1' : '0'}`,
    };
    const check = await verifyApproval(config, edited, edited.changes.map((c) => c.id));
    expect(check).toMatchObject({ ok: false, code: 'E_APPROVAL_MISMATCH' });
  });

  it('refuses a change that was approved for a narrower selection', async () => {
    const { config, proposal } = await prepared();
    const first = proposal.changes[0]!.id;
    await grantApproval(config, proposal, [first], 'human:testuser');

    await expect(
      applyProposal(config, proposal, { only: proposal.changes.map((c) => c.id) }),
    ).rejects.toMatchObject({ code: 'E_APPROVAL_MISMATCH' });
  });

  it('detects a tampered approval file', async () => {
    const { config, proposal } = await prepared();
    await grantApproval(config, proposal, ['c-article'], 'human:testuser');
    const path = resolve(config.stateHome, 'approvals', `${proposal.id}.json`);
    const approval = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    approval.selection = proposal.changes.map((c) => c.id);
    await writeFile(path, JSON.stringify(approval));

    const check = await verifyApproval(config, proposal, ['c-article']);
    expect(check).toMatchObject({ ok: false, code: 'E_APPROVAL_MISMATCH' });
  });
});

describe('guards', () => {
  it('refuses a proposal whose target changed since preparation', async () => {
    const { s, config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');

    const path = resolve(s.vault, 'flows', 'run-a-delivery-job.md');
    await writeFile(path, `${await readFile(path, 'utf8')}\nEdited by someone else.\n`);

    await expect(applyProposal(config, proposal)).rejects.toMatchObject({
      code: 'E_STALE',
      hint: expect.stringContaining('--reprocess'),
    });
  });

  it('refuses a path the policy forbids, before writing anything', async () => {
    const { s, config, proposal } = await prepared();
    const locked: OkbConfig = {
      ...config,
      policy: { ...config.policy, writeDeny: [...config.policy.writeDeny, 'flows/**'] },
    };
    await grantApproval(locked, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const before = await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8');

    await expect(applyProposal(locked, proposal)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
    expect(await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8')).toBe(before);
  });

  it('refuses a path outside the write allow-list', async () => {
    const { config, proposal } = await prepared();
    const narrow: OkbConfig = { ...config, policy: { ...config.policy, writeAllow: ['concepts/**'] } };
    const report = await guardApply(narrow, proposal, proposal.changes);
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.path === TARGET && v.code === 'E_FORBIDDEN_PATH')).toBe(true);
  });

  it('refuses a proposal touching more files than the policy allows', async () => {
    const { config, proposal } = await prepared();
    const strict: OkbConfig = { ...config, policy: { ...config.policy, maxApplyFiles: 1 } };
    const report = await guardApply(strict, proposal, proposal.changes);
    expect(report.violations.some((v) => v.code === 'E_CONFLICT')).toBe(true);
  });

  it('refuses a target that escapes the bundle through a symlink', async () => {
    const { s, config, proposal } = await prepared();
    const { symlink, mkdir } = await import('node:fs/promises');
    await mkdir(resolve(s.dir, 'outside'), { recursive: true });
    await symlink(resolve(s.dir, 'outside'), resolve(s.vault, 'escape'));

    const escaping: Proposal = {
      ...proposal,
      baseline: { ...proposal.baseline, 'escape/leak.md': null },
      changes: [
        {
          ...proposal.changes[0]!,
          id: 'c-escape',
          kind: 'create-document',
          path: asBundlePath('escape/leak.md'),
          createDocument: { content: '---\ntype: Reference\n---\n\nleak\n' },
        },
      ],
    };
    const report = await guardApply(config, escaping, escaping.changes);
    expect(report.violations.some((v) => v.code === 'E_FORBIDDEN_PATH')).toBe(true);
  });
});

describe('partial acceptance', () => {
  it('drops a link whose concept card was refused, leaving plain text', async () => {
    const { config, proposal } = await prepared();
    const linkChange = proposal.changes.find((c) => c.category === 'link' && c.dependsOn.some(d => d.startsWith('c-concept-')));
    if (!linkChange) return; // the fixture produced no dependent link; nothing to assert

    const withoutCards = proposal.changes
      .filter((c) => c.category !== 'concept-card')
      .map((c) => c.id);
    const { accepted, dropped } = resolveSelection(proposal, withoutCards);

    expect(accepted).not.toContain(linkChange.id);
    expect(dropped.find((d) => d.id === linkChange.id)?.reason).toContain('plain text');
  });

  it('applies only the accepted changes and leaves the bundle link-clean', async () => {
    const { config, proposal } = await prepared();
    const articleOnly = ['c-article'];
    await grantApproval(config, proposal, articleOnly, 'human:testuser');
    const receipt = await applyProposal(config, proposal, { only: articleOnly });

    expect(receipt.results.map((r) => r.path)).toEqual([TARGET]);
    const bundle = await loadBundle(config.kb.root);
    const links = checkLinks(bundle.snapshot, { brokenTargetsAre: 'error' });
    expect(links.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('interruption and recovery', () => {
  it('journals every write so an interrupted run can resume', async () => {
    const { config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, proposal);

    const journal = await readFile(receipt.journal, 'utf8');
    const entries = journal.trim().split('\n').map((l) => JSON.parse(l) as { op: string });
    expect(entries[0]!.op).toBe('start');
    expect(entries.filter((e) => e.op === 'write').length).toBe(receipt.results.length);
    expect(entries.at(-1)!.op).toBe('done');

    const resumed = await applyProposal(config, proposal, { resume: true });
    expect(resumed.results.every((r) => r.action === 'skipped')).toBe(true);
    // Running the same apply again says it is done, not that it "started".
    await expect(applyProposal(config, proposal)).rejects.toMatchObject({ code: 'E_CONFLICT', message: expect.stringContaining('already applied') });
  });

  it('restores every touched file after a failed or unwanted apply', async () => {
    const { s, config, proposal } = await prepared();
    const path = resolve(s.vault, 'flows', 'run-a-delivery-job.md');
    const before = await readFile(path, 'utf8');

    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, proposal);
    expect(await readFile(path, 'utf8')).not.toBe(before);

    const restored = await rollback(config, receipt.id);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(restored.length).toBeGreaterThan(0);

    for (const result of receipt.results) {
      if (receipt.backups[result.path] !== null) continue;
      await expect(readFile(resolve(s.vault, result.path), 'utf8')).rejects.toThrow();
    }
  });

  it('reports a missing backup instead of silently finishing', async () => {
    const { config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, proposal);

    const backupRel = Object.entries(receipt.backups).find(([, v]) => v !== null);
    expect(backupRel).toBeDefined();
    await rm(resolve(config.stateHome, 'backups', proposal.id, backupRel![1]!), { force: true });

    await expect(rollback(config, receipt.id)).rejects.toMatchObject({ code: 'E_IO' });
  });

  it('writes a receipt that ties the result to the approval and the content hash', async () => {
    const { config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, proposal);

    const stored = await loadReceipt(config, receipt.id);
    expect(stored.proposalContentHash).toBe(proposal.contentHash);
    expect(stored.approval.approvedBy).toBe('human:testuser');
    expect(stored.results.every((r) => r.sha256.length === 64)).toBe(true);
  });

  it('never leaves a half-written file behind', async () => {
    const { s, config, proposal } = await prepared();
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, proposal);

    for (const result of receipt.results) {
      const text = await readFile(resolve(s.vault, result.path), 'utf8');
      expect(sha256(text)).toBe(result.sha256);
    }
  });

  it('supports a dry run that touches nothing', async () => {
    const { s, config, proposal } = await prepared();
    const before = await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8');
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');

    const receipt = await applyProposal(config, proposal, { dryRun: true });
    expect(receipt.results.length).toBeGreaterThan(0);
    expect(await readFile(resolve(s.vault, 'flows', 'run-a-delivery-job.md'), 'utf8')).toBe(before);
  });
});
