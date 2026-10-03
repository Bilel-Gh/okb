import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { canonicalJson, constantTimeEqual, hmac, newSecret } from '../util/hash.js';
import { assertProposal, computeProposalHash, type Proposal } from '../proposal/model.js';
import { assertId } from '../util/paths.js';

export type Approval = {
  readonly proposalId: string;
  /** Binds the grant to one exact proposal payload. */
  readonly contentHash: string;
  readonly selection: readonly string[];
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly nonce: string;
  readonly mac: string;
};

/**
 * Why a MAC and not a boolean.
 *
 * A model can emit `{"approved": true}` as easily as any other token, so an
 * `approved` field proves nothing. The MAC is computed by the `okb review
 * --approve` command over the *exact* proposal hash and the *exact* selection,
 * which makes an approval non-transferable to a different or newer proposal.
 *
 * Honest limit: the key lives on the same filesystem. Anything able to run
 * arbitrary shell commands as this user can read it and forge an approval. The
 * mechanism that stops an agent from doing so is the Claude Code permission
 * deny-list shipped with the plugin, not this file. See docs/SECURITY.md.
 */
async function approvalSecret(config: OkbConfig): Promise<string> {
  const file = statePaths(config).secretFile;
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length < 32) throw new OkbError('E_INVALID', 'approval key is invalid');
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const secret = newSecret();
  await ensureDir(resolve(file, '..'));
  try { await writeFile(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return approvalSecret(config);
    throw error;
  }
  return secret;
}

function payloadOf(approval: Omit<Approval, 'mac'>): string {
  return canonicalJson({
    proposalId: approval.proposalId,
    contentHash: approval.contentHash,
    selection: [...approval.selection].sort(),
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
    nonce: approval.nonce,
  });
}

export function approvalPath(config: OkbConfig, proposalId: string): string {
  return resolve(statePaths(config).approvals, `${assertId(proposalId, 'proposal id')}.json`);
}

export async function grantApproval(
  config: OkbConfig,
  proposal: Proposal,
  selection: readonly string[],
  approvedBy: string,
): Promise<Approval> {
  assertProposal(proposal);
  if (!selection.length || new Set(selection).size !== selection.length || selection.some(id => !proposal.changes.some(c => c.id === id))) throw new OkbError('E_INVALID', 'invalid or empty approval selection');
  const secret = await approvalSecret(config);
  const base: Omit<Approval, 'mac'> = {
    proposalId: proposal.id,
    contentHash: proposal.contentHash,
    selection: [...selection].sort(),
    approvedAt: new Date().toISOString(),
    approvedBy,
    nonce: newSecret().slice(0, 16),
  };
  const approval: Approval = { ...base, mac: hmac(secret, payloadOf(base)) };
  await writeJsonAtomic(approvalPath(config, proposal.id), approval);
  return approval;
}

export type ApprovalCheck =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly code: 'E_NOT_APPROVED' | 'E_APPROVAL_MISMATCH'; readonly reason: string };

export async function verifyApproval(
  config: OkbConfig,
  proposal: Proposal,
  requestedSelection: readonly string[],
): Promise<ApprovalCheck> {
  if (computeProposalHash(proposal) !== proposal.contentHash) return { ok: false, code: 'E_APPROVAL_MISMATCH', reason: 'proposal payload changed' };
  const approval = await readJsonIfExists<Approval>(approvalPath(config, proposal.id));
  if (!approval) {
    return {
      ok: false,
      code: 'E_NOT_APPROVED',
      reason: `proposal ${proposal.id} has no approval; a human must run \`okb review ${proposal.id} --approve\``,
    };
  }

  const secret = await readFile(statePaths(config).secretFile, 'utf8').then(s => s.trim()).catch(() => null);
  if (!secret || !Array.isArray(approval.selection) || typeof approval.mac !== 'string') return { ok: false, code: 'E_APPROVAL_MISMATCH', reason: 'missing key or malformed approval' };
  const { mac, ...rest } = approval;
  if (!constantTimeEqual(mac, hmac(secret, payloadOf(rest)))) {
    return { ok: false, code: 'E_APPROVAL_MISMATCH', reason: 'the approval signature does not verify' };
  }
  if (approval.proposalId !== proposal.id || approval.contentHash !== proposal.contentHash) {
    return {
      ok: false,
      code: 'E_APPROVAL_MISMATCH',
      reason: 'the approval was granted for a different version of this proposal',
    };
  }
  const granted = new Set(approval.selection);
  const extra = requestedSelection.filter((id) => !granted.has(id));
  if (extra.length > 0 || granted.size !== new Set(requestedSelection).size) {
    return {
      ok: false,
      code: 'E_APPROVAL_MISMATCH',
      reason: `selection differs from the exact approved selection: ${extra.join(', ')}`,
    };
  }
  return { ok: true, approval };
}

export function requireApproval(check: ApprovalCheck): Approval {
  if (check.ok) return check.approval;
  throw new OkbError(check.code, check.reason, {
    hint: 'Approval is bound to the exact proposal content and change selection.',
  });
}
