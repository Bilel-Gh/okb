import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { listProposals } from '../proposal/store.js';
import { REPOS_FOLDER } from '../repo/pack.js';
import { addRepo, listRepos, type RepoEntry } from '../repo/registry.js';
import { repoPaths } from '../repo/state.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists } from '../util/fsx.js';
import { kindOf } from './kinds.js';
import { ticketsDir, type TicketRecord } from './tickets.js';
import { listWorkspaces, updateWorkspace } from './workspaces.js';

/**
 * Merge a repository KB into a workspace KB: every note moves, unchanged,
 * under `repos/<id>/` of the workspace (relative links between them keep
 * working, since the whole tree moves together). It is one proposal the
 * person reviews; once applied, `finishMerge` moves the repository's private
 * state and registration over. The source folder is never touched: retiring
 * the old KB from OKB leaves its notes on disk.
 */
const TEXT = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.mmd', '.puml', '.svg', '.drawio', '.tsv']);

async function filesOf(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (d.name.startsWith('.')) continue; // .okb, .git, .obsidian…: tooling, not knowledge
      const abs = resolve(dir, d.name);
      if (d.isDirectory()) await walk(abs);
      else if (d.isFile()) out.push(relative(root, abs).split(sep).join('/'));
    }
  };
  await walk(root);
  return out.sort();
}

export type MergePlan = {
  readonly repo: RepoEntry;
  readonly desired: Map<string, string>;
  /** Files the workspace KB already has, with other content: left out, to reconcile by hand. */
  readonly conflicts: readonly string[];
  /** Images and other binary files: proposals carry text, these are copied by hand. */
  readonly binaries: readonly string[];
  /** Every note is already in place: the merge can be finished. */
  readonly applied: boolean;
};

export async function planMerge(source: OkbConfig, target: OkbConfig): Promise<MergePlan> {
  if (source.profile.id === target.profile.id) throw new OkbError('E_INVALID', 'a KB cannot be merged into itself', { key: 'mergeSame' });
  if ((await kindOf(source.profile.id, source)) !== 'repo') throw new OkbError('E_INVALID', `KB "${source.profile.id}" is not a repository KB`, { key: 'mergeNotRepoKb', params: { id: source.profile.id } });
  if ((await kindOf(target.profile.id, target)) === 'repo') throw new OkbError('E_INVALID', `KB "${target.profile.id}" is a repository KB`, { key: 'kbIsRepoKb', params: { id: target.profile.id } });
  const repos = (await listRepos()).filter((r) => r.kb === source.profile.id);
  const repo = repos[0];
  if (!repo) {
    // Already merged: the repository now points to the target.
    throw new OkbError('E_NOT_FOUND', `no repository in KB "${source.profile.id}"`, { key: 'mergeNoRepo', params: { id: source.profile.id } });
  }
  const bundle = await loadBundleFor(target);
  const desired = new Map<string, string>();
  const conflicts: string[] = [];
  const binaries: string[] = [];
  let present = 0;
  for (const rel of await filesOf(source.kb.root)) {
    const to = `${REPOS_FOLDER}/${repo.id}/${rel}`;
    if (!TEXT.has(extname(rel).toLowerCase())) { binaries.push(rel); continue; }
    const content = await readFile(resolve(source.kb.root, rel), 'utf8');
    const existing = bundle.snapshot.files.get(to as never) ?? null;
    if (existing === content) { present++; continue; }
    if (existing !== null) { conflicts.push(rel); continue; }
    desired.set(to, content);
  }
  return { repo, desired, conflicts, binaries, applied: desired.size === 0 && present > 0 };
}

/** The merge proposal: an existing one still waiting, else a new one. */
export async function mergeProposal(source: OkbConfig, target: OkbConfig, plan: MergePlan): Promise<{ proposal: Proposal; reused: boolean }> {
  const label = `merge of the KB "${source.profile.id}" into ${REPOS_FOLDER}/${plan.repo.id}/`;
  const waiting = (await listProposals(target)).find((p) => (p.status === 'prepared' || p.status === 'partially-applied') && p.notes[0] === label);
  if (waiting) return { proposal: waiting, reused: true };
  const bundle = await loadBundleFor(target);
  return { proposal: proposeFiles(target, bundle, plan.desired, label, true), reused: false };
}

/**
 * After the notes are in the workspace KB: the repository's private state
 * (map, findings, answers, followed tickets) is copied over, and the
 * repository is registered in the workspace KB. Nothing is deleted.
 */
export async function finishMerge(source: OkbConfig, target: OkbConfig, repo: RepoEntry): Promise<{ state: boolean; tickets: number }> {
  const from = repoPaths(source, repo.id).dir;
  const to = repoPaths(target, repo.id).dir;
  const hasState = await stat(from).then((s) => s.isDirectory(), () => false);
  if (hasState) {
    await ensureDir(to);
    await cp(from, to, { recursive: true, force: false, errorOnExist: false });
  }
  let tickets = 0;
  const srcTickets = ticketsDir(source);
  for (const name of (await readdir(srcTickets).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))) {
    const record = await readJsonIfExists<TicketRecord>(resolve(srcTickets, name)).catch(() => null);
    if (!record || !record.repos.some((r) => r.id === repo.id)) continue;
    await ensureDir(ticketsDir(target));
    const dest = resolve(ticketsDir(target), name);
    if (await stat(dest).then(() => true, () => false)) continue;
    await cp(resolve(srcTickets, name), dest);
    const textFile = resolve(srcTickets, name.replace(/\.json$/, '.md'));
    if (await stat(textFile).then(() => true, () => false)) await cp(textFile, resolve(ticketsDir(target), name.replace(/\.json$/, '.md')));
    tickets++;
  }
  await addRepo({ path: repo.path, kb: target.profile.id, id: repo.id, name: repo.name });
  for (const ws of (await listWorkspaces()).filter((w) => w.attached.includes(repo.id))) await updateWorkspace(ws.id, { detach: repo.id });
  return { state: hasState, tickets };
}
