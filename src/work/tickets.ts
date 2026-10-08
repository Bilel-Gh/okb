import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { branchBase, commitsBetween, currentBranch, gitIdentity, isAncestor, revParse } from '../repo/git.js';
import type { RepoEntry } from '../repo/registry.js';
import { isBrainPlace, type RepoPlace } from '../repo/pack.js';
import { assertNoSecrets } from '../security/guard.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists, readTextIfExists, writeJsonAtomic, writeTextAtomic } from '../util/fsx.js';

/**
 * A ticket followed by OKB, without AI: where it started in each repository
 * it touches, its branch, the commits made since, and a journal of what the
 * work taught along the way (decisions, traps, questions). Kept in the KB's
 * private state, never in the KB: knowledge comes later, as notes the person
 * approves, written from these facts.
 */
export type TicketRepo = {
  readonly id: string;
  /** The ticket's branch in this repository, once known. */
  readonly branch: string | null;
  /** Where the work started: the merge base with the main line. */
  readonly base: string | null;
  readonly baseRef: string | null;
};

export type JournalKind = 'start' | 'note' | 'decision' | 'trap' | 'question' | 'commit' | 'repo' | 'done' | 'reopen';
export const NOTE_KINDS = ['note', 'decision', 'trap', 'question'] as const;

export type JournalEntry = {
  readonly at: string;
  readonly kind: JournalKind;
  readonly text: string;
  readonly repo?: string;
  readonly sha?: string;
};

export type TicketRecord = {
  readonly version: 1;
  readonly ref: string;
  readonly title: string;
  readonly repos: readonly TicketRepo[];
  readonly status: 'active' | 'done';
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly doneAt: string | null;
  /** Started by itself from a branch name, not by the person. */
  readonly auto: boolean;
  /** The ticket's text, as the person gave it (a file in the state folder). */
  readonly textFile: string | null;
  readonly journal: readonly JournalEntry[];
};

const MAX_JOURNAL = 400;
const MAX_TEXT = 2000;
const MAIN_LINES = new Set(['main', 'master', 'develop', 'dev', 'trunk', 'integration', 'release']);

export function ticketsDir(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'tickets');
}

/** `abc-123` → `ABC-123`; a free title → `T-<slug>`. */
export function ticketId(refOrTitle: string): string {
  const raw = refOrTitle.trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7}$/.test(raw)) return raw.toUpperCase().replace('_', '-');
  const slug = raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!slug) throw new OkbError('E_INVALID', 'a ticket needs a reference or a title', { key: 'ticketNoRef' });
  return `T-${slug}`;
}

function fileOf(config: OkbConfig, ref: string): string {
  if (!/^[A-Z0-9][A-Za-z0-9_-]{0,60}$/.test(ref)) throw new OkbError('E_INVALID', `invalid ticket reference: ${ref}`, { key: 'ticketBadRef', params: { ref } });
  return resolve(ticketsDir(config), `${ref}.json`);
}

export async function loadTicket(config: OkbConfig, ref: string): Promise<TicketRecord | null> {
  return readJsonIfExists<TicketRecord>(fileOf(config, ticketId(ref)));
}

async function saveTicket(config: OkbConfig, record: TicketRecord): Promise<TicketRecord> {
  await ensureDir(ticketsDir(config));
  const journal = record.journal.length > MAX_JOURNAL ? [record.journal[0]!, ...record.journal.slice(-(MAX_JOURNAL - 1))] : record.journal;
  const saved = { ...record, journal, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(fileOf(config, record.ref), saved);
  return saved;
}

export async function listTickets(config: OkbConfig): Promise<TicketRecord[]> {
  const dir = ticketsDir(config);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  const out: TicketRecord[] = [];
  for (const n of names) {
    const r = await readJsonIfExists<TicketRecord>(resolve(dir, n)).catch(() => null);
    if (r && typeof r.ref === 'string' && Array.isArray(r.repos)) out.push(r);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function isMainLine(branch: string | null, defaultBranch: string | null): boolean {
  return !branch || branch === defaultBranch || MAIN_LINES.has(branch) || /^release[/-]/.test(branch);
}

/** Where a repository stands for a ticket that starts now. */
async function repoStart(repo: RepoEntry, base?: string): Promise<TicketRepo> {
  const identity = await gitIdentity(repo.path);
  const start = await branchBase(repo.path, base);
  const branch = isMainLine(identity.branch, identity.defaultBranch) ? null : identity.branch;
  return { id: repo.id, branch, base: start?.sha ?? identity.head, baseRef: start?.ref ?? identity.defaultBranch ?? null };
}

export type StartInput = {
  readonly ref?: string;
  readonly title?: string;
  readonly repo: RepoEntry;
  readonly text?: string;
  readonly base?: string;
  /** Started by itself (a branch named after the ticket), not by the person. */
  readonly auto?: boolean;
};

/**
 * Start following a ticket in a repository — or, for a ticket already known,
 * add this repository to it (a ticket can span several) and reopen it.
 */
/** A title from the ticket's first line, without its reference: "ORD-42 : allow 100 lines" → "allow 100 lines". */
export function titleFrom(text: string, ref: string): string | null {
  const first = text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean);
  if (!first) return null;
  const bare = first.replace(new RegExp(`^\\[?${ref.replace(/[-]/g, '[-_ ]?')}\\]?\\s*[:–—-]?\\s*`, 'i'), '').trim();
  return bare ? bare.slice(0, 90) : null;
}

export async function startTicket(config: OkbConfig, input: StartInput): Promise<{ record: TicketRecord; created: boolean; attached: boolean }> {
  const ref = ticketId(input.ref ?? input.title ?? '');
  const title = input.title?.trim() || (input.text ? titleFrom(input.text, ref) : null) || undefined;
  if (input.text) assertNoSecrets({ text: input.text }, 'ticket text');
  if (input.title) assertNoSecrets({ title: input.title }, 'ticket title');
  const now = new Date().toISOString();
  const existing = await readJsonIfExists<TicketRecord>(fileOf(config, ref));
  let textFile = existing?.textFile ?? null;
  if (input.text?.trim()) {
    textFile = resolve(ticketsDir(config), `${ref}.md`);
    await ensureDir(ticketsDir(config));
    await writeTextAtomic(textFile, `${input.text.trim()}\n`);
  }
  if (existing) {
    const has = existing.repos.some((r) => r.id === input.repo.id);
    const repos = has ? existing.repos : [...existing.repos, await repoStart(input.repo, input.base)];
    const journal: JournalEntry[] = [...existing.journal];
    if (!has) journal.push({ at: now, kind: 'repo', text: input.repo.name, repo: input.repo.id });
    if (existing.status === 'done') journal.push({ at: now, kind: 'reopen', text: '' });
    const record = await saveTicket(config, {
      ...existing,
      ...(title && (existing.auto || existing.title === existing.ref) ? { title } : {}),
      repos, status: 'active', doneAt: null, auto: existing.auto && Boolean(input.auto), textFile, journal,
    });
    return { record, created: false, attached: !has };
  }
  const start = await repoStart(input.repo, input.base);
  const record = await saveTicket(config, {
    version: 1, ref, title: title ?? ref,
    repos: [start], status: 'active', startedAt: now, updatedAt: now, doneAt: null, auto: Boolean(input.auto), textFile,
    journal: [{ at: now, kind: 'start', text: start.branch ? `branch ${start.branch}` : '', repo: input.repo.id, ...(start.base ? { sha: start.base } : {}) }],
  });
  return { record, created: true, attached: false };
}

/** Add what the work taught to the ticket's journal: a decision, a trap, a question, a note. */
export async function addJournal(config: OkbConfig, ref: string, entry: { kind: (typeof NOTE_KINDS)[number]; text: string; repo?: string }): Promise<TicketRecord> {
  const record = await loadTicket(config, ref);
  if (!record) throw new OkbError('E_NOT_FOUND', `no ticket ${ref}`, { key: 'ticketUnknown', params: { ref } });
  const text = entry.text.trim().slice(0, MAX_TEXT);
  if (!text) throw new OkbError('E_INVALID', 'empty note', { key: 'ticketEmptyNote' });
  assertNoSecrets({ text }, 'ticket note');
  return saveTicket(config, { ...record, journal: [...record.journal, { at: new Date().toISOString(), kind: entry.kind, text, ...(entry.repo ? { repo: entry.repo } : {}) }] });
}

export async function finishTicket(config: OkbConfig, ref: string): Promise<TicketRecord> {
  const record = await loadTicket(config, ref);
  if (!record) throw new OkbError('E_NOT_FOUND', `no ticket ${ref}`, { key: 'ticketUnknown', params: { ref } });
  if (record.status === 'done') return record;
  const now = new Date().toISOString();
  return saveTicket(config, { ...record, status: 'done', doneAt: now, journal: [...record.journal, { at: now, kind: 'done', text: '' }] });
}

export async function ticketText(record: TicketRecord): Promise<string | null> {
  return record.textFile ? readTextIfExists(record.textFile) : null;
}

/* ------------------------------------------------------------- following */

export type RepoProgress = {
  readonly id: string;
  readonly branch: string | null;
  readonly commits: number;
  /** The branch's last commit is in the main line. */
  readonly merged: boolean;
  /** The branch no longer exists here. */
  readonly gone: boolean;
};

/**
 * Bring the journal up to date with the commits made on the ticket's branch
 * (subjects are kept, so a squash or a deleted branch loses nothing), and
 * learn the branch when the work started before it existed.
 */
export async function syncTicket(config: OkbConfig, record: TicketRecord, repos: readonly RepoEntry[]): Promise<{ record: TicketRecord; added: JournalEntry[]; progress: RepoProgress[] }> {
  const known = new Set(record.journal.filter((j) => j.sha && j.kind === 'commit').map((j) => j.sha));
  const added: JournalEntry[] = [];
  const progress: RepoProgress[] = [];
  const updatedRepos: TicketRepo[] = [];
  let changed = false;
  const others = (await listTickets(config)).filter((t) => t.ref !== record.ref);
  const claimed = (repoId: string, b: string) => others.some((t) => t.repos.some((r) => r.id === repoId && r.branch === b));
  for (const tr of record.repos) {
    const repo = repos.find((r) => r.id === tr.id);
    if (!repo) { updatedRepos.push(tr); continue; }
    const current = await currentBranch(repo.path);
    let branch = tr.branch;
    // Started on the main line, the work moved to a branch: take it unless another ticket owns it.
    if (!branch && record.status === 'active' && current && !MAIN_LINES.has(current) && (current.toUpperCase().includes(record.ref) || !claimed(tr.id, current))) {
      branch = current;
      changed = true;
    }
    const tip = branch ? (current === branch ? 'HEAD' : await revParse(repo.path, branch)) : null;
    const gone = Boolean(branch) && tip === null;
    const commits = tr.base && tip ? await commitsBetween(repo.path, tr.base, tip, 100) : [];
    for (const c of [...commits].reverse()) {
      if (known.has(c.sha)) continue;
      known.add(c.sha);
      added.push({ at: c.date || new Date().toISOString(), kind: 'commit', text: c.subject.slice(0, 300), repo: tr.id, sha: c.sha });
    }
    const all = record.journal.filter((j) => j.kind === 'commit' && j.repo === tr.id).length + added.filter((j) => j.repo === tr.id).length;
    const last = [...record.journal, ...added].filter((j) => j.kind === 'commit' && j.repo === tr.id).at(-1)?.sha;
    const merged = Boolean(last && tr.baseRef && (await isAncestor(repo.path, last, tr.baseRef)));
    progress.push({ id: tr.id, branch, commits: all, merged, gone });
    updatedRepos.push(branch === tr.branch ? tr : { ...tr, branch });
  }
  if (!added.length && !changed) return { record, added, progress };
  const saved = await saveTicket(config, { ...record, repos: updatedRepos, journal: [...record.journal, ...added] });
  return { record: saved, added, progress };
}

/**
 * The ticket the person works on in a repository right now: the one whose
 * branch is checked out, or the one named in the branch (started by itself
 * when `autoStart`), else the last active ticket of this repository that has
 * no branch yet — or, back on the main line, the last one still open.
 */
export async function ticketHere(config: OkbConfig, repo: RepoEntry, refsInBranch: (branch: string) => string[], options: { autoStart?: boolean } = {}): Promise<TicketRecord | null> {
  const branch = await currentBranch(repo.path);
  const tickets = await listTickets(config);
  if (branch && !MAIN_LINES.has(branch)) {
    const onBranch = tickets.find((t) => t.repos.some((r) => r.id === repo.id && r.branch === branch));
    if (onBranch) return onBranch;
    const ref = refsInBranch(branch)[0];
    if (ref) {
      const known = tickets.find((t) => t.ref === ref);
      if (known && known.repos.some((r) => r.id === repo.id)) return known;
      if (options.autoStart) return (await startTicket(config, { ref, repo, auto: true })).record;
      return known ?? null;
    }
  }
  const noBranch = tickets.find((t) => t.status === 'active' && t.repos.some((r) => r.id === repo.id && !r.branch));
  if (noBranch) return noBranch;
  // Back on the main line (after a merge, often): the last ticket still open here, so its note is not forgotten.
  if (!branch || MAIN_LINES.has(branch)) {
    return tickets.find((t) => t.status === 'active' && t.repos.some((r) => r.id === repo.id) && Date.now() - Date.parse(t.updatedAt) < 30 * 86_400_000) ?? null;
  }
  return null;
}

/* ------------------------------------------------------- the ticket note */

function slugOf(ref: string): string {
  return ref.toLowerCase().replace(/^t-/, '');
}

/** The ticket's note in the KB (`tickets/…` at the root of a repository KB, `…/Tickets/<year>/` in a brain). */
export function ticketNoteIn(bundle: Bundle, record: TicketRecord, place: RepoPlace | ((repoId: string) => RepoPlace) = false): string | null {
  const slug = slugOf(record.ref);
  for (const tr of record.repos) {
    const where = typeof place === 'function' ? place(tr.id) : place;
    const prefix = isBrainPlace(where) ? `${where.folder}/${where.tickets}/` : where ? 'tickets/' : `repos/${tr.id}/tickets/`;
    const hit = bundle.entries.find((e) => e.path.startsWith(prefix) && (e.path.toLowerCase().includes(slug) || e.title.toUpperCase().includes(record.ref)));
    if (hit) return hit.path;
  }
  return null;
}
