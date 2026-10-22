import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { person } from '../identity/person.js';
import type { OkbConfig } from '../config/schema.js';
import { assertStateOutsideKb } from '../config/load.js';
import { validatePlannedFiles } from '../proposal/validate.js';
import { materializeFile, groupChangesByPath } from '../proposal/materialize.js';
import { assertProposal, resolveSelection, type Proposal } from '../proposal/model.js';
import { updateProposalStatus } from '../proposal/store.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { appendLine, readJsonIfExists, readTextIfExists, writeJsonAtomic, writeTextAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { assertId, assertInsideRoot, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';
import { approvalPath, requireApproval, verifyApproval, type Approval } from './approval.js';
import { assertGuard, checkPathPolicy, guardApply } from './guard.js';
import { requireCleanGitTree } from './git.js';
import { assertWritableKb } from '../kb/registry.js';
import { withBundleLock } from './lock.js';

export type ApplyResult = { readonly path: BundlePath; readonly action: 'created' | 'updated' | 'deleted' | 'skipped'; readonly sha256: string };
export type Receipt = {
  readonly id: string; readonly proposalId: string; readonly proposalContentHash: string;
  readonly kbRoot: string; readonly profileId: string;
  readonly appliedAt: string; readonly appliedBy: string;
  readonly approval: { readonly approvedBy: string; readonly approvedAt: string; readonly mac: string };
  readonly selection: readonly string[]; readonly dropped: readonly { readonly id: string; readonly reason: string }[];
  readonly results: readonly ApplyResult[]; readonly backups: Readonly<Record<string, string | null>>;
  readonly beforeHashes: Readonly<Record<string, string | null>>;
  readonly journal: string; readonly complete: boolean; readonly rolledBack?: boolean;
  /** Who applied it (src/identity/person.ts): a stable id and a declared job, never a name. */
  readonly person?: { readonly id: string; readonly role: string };
};
export type ApplyOptions = { readonly only?: readonly string[]; readonly resume?: boolean; readonly dryRun?: boolean; readonly actor?: string; /** D71: the agent's new notes and notes still to review, in a KB set to `review-later` (src/review/keep.ts). */ readonly policy?: 'review-later'; /** The OKB home in use (the person who applies is read there). */ readonly env?: NodeJS.ProcessEnv };
const receiptPath = (config: OkbConfig, id: string) => resolve(statePaths(config).receipts, `${assertId(id, 'receipt id')}.json`);
const hashOf = (text: string | null) => text === null ? null : sha256(text);

/**
 * D71: in a KB set to `review-later`, a change goes in without the person only if
 * it creates a note that does not exist yet, or changes a note still to review.
 * A validated note never changes this way: checked here, whoever asks.
 */
async function reviewLaterApproval(config: OkbConfig, proposal: Proposal, accepted: readonly string[]): Promise<Approval> {
  if (config.changes.agentWrites !== 'review-later') throw new OkbError('E_NOT_APPROVED', 'this KB asks for the person\'s yes before any note enters', { key: 'reviewLaterOff' });
  const { reviewOf } = await import('../review/state.js');
  for (const c of proposal.changes.filter((x) => accepted.includes(x.id))) {
    const exists = (await readTextIfExists(await safeTarget(config, c.path))) !== null;
    const ok = c.kind === 'create-document' ? !exists : exists && reviewOf(config, c.path)?.state === 'pending';
    if (!ok) throw new OkbError('E_NOT_APPROVED', `${c.path} is validated: only the person changes it`, { key: 'reviewLaterValidated', params: { path: c.path } });
  }
  return { approvedBy: 'policy:review-later', approvedAt: new Date().toISOString(), mac: '' } as Approval;
}

export async function applyProposal(config: OkbConfig, proposal: Proposal, options: ApplyOptions = {}): Promise<Receipt> {
  assertProposal(proposal);
  if (proposal.status === 'superseded') throw new OkbError('E_CONFLICT', 'this proposal was discarded or superseded; prepare a new proposal', { key: 'supersededProposal' });
  if (proposal.profileId !== config.profile.id || resolve(proposal.kbRoot) !== resolve(config.kb.root)) throw new OkbError('E_CONFLICT', 'proposal belongs to a different bundle or profile', { key: 'proposalOtherKb', params: { profile: proposal.profileId } });
  await assertStateOutsideKb(config);
  if (!config.changes.keepBackups) throw new OkbError('E_CONFIG', 'transactional apply requires changes.keepBackups: true');
  if (!options.dryRun) await assertWritableKb(config);
  return withBundleLock(config.kb.root, async () => {
    const grant = await readJsonIfExists<Approval>(approvalPath(config, proposal.id));
    const requested = options.only ?? grant?.selection ?? proposal.changes.map(c => c.id);
    const { accepted, dropped } = resolveSelection(proposal, requested);
    if (!accepted.length) throw new OkbError('E_INVALID', 'the selection is empty after dependency resolution', { detail: { dropped } });
    const approval = config.changes.apply === 'allow-direct' && config.policy.allowDirectApply
      ? { approvedBy: 'policy:allow-direct', approvedAt: new Date().toISOString(), mac: '' }
      : options.policy === 'review-later'
        ? await reviewLaterApproval(config, proposal, accepted)
        : requireApproval(await verifyApproval(config, proposal, accepted));
    const changes = proposal.changes.filter(c => accepted.includes(c.id));
    const state = statePaths(config);
    const id = `rcpt-${proposal.id}`;
    const file = receiptPath(config, id);
    let receipt = await readJsonIfExists<Receipt>(file);
    if (receipt?.rolledBack) throw new OkbError('E_CONFLICT', 'this proposal was rolled back; prepare a new proposal', { key: 'rolledBackProposal' });
    if (receipt) {
      if (!options.resume && receipt.complete) {
        throw new OkbError('E_CONFLICT', `this proposal is already applied (receipt ${id}); nothing was written`, {
          key: 'alreadyApplied', params: { when: receipt.appliedAt },
          hint: `Nothing to do. To undo it: okb apply --rollback ${id}`,
        });
      }
      if (!options.resume) throw new OkbError('E_CONFLICT', 'this apply was interrupted; use --resume or roll back its receipt', { key: 'applyInterrupted', params: { id: proposal.id, receipt: id }, hint: `okb apply ${proposal.id} --resume, or okb apply --rollback ${id}` });
      if (receipt.proposalContentHash !== proposal.contentHash || JSON.stringify(receipt.selection) !== JSON.stringify(accepted)) throw new OkbError('E_CONFLICT', 'resume must use the same proposal and exact selection');
      await validateReceiptTargets(config, receipt, 'resume');
      // Untouched notes may have moved or disappeared since the interruption.
      // Recheck the complete planned bundle before writing the remaining files.
      const staged = new Map<string, { before: string | null; after: string | null }>();
      for (const result of receipt.results) {
        const before = await readTextIfExists(await safeTarget(config, result.path));
        const after = result.sha256
          ? await readTextIfExists(resolve(state.backups, proposal.id, `${sha256(result.path)}.next`))
          : null;
        staged.set(result.path, { before, after });
      }
      await validatePlannedFiles(config, staged);
    } else {
      if (options.resume) throw new OkbError('E_NOT_FOUND', 'no interrupted apply exists for this proposal');
      await requireCleanGitTree(config);
      assertGuard(await guardApply(config, proposal, changes));
      const results: ApplyResult[] = [];
      const backups: Record<string, string | null> = {};
      const beforeHashes: Record<string, string | null> = {};
      const staged = new Map<string, { before: string | null; after: string | null }>();
      // Materialise every file before the first KB write. An invalid final file
      // cannot leave the earlier files modified.
      for (const [path, pathChanges] of groupChangesByPath(changes)) {
        const before = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path));
        // An external editor does not participate in the OKB lock. Preserve an
        // edit that happened after guardApply, rather than silently treating it
        // as the new baseline for the already-approved replacement.
        if (hashOf(before) !== proposal.baseline[path]) throw new OkbError('E_STALE', `file changed during preparation for apply: ${path}`, { key: 'staleFile', params: { path }, hint: 'Nothing was written. Prepare the proposal again against the current file.' });
        const deletion = pathChanges.some(c => c.kind === 'delete-document');
        if (deletion && (pathChanges.length !== 1 || before === null)) throw new OkbError('E_CONFLICT', 'a deletion must target one existing file');
        const after = deletion ? null : materializeFile(path, before, pathChanges);
        staged.set(path, { before, after });
        results.push({ path, action: after === null ? 'deleted' : before === null ? 'created' : 'updated', sha256: hashOf(after) ?? '' });
        backups[path] = before === null ? null : `${sha256(path)}.bak`;
        beforeHashes[path] = hashOf(before);
      }
      await validatePlannedFiles(config, staged);
      const who = await person(options.env).catch(() => null);
      receipt = { id, proposalId: proposal.id, proposalContentHash: proposal.contentHash, kbRoot: config.kb.root, profileId: config.profile.id,
        appliedAt: new Date().toISOString(), appliedBy: options.actor ?? config.profile.humanActor, approval, selection: accepted, dropped, results, backups, beforeHashes,
        journal: resolve(state.runs, `${proposal.id}.jsonl`), complete: false, ...(who ? { person: who } : {}) };
      if (options.dryRun) return receipt;
      for (const [path, { before, after }] of staged) {
        if (before !== null) await writeTextAtomic(resolve(state.backups, proposal.id, backups[path]!), before);
        if (after !== null) await writeTextAtomic(resolve(state.backups, proposal.id, `${sha256(path)}.next`), after);
      }
      // Durable manifest includes *all* backups and planned hashes before any
      // note changes. A crash after rename but before the log is recoverable.
      await writeJsonAtomic(file, receipt);
      await appendLine(receipt.journal, JSON.stringify({ op: 'start', at: receipt.appliedAt, proposalId: proposal.id, contentHash: proposal.contentHash, selection: accepted }));
    }
    if (options.dryRun) return receipt;
    const results: ApplyResult[] = [];
    for (const result of receipt.results) {
      const abs = await safeTarget(config, result.path);
      const current = await readTextIfExists(abs);
      const nextHash = result.sha256 || null;
      if (hashOf(current) === nextHash) { results.push({ ...result, action: 'skipped' }); continue; }
      if (hashOf(current) !== receipt.beforeHashes[result.path]) throw new OkbError('E_STALE', `file changed during apply: ${result.path}`, { hint: 'Keep the receipt; resolve the conflicting edit before resume or rollback.' });
      if (nextHash === null) await rm(abs);
      else {
        const next = await readTextIfExists(resolve(state.backups, proposal.id, `${sha256(result.path)}.next`));
        if (next === null || sha256(next) !== nextHash) throw new OkbError('E_IO', 'staged content is missing or changed');
        await writeTextAtomic(abs, next);
      }
      await appendLine(receipt.journal, JSON.stringify({ op: 'write', at: new Date().toISOString(), path: result.path, sha256: result.sha256 }));
      results.push(result);
    }
    const complete = { ...receipt, complete: true };
    await writeJsonAtomic(file, complete);
    await updateProposalStatus(config, proposal.id, accepted.length < proposal.changes.length ? 'partially-applied' : 'applied');
    await appendLine(receipt.journal, JSON.stringify({ op: 'done', at: new Date().toISOString(), written: results.length }));
    return { ...complete, results };
  });
}

export async function loadReceipt(config: OkbConfig, id: string): Promise<Receipt> {
  const receipt = await readJsonIfExists<Receipt>(receiptPath(config, id));
  if (!receipt) throw new OkbError('E_NOT_FOUND', `no receipt "${id}"`, { key: 'receiptUnknown', params: { id } });
  if (receipt.id !== id || receipt.profileId !== config.profile.id || resolve(receipt.kbRoot) !== resolve(config.kb.root)) throw new OkbError('E_CONFLICT', 'receipt belongs to another profile or bundle', { key: 'receiptOtherKb', params: { id } });
  assertId(receipt.proposalId);
  return receipt;
}

async function safeTarget(config: OkbConfig, path: string): Promise<string> {
  const violation = checkPathPolicy(config, path as BundlePath);
  if (violation) throw new OkbError('E_FORBIDDEN_PATH', violation.message);
  await assertInsideRoot(config.kb.root, path);
  return bundlePathToAbsolute(config.kb.root, path);
}

async function validateReceiptTargets(config: OkbConfig, receipt: Receipt, mode: 'resume' | 'rollback'): Promise<void> {
  for (const r of receipt.results) {
    const abs = await safeTarget(config, r.path);
    const current = hashOf(await readTextIfExists(abs));
    if (current !== (r.sha256 || null) && current !== receipt.beforeHashes[r.path]) throw new OkbError('E_CONFLICT', `cannot ${mode}: ${r.path} has a later edit; nothing overwritten`, { key: 'laterEdit', params: { path: r.path } });
    if (mode === 'resume' && r.sha256) {
      const next = await readTextIfExists(resolve(statePaths(config).backups, receipt.proposalId, `${sha256(r.path)}.next`));
      if (next === null || sha256(next) !== r.sha256) throw new OkbError('E_IO', `staged content missing or changed for ${r.path}`);
    }
    const backup = receipt.backups[r.path];
    if (backup !== null) {
      if (backup !== `${sha256(r.path)}.bak`) throw new OkbError('E_INVALID', 'invalid backup path');
      const before = await readTextIfExists(resolve(statePaths(config).backups, receipt.proposalId, backup!));
      if (before === null || hashOf(before) !== receipt.beforeHashes[r.path]) throw new OkbError('E_IO', `backup missing or changed for ${r.path}`);
    }
  }
}

/** Preflight all files/backups; a subsequent editor's work is never overwritten. */
export async function rollback(config: OkbConfig, id: string): Promise<ApplyResult[]> {
  await assertStateOutsideKb(config);
  return withBundleLock(config.kb.root, async () => {
    const receipt = await loadReceipt(config, id);
    if (receipt.rolledBack) return [];
    await validateReceiptTargets(config, receipt, 'rollback');
    const out: ApplyResult[] = [];
    for (const r of [...receipt.results].reverse()) {
      const abs = await safeTarget(config, r.path);
      const hash = hashOf(await readTextIfExists(abs));
      if (hash === receipt.beforeHashes[r.path]) continue; // also resumes an interrupted rollback
      if (hash !== (r.sha256 || null)) throw new OkbError('E_CONFLICT', `later edit during rollback: ${r.path}`);
      const backup = receipt.backups[r.path];
      if (backup === null) await rm(abs, { force: true });
      else await writeTextAtomic(abs, (await readTextIfExists(resolve(statePaths(config).backups, receipt.proposalId, backup!)))!);
      out.push({ path: r.path, action: backup === null ? 'deleted' : 'updated', sha256: receipt.beforeHashes[r.path] ?? '' });
    }
    await writeJsonAtomic(receiptPath(config, id), { ...receipt, rolledBack: true });
    await rm(approvalPath(config, receipt.proposalId), { force: true });
    await updateProposalStatus(config, receipt.proposalId, 'superseded');
    return out;
  });
}
