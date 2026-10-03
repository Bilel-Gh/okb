import { randomUUID } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';
import { computeProposalHash, type Change, type Proposal } from './model.js';

/** Mechanical operations use the same approval, staleness and recovery path. */
export function proposeFiles(config: OkbConfig, bundle: Bundle, desired: ReadonlyMap<string, string | null>, label: string, atomicGroup = false): Proposal {
  const changes: Change[] = [];
  const baseline: Record<string,string|null> = {};
  for (const [rawPath, after] of desired) {
    const path = asBundlePath(rawPath);
    const before = bundle.snapshot.files.get(path) ?? null;
    if (before === after) continue;
    baseline[path] = before === null ? null : sha256(before);
    changes.push({ id: `c-file-${changes.length}`, path,
      kind: after === null ? 'delete-document' : before === null ? 'create-document' : 'replace-document',
      label: `${label}: ${path}`, rationale: 'mechanical change; inspect the exact diff before approval',
      category: 'metadata', contentKey: sha256(`${path}:${after}`), evidenceIds: [], dependsOn: [],
      ...(atomicGroup ? { group: 'operation' } : {}),
      ...(after === null ? {} : before === null ? { createDocument: { content: after } } : { replaceDocument: { content: after } }),
    });
  }
  const p = { id: `p-${randomUUID()}`, createdAt: new Date().toISOString(), profileId: config.profile.id, kbRoot: config.kb.root,
    sourceIds: [], sourceUris: [], baseline, changes, evidence: [], contradictions: [], notes: [label], conceptAssistLevel: 'off' };
  return { ...p, status: 'prepared', contentHash: computeProposalHash(p) };
}
