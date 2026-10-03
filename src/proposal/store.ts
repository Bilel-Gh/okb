import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { assertProposal, type Proposal } from './model.js';
import { assertId } from '../util/paths.js';

export function proposalDir(config: OkbConfig, id: string): string {
  return resolve(statePaths(config).proposals, assertId(id, 'proposal id'));
}

export async function saveProposal(config: OkbConfig, proposal: Proposal): Promise<string> {
  assertProposal(proposal);
  const dir = proposalDir(config, proposal.id);
  await ensureDir(dir);
  await writeJsonAtomic(resolve(dir, 'proposal.json'), proposal);
  return dir;
}

export async function loadProposal(config: OkbConfig, id: string): Promise<Proposal> {
  const file = resolve(proposalDir(config, id), 'proposal.json');
  const proposal = await readJsonIfExists<Proposal>(file);
  if (!proposal) {
    throw new OkbError('E_NOT_FOUND', `no proposal "${id}" for profile ${config.profile.id}`, {
      detail: { expected: file },
      hint: 'List what is available with `okb review --list`.',
    });
  }
  assertProposal(proposal);
  if (proposal.id !== id || proposal.profileId !== config.profile.id || resolve(proposal.kbRoot) !== resolve(config.kb.root)) {
    throw new OkbError('E_CONFLICT', 'proposal belongs to a different profile or knowledge bundle');
  }
  return proposal;
}

export async function listProposals(config: OkbConfig): Promise<Proposal[]> {
  const dir = statePaths(config).proposals;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Proposal[] = [];
  for (const name of names) {
    const p = await readJsonIfExists<Proposal>(resolve(dir, name, 'proposal.json'));
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateProposalStatus(
  config: OkbConfig,
  id: string,
  status: Proposal['status'],
): Promise<Proposal> {
  const proposal = await loadProposal(config, id);
  const next: Proposal = { ...proposal, status };
  await saveProposal(config, next);
  return next;
}
