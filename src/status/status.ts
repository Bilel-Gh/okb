import { isConceptEntry } from '../concepts/one-liner.js';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Receipt } from '../apply/apply.js';
import { BUILTIN_CATEGORIES, categorise, loadCategories, templateCategories } from '../categories/categories.js';
import { loadTemplates } from '../templates/registry.js';
import type { OkbConfig } from '../config/schema.js';
import { readFocus, type LastSession } from '../focus/focus.js';
import { listInbox } from '../inbox/inbox.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { readOwner } from '../kb/registry.js';
import { maintain, type MaintainReport } from '../maintain/maintain.js';
import type { Proposal } from '../proposal/model.js';
import { listProposals, loadProposal } from '../proposal/store.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists } from '../util/fsx.js';

const dayMs = 86_400_000;

/* ---------- Proposals as people see them ---------- */

export type ProposalSummary = {
  readonly id: string;
  /** 1, 2, 3… newest first among the pending ones: what `okb review 1` accepts. */
  readonly number: number | null;
  readonly title: string;
  readonly status: Proposal['status'];
  readonly createdAt: string;
  readonly files: number;
  readonly created: number;
  readonly updated: number;
  readonly changes: number;
};

function titleOf(content: string | undefined): string | null {
  const m = content?.match(/^---\n[\s\S]*?^title:\s*"?(.+?)"?\s*$/m);
  return m ? m[1]!.replace(/\\"/g, '"') : null;
}

/** "🗺️ Vue d'ensemble +28", "Navigation refresh", "move a.md to b.md". */
export function proposalTitle(p: Proposal): string {
  const created = p.changes.filter((c) => c.kind === 'create-document');
  const titles = created.map((c) => titleOf((c as { createDocument?: { content?: string } }).createDocument?.content)).filter((x): x is string => Boolean(x));
  const articles = created.filter((c) => c.category === 'article');
  const lead = titles.find((_, i) => created[i]?.category === 'article') ?? titles[0];
  const files = new Set(p.changes.map((c) => c.path)).size;
  if (lead) return files > 1 ? `${lead} +${files - 1}` : lead;
  const label = p.changes[0]?.label ?? p.notes[0] ?? p.id;
  return articles.length ? label : label.replace(/^create /, '');
}

export function summarize(p: Proposal, number: number | null): ProposalSummary {
  const byPath = new Map<string, string>();
  for (const c of p.changes) if (!byPath.has(c.path) || c.kind === 'create-document') byPath.set(c.path, c.kind);
  return {
    id: p.id, number, title: proposalTitle(p), status: p.status, createdAt: p.createdAt,
    files: byPath.size,
    created: [...byPath.values()].filter((k) => k === 'create-document').length,
    updated: [...byPath.values()].filter((k) => k !== 'create-document' && k !== 'delete-document').length,
    changes: p.changes.length,
  };
}

/** Pending first (numbered), then the rest; `all` includes superseded drafts. */
export async function proposalSummaries(config: OkbConfig, options: { all?: boolean } = {}): Promise<ProposalSummary[]> {
  const proposals = (await listProposals(config)).filter((p) => p.profileId === config.profile.id);
  const pending = proposals.filter((p) => p.status === 'prepared').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rest = proposals.filter((p) => p.status !== 'prepared' && (options.all || p.status !== 'superseded')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...pending.map((p, i) => summarize(p, i + 1)), ...rest.map((p) => summarize(p, null))];
}

/** `1`, `#2`, a prefix of an id (`p-7d51`, `7d51`) or a full id. */
export async function resolveProposalRef(config: OkbConfig, ref: string): Promise<Proposal> {
  const clean = ref.trim().replace(/^#/, '');
  if (/^\d{1,3}$/.test(clean)) {
    const pending = (await proposalSummaries(config)).filter((s) => s.number !== null);
    const hit = pending.find((s) => s.number === Number(clean));
    if (!hit) throw new OkbError('E_NOT_FOUND', `no pending proposal number ${clean}`, { key: 'proposalNumberUnknown', params: { n: clean, count: pending.length } });
    return loadProposal(config, hit.id);
  }
  const full = clean.startsWith('p-') ? clean : `p-${clean}`;
  if (/^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(full)) return loadProposal(config, full);
  const all = await listProposals(config);
  const hits = all.filter((p) => p.id.startsWith(full));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) throw new OkbError('E_INVALID', `"${ref}" matches several proposals`, { key: 'proposalAmbiguous', params: { ref, count: hits.length } });
  return loadProposal(config, clean);
}

/* ---------- Receipts: what was applied, what can be undone ---------- */

export type ReceiptSummary = {
  readonly id: string;
  readonly proposalId: string;
  readonly appliedAt: string;
  readonly files: number;
  readonly created: number;
  readonly updated: number;
  readonly rolledBack: boolean;
  readonly complete: boolean;
  readonly sameKb: boolean;
  readonly createdPaths: readonly string[];
};

export async function receipts(config: OkbConfig): Promise<ReceiptSummary[]> {
  const dir = statePaths(config).receipts;
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: ReceiptSummary[] = [];
  for (const name of names) {
    const r = await readJsonIfExists<Receipt>(resolve(dir, name));
    if (!r || !Array.isArray(r.results)) continue;
    out.push({
      id: r.id, proposalId: r.proposalId, appliedAt: r.appliedAt, files: r.results.length,
      created: r.results.filter((x) => x.action === 'created').length,
      updated: r.results.filter((x) => x.action === 'updated').length,
      rolledBack: Boolean(r.rolledBack), complete: r.complete,
      sameKb: resolve(r.kbRoot) === resolve(config.kb.root),
      createdPaths: r.results.filter((x) => x.action === 'created').map((x) => x.path),
    });
  }
  return out.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

/** The most recent apply that can still be undone in this KB. */
export async function lastUndoable(config: OkbConfig): Promise<ReceiptSummary | null> {
  return (await receipts(config)).find((r) => r.complete && !r.rolledBack && r.sameKb) ?? null;
}

/* ---------- Health ---------- */

export type Health = { readonly score: number; readonly errors: number; readonly warnings: number; readonly infos: number; readonly byCode: Readonly<Record<string, { level: string; count: number }>> };

export function health(report: MaintainReport): Health {
  const byCode: Record<string, { level: string; count: number }> = {};
  let errors = 0, warnings = 0, infos = 0;
  const all = [...report.okfFindings.map((f) => [f.code, f.level]), ...report.linkIssues.map((i) => [i.code, i.level]), ...report.issues.map((i) => [i.code, i.level])];
  for (const [code, level] of all) {
    if (level === 'error') errors++;
    else if (level === 'warning') warnings++;
    else infos++;
    const entry = byCode[code!] ?? { level: level!, count: 0 };
    entry.count++;
    byCode[code!] = entry;
  }
  // Errors weigh far more than warnings; a big KB is not punished for its size.
  const scale = Math.max(1, Math.sqrt(Math.max(report.scanned, 1) / 20));
  const score = Math.max(0, Math.round(100 - (errors * 12 + warnings * 2) / scale));
  return { score, errors, warnings, infos, byCode };
}

/* ---------- Git ---------- */

export type GitState = { readonly repo: boolean; readonly dirty: number; readonly ahead: number | null; readonly remote: string | null };

export async function gitState(root: string): Promise<GitState> {
  const run = promisify(execFile);
  const git = (args: string[]) => run('git', ['-C', root, ...args], { timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }).then((r) => r.stdout.trim());
  try {
    const top = await git(['rev-parse', '--show-toplevel']);
    if (resolve(top) !== resolve(root)) return { repo: false, dirty: 0, ahead: null, remote: null };
  } catch {
    return { repo: false, dirty: 0, ahead: null, remote: null };
  }
  const dirty = (await git(['status', '--porcelain']).catch(() => '')).split('\n').filter(Boolean).length;
  const remote = (await git(['remote', 'get-url', 'origin']).catch(() => '')) || null;
  const ahead = await git(['rev-list', '--count', '@{upstream}..HEAD']).then(Number, () => null);
  return { repo: true, dirty, ahead, remote };
}

/* ---------- The dashboard ---------- */

export type Status = {
  readonly profile: string;
  readonly name: string;
  readonly kbRoot: string;
  readonly writingLanguage: string;
  readonly notes: number;
  readonly concepts: number;
  /** Notes per category (src/categories), in category order, empty ones left out. */
  readonly categories: readonly { readonly id: string; readonly emoji: string; readonly ansi: number; readonly label: string; readonly count: number }[];
  readonly focus: { readonly exists: boolean; readonly path: string; readonly ageDays: number | null; readonly stale: boolean };
  readonly lastSession: LastSession | null;
  readonly inbox: { readonly open: number; readonly oldestDays: number | null };
  readonly pending: readonly ProposalSummary[];
  readonly lastApply: ReceiptSummary | null;
  readonly health: Health | null;
  readonly toReview: number;
  readonly git: GitState;
  readonly owned: boolean;
};

export async function computeStatus(config: OkbConfig, options: { bundle?: Bundle; now?: Date; light?: boolean } = {}): Promise<Status> {
  const now = options.now ?? new Date();
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const conceptsPrefix = `${config.kb.layout.concepts}/`;
  const notes = bundle.entries.filter((e) => !e.reserved && !e.path.endsWith('index.md'));
  const [cats, templates] = await Promise.all([loadCategories(config).catch(() => [...BUILTIN_CATEGORIES]), loadTemplates(config).catch(() => [])]);
  const byTemplate = templateCategories(templates);
  const perCategory = new Map<string, number>();
  for (const e of notes) {
    const { category } = categorise({ path: e.path, type: e.type, template: e.ext.template, explicit: (e.ext as { category?: unknown }).category }, cats, byTemplate);
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
  }
  const language = config.writing.language ?? config.profile.answer.language;
  const [focus, inbox, summaries, applied, report, git, owner] = await Promise.all([
    readFocus(config, { now }), listInbox(config, { now }), proposalSummaries(config), receipts(config),
    options.light ? Promise.resolve(null) : maintain(config, { bundle, now }),
    options.light ? Promise.resolve({ repo: false, dirty: 0, ahead: null, remote: null } as GitState) : gitState(config.kb.root),
    readOwner(config.kb.root),
  ]);
  // Notes created 1, 7, 30 or 90 days ago and still present: the weekly review's spaced re-reading.
  const present = new Set(notes.map((n) => n.path as string));
  const firstCreated = new Map<string, number>();
  for (const r of [...applied].reverse()) {
    if (!r.complete || r.rolledBack || !r.sameKb) continue;
    for (const p of r.createdPaths) if (!firstCreated.has(p)) firstCreated.set(p, Date.parse(r.appliedAt));
  }
  let toReview = 0;
  for (const [path, at] of firstCreated) {
    const age = Math.floor((now.getTime() - at) / dayMs);
    if (present.has(path) && [1, 7, 30, 90].includes(age)) toReview++;
  }
  return {
    profile: config.profile.id,
    name: config.profile.displayName || config.profile.id,
    kbRoot: config.kb.root,
    writingLanguage: config.profile.answer.language,
    notes: notes.length,
    // A concept card is one by its type, wherever a brain files it (a drawer, a domain, a product).
    concepts: notes.filter((e) => e.path.startsWith(conceptsPrefix) || isConceptEntry(e)).length,
    categories: cats.filter((c) => perCategory.get(c.id)).map((c) => ({ id: c.id, emoji: c.emoji, ansi: c.ansi, label: language.startsWith('fr') ? c.label.fr : c.label.en, count: perCategory.get(c.id)! })),
    focus: { exists: focus.exists, path: focus.path, ageDays: focus.ageDays, stale: focus.stale },
    lastSession: focus.lastSession,
    inbox: { open: inbox.length, oldestDays: inbox[0]?.ageDays ?? null },
    pending: summaries.filter((s) => s.status === 'prepared'),
    lastApply: applied.find((r) => r.complete && !r.rolledBack && r.sameKb) ?? null,
    health: report ? health(report) : null,
    toReview,
    git,
    owned: owner === config.profile.id,
  };
}
