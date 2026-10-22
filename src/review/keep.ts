import { randomUUID } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import { applyProposal, type Receipt } from '../apply/apply.js';
import { computeProposalHash, resolveSelection, type Proposal } from '../proposal/model.js';
import { loadProposal, saveProposal, updateProposalStatus } from '../proposal/store.js';
import { readTextIfExists } from '../util/fsx.js';
import { resolve } from 'node:path';
import { forgetReview, mayGoInDirectly, setReview } from './state.js';

/**
 * Keep what the agent prepared (F2.0-54, D71). In a KB set to `review-later`,
 * new notes and notes still to review go in at once, marked to review; a change
 * to a validated note waits for the person, as its own proposal. In a KB that
 * asks for the person's yes, nothing is applied. Whoever runs it, what goes in is
 * to review: a note is validated only by the person's gesture in the app (I4).
 */
export async function keepProposal(config: OkbConfig, proposalId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ applied: string[]; waiting: string | null; receipt: Receipt | null }> {
  const proposal = await loadProposal(config, proposalId);
  if (config.changes.agentWrites !== 'review-later' || proposal.status !== 'prepared') return { applied: [], waiting: proposal.status === 'prepared' ? proposal.id : null, receipt: null };
  const direct: string[] = [];
  for (const c of proposal.changes) {
    if (mayGoInDirectly(config, c.kind, c.path, await readTextIfExists(resolve(config.kb.root, c.path)))) direct.push(c.id);
  }
  const { accepted } = resolveSelection(proposal, direct);
  const rest = proposal.changes.filter((c) => !accepted.includes(c.id));
  if (!accepted.length) return { applied: [], waiting: proposal.id, receipt: null };
  let waiting: string | null = null;
  if (rest.length) {
    // The part that touches validated notes becomes a proposal of its own, for the person.
    const keepIds = new Set(rest.map((c) => c.id));
    const body: Omit<Proposal, 'contentHash' | 'status'> = {
      id: `p-${randomUUID()}`, createdAt: new Date().toISOString(), profileId: proposal.profileId, kbRoot: proposal.kbRoot,
      sourceIds: proposal.sourceIds, sourceUris: proposal.sourceUris,
      baseline: Object.fromEntries(Object.entries(proposal.baseline).filter(([p]) => rest.some((c) => c.path === p))),
      changes: rest.map((c) => ({ ...c, dependsOn: c.dependsOn.filter((d) => keepIds.has(d)) })),
      evidence: proposal.evidence, contradictions: proposal.contradictions.filter((x) => rest.some((c) => c.path === x.path)),
      notes: [...proposal.notes, `waiting for the person: split from ${proposal.id} (D71)`], conceptAssistLevel: proposal.conceptAssistLevel,
      ...(proposal.analysis ? { analysis: proposal.analysis } : {}),
    };
    await saveProposal(config, { ...body, status: 'prepared', contentHash: computeProposalHash(body) });
    waiting = body.id;
  }
  const receipt = await applyProposal(config, proposal, { env, policy: 'review-later', only: accepted });
  if (rest.length) await updateProposalStatus(config, proposal.id, 'partially-applied').catch(() => undefined);
  const byId = new Map(proposal.changes.map((c) => [c.path, c]));
  const applied: string[] = [];
  for (const r of receipt.results) {
    if (r.action === 'skipped') continue;
    applied.push(r.path);
    if (r.action === 'deleted') { forgetReview(config, r.path); continue; }
    setReview(config, r.path, 'pending', 'agent', { reason: byId.get(r.path)?.rationale ?? null, receiptId: receipt.id, originPath: r.path, sha256: r.sha256 });
  }
  return { applied, waiting, receipt };
}
