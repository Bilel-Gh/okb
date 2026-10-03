import type { BundlePath } from '../util/paths.js';
import { hashStructure } from '../util/hash.js';
import { OkbError } from '../util/errors.js';
import { assertId, asBundlePath } from '../util/paths.js';

/**
 * How a statement relates to reality. Keeping these apart is the point of the
 * whole product: a sentence heard in a meeting is not a sentence checked against
 * the code.
 */
export type ClaimKind =
  | 'reported' // the source says it
  | 'inferred' // the product deduced it from the source
  | 'verified'; // confirmed against the described system — only a human or an attester sets this

export type Evidence = {
  readonly id: string;
  readonly sourceId: string;
  readonly blockIds: readonly string[];
  /** Verbatim excerpt. Never paraphrased, never trimmed mid-word. */
  readonly quote: string;
  readonly locator: string;
  readonly claimKind: ClaimKind;
};

export type ChangeKind =
  | 'replace-document'
  | 'delete-document'
  | 'create-document'
  | 'append-section'
  | 'insert-links'
  | 'patch-frontmatter';

export type LinkInsertionPayload = {
  readonly span: { readonly start: number; readonly end: number };
  readonly original: string;
  readonly replacement: string;
  readonly canonical: string;
  readonly target: BundlePath;
  readonly linkKey: string;
  readonly section: string;
};

export type Change = {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly path: BundlePath;
  readonly label: string;
  readonly rationale: string;
  /**
   * Stable identity of the *content* being merged. Re-importing the same source
   * recomputes the same key, which is how a second run adds nothing.
   */
  readonly contentKey: string;
  readonly evidenceIds: readonly string[];
  /** Change ids that must be accepted for this one to make sense. */
  readonly dependsOn: readonly string[];
  readonly group?: string;
  /** Set for concept cards so a partial refusal can be reasoned about. */
  readonly category: 'article' | 'concept-card' | 'link' | 'metadata';
  readonly createDocument?: { readonly content: string };
  readonly appendSection?: { readonly heading: string; readonly markdown: string };
  readonly insertLinks?: { readonly insertions: readonly LinkInsertionPayload[]; readonly stage?: 'before' | 'after-article' };
  readonly replaceDocument?: { readonly content: string };
  readonly patchFrontmatter?: { readonly patch: Record<string, unknown> };
};

export type Contradiction = {
  readonly id: string;
  readonly path: BundlePath;
  readonly existingClaim: string;
  readonly incomingClaim: string;
  readonly evidenceIds: readonly string[];
  readonly resolution: 'keep-both' | 'supersede' | 'undecided';
  readonly note: string;
};

export type ProposalStatus = 'prepared' | 'partially-applied' | 'applied' | 'superseded';

export type Proposal = {
  readonly id: string;
  readonly createdAt: string;
  readonly profileId: string;
  readonly kbRoot: string;
  readonly sourceIds: readonly string[];
  readonly sourceUris: readonly string[];
  /** sha256 of each touched file at preparation time; `null` means "did not exist". */
  readonly baseline: Readonly<Record<string, string | null>>;
  readonly changes: readonly Change[];
  readonly evidence: readonly Evidence[];
  readonly contradictions: readonly Contradiction[];
  readonly notes: readonly string[];
  readonly conceptAssistLevel: string;
  readonly status: ProposalStatus;
  /** Hash over the semantic payload; an approval is bound to this exact value. */
  readonly contentHash: string;
  readonly analysis?: import('../pipeline/analysis.js').SourceAnalysis;
};

export function computeProposalHash(
  proposal: Omit<Proposal, 'contentHash' | 'status'>,
): string {
  return hashStructure({
    id: proposal.id,
    createdAt: proposal.createdAt,
    profileId: proposal.profileId,
    kbRoot: proposal.kbRoot,
    sourceIds: [...proposal.sourceIds].sort(),
    sourceUris: proposal.sourceUris,
    baseline: proposal.baseline,
    changes: proposal.changes,
    evidence: proposal.evidence,
    contradictions: proposal.contradictions,
    notes: proposal.notes,
    conceptAssistLevel: proposal.conceptAssistLevel,
    analysis: proposal.analysis,
  });
}

export function assertProposal(proposal: Proposal): void {
  assertId(proposal.id, 'proposal id');
  if (!Array.isArray(proposal.changes) || !proposal.baseline || computeProposalHash(proposal) !== proposal.contentHash) {
    throw new OkbError('E_APPROVAL_MISMATCH', 'proposal content does not match its hash; prepare it again');
  }
  const ids = new Set<string>();
  for (const change of proposal.changes) {
    assertId(change.id, 'change id');
    if (ids.has(change.id)) throw new OkbError('E_INVALID', 'duplicate change id');
    ids.add(change.id);
    if (asBundlePath(change.path) !== change.path) throw new OkbError('E_FORBIDDEN_PATH', 'non-canonical target path');
    if (!Object.hasOwn(proposal.baseline, change.path)) throw new OkbError('E_INVALID', 'missing target baseline');
    const key = ({'create-document':'createDocument', 'replace-document':'replaceDocument', 'append-section':'appendSection', 'insert-links':'insertLinks', 'patch-frontmatter':'patchFrontmatter'} as Record<string,string>)[change.kind];
    if (change.kind !== 'delete-document' && (!key || !(change as any)[key])) throw new OkbError('E_INVALID', 'missing change payload');
    if (!Array.isArray(change.dependsOn) || !Array.isArray(change.evidenceIds)) throw new OkbError('E_INVALID', 'invalid change dependencies or evidence');
  }
  const visit = (id: string, stack: Set<string>) => {
    if (stack.has(id)) throw new OkbError('E_INVALID', 'cyclic change dependencies');
    const change = proposal.changes.find(c => c.id === id);
    if (!change) throw new OkbError('E_INVALID', `unknown dependency ${id}`);
    for (const dep of change.dependsOn) visit(dep, new Set([...stack, id]));
  };
  for (const id of ids) visit(id, new Set());
}

export function changeById(proposal: Proposal, id: string): Change | undefined {
  return proposal.changes.find((c) => c.id === id);
}

/**
 * Expand a user selection to a coherent set.
 *
 * A link whose target card was refused must not survive as a broken link, so it
 * is dropped. The reverse is not true: accepting a card never forces its links.
 */
export function resolveSelection(
  proposal: Proposal,
  selected: readonly string[],
): { accepted: string[]; dropped: { id: string; reason: string }[] } {
  const chosen = new Set(selected);
  const dropped: { id: string; reason: string }[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const id of [...chosen]) {
      const change = changeById(proposal, id);
      if (!change) {
        chosen.delete(id);
        dropped.push({ id, reason: 'unknown change id' });
        changed = true;
        continue;
      }
      if (change.group && proposal.changes.some(c => c.group === change.group && !chosen.has(c.id))) {
        chosen.delete(id); dropped.push({ id, reason: 'the entire move operation must be accepted together' }); changed = true; continue;
      }
      for (const dep of change.dependsOn) {
        if (!chosen.has(dep)) {
          chosen.delete(id);
          dropped.push({
            id,
            reason: `depends on "${dep}" which was not accepted; the link stays plain text`,
          });
          changed = true;
          break;
        }
      }
    }
  }

  return { accepted: [...chosen].sort(), dropped };
}
