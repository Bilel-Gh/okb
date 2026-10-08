import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { productFolderIn } from '../brain/address.js';
import { layoutOf, type BrainLayout } from '../brain/layout.js';
import { repoPlace } from '../brain/products.js';
import { positionOf } from '../brain/tree.js';
import { NOTE_TYPES, type NoteType } from '../brain/types.js';
import type { OkbConfig } from '../config/schema.js';
import { notesAboutFile } from '../find/find.js';
import type { Bundle } from '../kb/bundle.js';
import { readRootConfig } from '../kb/registry.js';
import { branchBase, commitsBetween, currentBranch, diffNames, recentSubjects, type FileChange } from '../repo/git.js';
import { repoFolder } from '../repo/pack.js';
import type { RepoEntry } from '../repo/registry.js';
import type { TicketRecord } from '../work/tickets.js';

/**
 * What the developer module reads before it helps: the team's rules before a
 * review, the facts of a branch before a commit or a pull request, what a
 * product already has before writing about it. No AI and nothing written:
 * Claude gets located facts and keeps the person's yes for anything else.
 */

type Entry = Bundle['entries'][number];
export type NoteRef = { readonly path: string; readonly title: string; readonly type: string | null };

/** The kind of a note: its brain type, else the type its template belongs to. */
export function noteKind(e: Pick<Entry, 'ext'>): string | null {
  const brain = (e.ext as { brain?: { type?: string } }).brain?.type;
  if (brain) return brain;
  const tpl = (e.ext as { template?: string }).template;
  if (!tpl) return null;
  return NOTE_TYPES.find((t) => t.id === tpl)?.id ?? NOTE_TYPES.find((t) => t.template === tpl)?.id ?? null;
}

const ref = (e: Entry): NoteRef => ({ path: e.path, title: e.title, type: noteKind(e) });

/** Where a note sits for a repository: its own folder, its product, or shared by everyone. */
type Level = 'repo' | 'product' | 'shared' | 'other';

async function levelOf(config: OkbConfig, repo: RepoEntry | null): Promise<(path: string) => Level> {
  const layout = layoutOf(config);
  const folder = repo ? repoFolder(repo.id, await repoPlace(config, repo)) : null;
  const product = layout && repo?.product ? repo.product : null;
  return (path: string) => {
    if (folder && path.startsWith(`${folder}/`)) return 'repo';
    if (layout) {
      const pos = positionOf(layout, path);
      if (pos.repo) return 'other';
      if (pos.product) return product && pos.product === product ? 'product' : 'other';
      return 'shared';
    }
    return path.startsWith('repos/') ? 'other' : 'shared';
  };
}

/* ------------------------------------------------------------ review */

const RULE_KINDS = new Set(['team-rule', 'review-lessons', 'conventions']);
const REVIEW_WORDS = /revue|review|pull request|\bPR\b|merge|relecture|qualit/i;

export type ReviewContext = {
  readonly repo: { readonly id: string; readonly name: string } | null;
  readonly base: string | null;
  readonly files: readonly string[];
  /** Team rules, review lessons, the repository's conventions and review checklists: what the review checks first. */
  readonly rules: readonly (NoteRef & { readonly level: Level })[];
  /** Notes that explain a changed file: read them before judging the change. */
  readonly aboutFiles: readonly { readonly file: string; readonly notes: readonly { path: string; title: string; why: string }[] }[];
  /** Known errors and debugging notes of the repository and its product: traps a change may fall into again. */
  readonly traps: readonly (NoteRef & { readonly level: Level })[];
  /** The note where new review lessons go (it may not exist yet). */
  readonly lessons: NoteRef | null;
};

export async function reviewContext(config: OkbConfig, bundle: Bundle, input: { repo: RepoEntry | null; files: readonly string[]; base?: string | null; anchors?: Readonly<Record<string, { files?: Record<string, unknown> }>> }): Promise<ReviewContext> {
  const level = await levelOf(config, input.repo);
  const rules: (NoteRef & { level: Level })[] = [];
  const traps: (NoteRef & { level: Level })[] = [];
  let lessons: NoteRef | null = null;
  for (const e of bundle.entries) {
    if (e.reserved) continue;
    const kind = noteKind(e);
    const where = level(e.path);
    if (where === 'other') continue;
    if ((kind && RULE_KINDS.has(kind)) || (kind === 'checklist' && REVIEW_WORDS.test(e.title))) rules.push({ ...ref(e), level: where });
    if (kind === 'review-lessons' && (!lessons || where === 'repo')) lessons = ref(e);
    if ((kind === 'known-error' || kind === 'repo-debug') && where !== 'shared') traps.push({ ...ref(e), level: where });
  }
  const order: Record<Level, number> = { repo: 0, product: 1, shared: 2, other: 3 };
  rules.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
  traps.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
  const aboutFiles = input.repo
    ? input.files.slice(0, 40).map((file) => ({ file, notes: notesAboutFile(bundle, input.repo!.name, file, input.anchors ?? {}) })).filter((f) => f.notes.length)
    : [];
  return {
    repo: input.repo ? { id: input.repo.id, name: input.repo.name } : null,
    base: input.base ?? null, files: input.files, rules, aboutFiles, traps: traps.slice(0, 20), lessons,
  };
}

/** The files a branch changes since its base, for a review without a list. */
export async function changedFiles(root: string, base?: string): Promise<{ base: string | null; files: FileChange[] }> {
  const b = await branchBase(root, base);
  if (!b) return { base: null, files: [] };
  return { base: b.ref, files: (await diffNames(root, b.sha)) ?? [] };
}

/* -------------------------------------------------------------- ship */

const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|tests|perf|build|ci|style|revert)(\([^)]+\))?!?: /i;
const TICKET_PREFIX = /^\[?[A-Z][A-Z0-9]+-\d+\]?[:\s-]/;
const FR_WORDS = /\b(ajout|ajoute|correction|corrige|mise à jour|suppression|supprime|pour|les|des|du|une)\b/i;
const EN_WORDS = /\b(add|adds|fix|fixes|update|remove|the|for|when|use)\b/i;

export type CommitStyle = {
  /** Share of recent subjects in the `type(scope): …` form. */
  readonly conventional: number;
  /** Share starting with a ticket reference (`ABC-123: …`, `[ABC-123] …`). */
  readonly ticketPrefix: number;
  readonly language: 'fr' | 'en' | null;
  /** A few recent subjects to imitate. */
  readonly samples: readonly string[];
};

export function commitStyle(subjects: readonly string[]): CommitStyle {
  const s = subjects.filter((x) => !/^Merge /.test(x)).slice(0, 50);
  const share = (re: RegExp) => (s.length ? Math.round((s.filter((x) => re.test(x)).length / s.length) * 100) / 100 : 0);
  const fr = s.filter((x) => FR_WORDS.test(x)).length;
  const en = s.filter((x) => EN_WORDS.test(x)).length;
  return {
    conventional: share(CONVENTIONAL), ticketPrefix: share(TICKET_PREFIX),
    language: fr === en ? null : fr > en ? 'fr' : 'en', samples: s.slice(0, 6),
  };
}

const PR_TEMPLATES = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md', '.gitlab/merge_request_templates/Default.md'];

export type ShipFacts = {
  readonly repo: { readonly id: string; readonly name: string; readonly path: string };
  readonly branch: string | null;
  readonly base: string | null;
  readonly ticket: {
    readonly ref: string; readonly title: string; readonly status: string;
    readonly note: string | null;
    readonly decisions: readonly string[]; readonly traps: readonly string[]; readonly questions: readonly string[];
  } | null;
  readonly commits: readonly { readonly sha: string; readonly subject: string }[];
  readonly files: readonly FileChange[];
  readonly style: CommitStyle;
  readonly prTemplate: { readonly path: string; readonly text: string } | null;
  /** `off`: no « generated with » line and no co-author in what Claude drafts (setting `dev.attribution`). */
  readonly attribution: 'off' | 'on';
};

export async function attributionSetting(env: NodeJS.ProcessEnv = process.env): Promise<'off' | 'on'> {
  const root = (await readRootConfig(env).catch(() => ({}))) as { dev?: { attribution?: unknown } };
  return root.dev?.attribution === 'on' ? 'on' : 'off';
}

export async function shipFacts(repo: RepoEntry, input: { base?: string; ticket: TicketRecord | null; ticketNote: string | null; env?: NodeJS.ProcessEnv }): Promise<ShipFacts> {
  const root = repo.path;
  const b = await branchBase(root, input.base);
  const commits = b ? await commitsBetween(root, b.sha, 'HEAD', 100) : [];
  const files = b ? (await diffNames(root, b.sha)) ?? [] : [];
  let prTemplate: ShipFacts['prTemplate'] = null;
  for (const p of PR_TEMPLATES) {
    const text = await readFile(resolve(root, p), 'utf8').catch(() => null);
    if (text !== null) { prTemplate = { path: p, text: text.slice(0, 4000) }; break; }
  }
  const t = input.ticket;
  const journal = (kind: string) => (t?.journal ?? []).filter((j) => j.kind === kind && (!j.repo || j.repo === repo.id)).map((j) => j.text).slice(-12);
  return {
    repo: { id: repo.id, name: repo.name, path: root },
    branch: await currentBranch(root), base: b?.ref ?? null,
    ticket: t ? { ref: t.ref, title: t.title, status: t.status, note: input.ticketNote, decisions: journal('decision'), traps: journal('trap'), questions: journal('question') } : null,
    commits: commits.map((c) => ({ sha: c.sha.slice(0, 10), subject: c.subject })),
    files, style: commitStyle(await recentSubjects(root, 80)), prTemplate,
    attribution: await attributionSetting(input.env),
  };
}

/* ----------------------------------------------------------- product */

export type ProductView = {
  readonly name: string;
  readonly folder: string;
  readonly hub: string | null;
  readonly notes: number;
  /** The product's sides (Fonctionnel, Architecture, Code, Support…) with their note counts. */
  readonly sides: readonly { readonly name: string; readonly notes: number }[];
  /** The kinds of note a product usually has, those it has and those still missing. */
  readonly have: readonly { readonly type: string; readonly label: string; readonly notes: readonly NoteRef[] }[];
  readonly missing: readonly { readonly type: string; readonly label: string; readonly cost: string }[];
};

/** The kinds a product page is made of, in reading order (the functional side, then the architecture). */
const PRODUCT_KINDS = ['overview', 'feature', 'business-rule', 'user-journey', 'roles', 'context', 'containers', 'flow', 'data-model', 'environments', 'decision', 'known-error'];

export function productView(layout: BrainLayout, bundle: Bundle, name: string): ProductView {
  const folder = productFolderIn(layout, name);
  const inside = bundle.entries.filter((e) => !e.reserved && e.path.startsWith(`${folder}/`));
  const sides = new Map<string, number>();
  for (const e of inside) {
    const rest = e.path.slice(folder.length + 1).split('/');
    if (rest.length > 1) sides.set(rest[0]!, (sides.get(rest[0]!) ?? 0) + 1);
  }
  const lang = layout.lang;
  const label = (t: NoteType) => t.label[lang] ?? t.label.en;
  const have: { type: string; label: string; notes: NoteRef[] }[] = [];
  const missing: { type: string; label: string; cost: string }[] = [];
  for (const id of PRODUCT_KINDS) {
    const t = NOTE_TYPES.find((x) => x.id === id);
    if (!t || (t.presets && !t.presets.includes(layout.preset))) continue;
    const notes = inside.filter((e) => noteKind(e) === id && !positionOf(layout, e.path).repo).map(ref);
    if (notes.length) have.push({ type: id, label: label(t), notes });
    else missing.push({ type: id, label: label(t), cost: t.cost });
  }
  const hubPath = `${folder}/${name}.md`;
  return {
    name, folder, hub: bundle.byPath.has(hubPath as never) ? hubPath : null, notes: inside.length,
    sides: [...sides.entries()].map(([n, c]) => ({ name: n, notes: c })).sort((a, b) => b.notes - a.notes), have, missing,
  };
}
