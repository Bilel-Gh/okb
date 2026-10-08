import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { assertProposal, computeProposalHash, type Proposal } from './model.js';
import { assertId } from '../util/paths.js';
import { assertNoSecrets } from '../security/guard.js';
import { decorateProposal } from '../brain/decorate.js';
import { walkFiles } from '../util/fsx.js';
import { matchesAny } from '../util/paths.js';

export function proposalDir(config: OkbConfig, id: string): string {
  return resolve(statePaths(config).proposals, assertId(id, 'proposal id'));
}

export async function saveProposal(config: OkbConfig, input: Proposal): Promise<string> {
  assertProposal(input);
  // A brain gives every new note its id, its breadcrumb and the pages of the subjects above it.
  let proposal = config.kb.brain && input.changes.some((c) => c.kind === 'create-document')
    ? decorateProposal(config, new Set((await walkFiles(config.kb.root).catch(() => [] as string[])).filter((f) => !matchesAny(f, config.kb.exclude))), input)
    : input;
  if (proposal !== input) assertProposal(proposal);
  // Personal data (emails, phones, IBANs, identifiers, card numbers) is flagged for the reviewer, not refused:
  // a colleague's email may belong in a work note; the person decides at review.
  const { personalData } = await import('../security/confidential.js');
  const flagged: string[] = [];
  for (const c of proposal.changes) {
    const text = c.createDocument?.content ?? c.replaceDocument?.content ?? c.appendSection?.markdown;
    if (!text) continue;
    const found = personalData(text);
    if (found.length) flagged.push(`⚠️ personal data in ${c.path}: ${[...new Set(found.map((f) => `${f.kind} (line ${f.line})`))].slice(0, 6).join(', ')} — check it belongs in the KB`);
  }
  if (flagged.length && !proposal.notes.some((n) => n.startsWith('⚠️ personal data'))) {
    const next = { ...proposal, notes: [...proposal.notes, ...flagged] };
    const { contentHash: _h, status: _s, ...rest } = next;
    proposal = { ...next, contentHash: computeProposalHash(rest) };
  }
  // A diagram that does not parse is refused before anyone reviews a broken picture.
  const { diagramProblems } = await import('../markdown/mermaid.js');
  for (const c of proposal.changes) {
    const text = c.createDocument?.content ?? c.replaceDocument?.content ?? c.appendSection?.markdown;
    if (!text || !text.includes('```mermaid')) continue;
    const problems = await diagramProblems(text);
    if (problems.length) {
      throw new OkbError('E_INVALID', `a Mermaid diagram does not parse in ${c.path} (line ${problems[0]!.line}): ${problems[0]!.error}`, { key: 'mermaidInvalid', params: { path: c.path, line: String(problems[0]!.line), error: problems[0]!.error }, hint: 'Fix the diagram (each node and arrow on its own line, quotes around labels with special characters), then prepare the note again.' });
    }
  }
  assertNoSecrets({ changes: proposal.changes, evidence: proposal.evidence }, 'proposal');
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
