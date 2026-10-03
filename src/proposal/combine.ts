import { randomUUID } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { computeProposalHash, type Change, type Proposal } from './model.js';

/**
 * Merge prepared proposals into one, so a set of notes that link to each other
 * is reviewed as one exact diff, approved once, applied with one receipt and
 * rolled back together. Nothing is re-rendered: every change keeps its payload,
 * only its id is prefixed (`p1-c-article`) so selections stay unambiguous.
 *
 * Two proposals touching the same file are refused rather than reconciled:
 * their edits were computed against the same baseline and would need a merge.
 */
export function combineProposals(config: OkbConfig, proposals: readonly Proposal[]): Proposal {
  if (proposals.length < 2) throw new OkbError('E_INVALID', 'combine needs at least two proposals');
  if (new Set(proposals.map((p) => p.id)).size !== proposals.length) throw new OkbError('E_INVALID', 'a proposal is listed twice');
  const owners = new Map<string, string>();
  for (const p of proposals) {
    if (p.status !== 'prepared') throw new OkbError('E_CONFLICT', `proposal ${p.id} is ${p.status}; only prepared proposals can be combined`);
    if (p.profileId !== config.profile.id || p.kbRoot !== config.kb.root) throw new OkbError('E_CONFLICT', `proposal ${p.id} belongs to another profile or bundle`);
    for (const path of Object.keys(p.baseline)) {
      const other = owners.get(path);
      if (other) throw new OkbError('E_CONFLICT', `${path} is changed by both ${other} and ${p.id}`, { hint: 'Apply one first and prepare the other again, or drop one of them.' });
      owners.set(path, p.id);
    }
  }

  const changes: Change[] = [];
  const evidence: Proposal['evidence'][number][] = [];
  const contradictions: Proposal['contradictions'][number][] = [];
  const notes: string[] = [];
  const baseline: Record<string, string | null> = {};
  proposals.forEach((p, i) => {
    const tag = `p${i + 1}`;
    const rename = (id: string) => `${tag}-${id}`;
    notes.push(`${tag} = ${p.id} (content ${p.contentHash.slice(0, 12)}), ${p.changes.length} change(s) from ${p.sourceUris.join(', ') || 'a mechanical operation'}`);
    for (const note of p.notes) notes.push(`${tag}: ${note}`);
    for (const c of p.changes) {
      changes.push({
        ...c,
        id: rename(c.id),
        dependsOn: c.dependsOn.map(rename),
        evidenceIds: c.evidenceIds.map(rename),
        ...(c.group ? { group: rename(c.group) } : {}),
      });
    }
    for (const e of p.evidence) evidence.push({ ...e, id: rename(e.id) });
    for (const c of p.contradictions) contradictions.push({ ...c, id: rename(c.id), evidenceIds: c.evidenceIds.map(rename) });
    Object.assign(baseline, p.baseline);
  });

  const levels = [...new Set(proposals.map((p) => p.conceptAssistLevel))];
  const draft = {
    id: `p-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    profileId: config.profile.id,
    kbRoot: config.kb.root,
    sourceIds: [...new Set(proposals.flatMap((p) => p.sourceIds))],
    sourceUris: [...new Set(proposals.flatMap((p) => p.sourceUris))],
    baseline,
    changes,
    evidence,
    contradictions,
    notes: [`combines ${proposals.length} proposals; their dossiers stay with the original proposals for evidence review`, ...notes],
    conceptAssistLevel: levels.length === 1 ? levels[0]! : 'mixed',
  };
  return { ...draft, status: 'prepared', contentHash: computeProposalHash(draft) };
}
