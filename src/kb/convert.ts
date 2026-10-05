import { stat } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { categorise, loadCategories, templateCategories } from '../categories/categories.js';
import type { OkbConfig } from '../config/schema.js';
import { applyFileEdits, planMove, snapshotFromEntries } from '../links/check.js';
import { planMigration } from '../migrate/migrate.js';
import { parseOkf } from '../okf/document.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { statePaths } from '../state/paths.js';
import { loadTemplates } from '../templates/registry.js';
import { paginate, type Truncation } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeJsonAtomic } from '../util/fsx.js';
import { asBundlePath, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';
import { loadBundleFor } from './bundle.js';

/**
 * Turn a folder of notes written before OKB into a clean OKB knowledge base,
 * without losing a word. Two steps:
 *
 * 1. `scanConversion` reads every note and says what it lacks (front matter,
 *    description, category, portable links) with a first guess; it writes a plan
 *    skeleton. Claude completes the plan: a template, a title and a one-sentence
 *    description per note, from the note itself.
 * 2. `buildConversion` applies the plan in memory — portable links, front matter,
 *    each note filed in its template's folder with every link rewritten — and
 *    returns one proposal. Nothing is written before the person approves it, and
 *    `okb undo` takes it back.
 *
 * The body of a note is never rewritten here: only its front matter, its links
 * and its place. Rewriting a note into its template is a later, per-note choice.
 */
export type LegacyNote = {
  readonly path: string;
  readonly title: string;
  readonly hasFrontmatter: boolean;
  /** Fields OKB requires that the note lacks. */
  readonly missing: readonly string[];
  readonly tags: readonly string[];
  readonly words: number;
  readonly headings: readonly string[];
  /** The start of the note, to judge what it is about without opening it. */
  readonly excerpt: string;
  readonly wikilinks: number;
  /** `repo`: the KB's repository this note is about, when one clearly dominates. */
  readonly guess: { readonly template: string | null; readonly folder: string; readonly repo?: string };
};

export type ConversionScan = {
  readonly kb: string;
  readonly root: string;
  readonly notes: number;
  readonly legacy: number;
  readonly alreadyOkb: number;
  readonly wikilinks: number;
  readonly otherFiles: number;
  readonly unreadable: readonly { path: string; reason: string }[];
  readonly page: readonly LegacyNote[];
  readonly truncation: Truncation;
  readonly planPath: string;
  readonly templates: readonly { id: string; folder: string; type: string }[];
  /** Repositories documented in this KB: a note about one of them goes to `repos/<id>/`. */
  readonly repos: readonly { id: string; name: string }[];
};

const REQUIRED = ['type', 'title', 'description', 'status', 'generated'] as const;
const WIKILINK = /\[\[[^\]]+\]\]/g;

/** Category → the template a converted note of that category gets by default. */
const TEMPLATE_OF: Readonly<Record<string, string>> = {
  concept: 'concept', guide: 'guide', howto: 'procedure', process: 'process', case: 'experience',
  decision: 'decision', source: 'meeting', path: 'path',
};

export function planPathFor(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'drafts', 'convert-plan.json');
}

function isOkbNote(data: Record<string, unknown>): boolean {
  const by = (data.generated as { by?: unknown } | undefined)?.by;
  return typeof by === 'string' && by.startsWith('okb/');
}

function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function scanConversion(config: OkbConfig, options: { limit?: number; cursor?: string | null } = {}): Promise<ConversionScan> {
  const [bundle, categories, templates] = await Promise.all([loadBundleFor(config), loadCategories(config), loadTemplates(config)]);
  const byTemplate = templateCategories(templates);
  const { listRepos } = await import('../repo/registry.js');
  // A repository KB is one repository: its notes stay where the template puts them.
  const repos = config.kb.kind === 'repo' ? [] : (await listRepos().catch(() => [])).filter((r) => r.kb === config.profile.id).map((r) => ({ id: r.id, name: r.name }));
  const repoOf = (path: string, title: string, body: string): string | undefined => {
    const scores = repos.map((r) => {
      const words = [...new Set([r.id, r.name])].filter((w) => w.length >= 3).map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`(^|[^a-z0-9])(${words.join('|')})($|[^a-z0-9])`, 'gi');
      const head = `${path} ${title}`.toLowerCase();
      return { id: r.id, score: (re.test(head) ? 5 : 0) + (body.toLowerCase().match(re)?.length ?? 0) };
    }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
    // Clearly about one repository: it leads, and by a margin.
    return scores[0] && (!scores[1] || scores[0].score >= 2 * scores[1].score) ? scores[0].id : undefined;
  };
  const folderOf = new Map(templates.map((t) => [t.id, t.folder]));
  const legacy: LegacyNote[] = [];
  let alreadyOkb = 0;
  let wikilinks = 0;
  for (const [path, doc] of bundle.docs) {
    if (doc.reserved) continue;
    const data = doc.data as Record<string, unknown>;
    const links = (doc.body.match(WIKILINK) ?? []).length;
    wikilinks += links;
    if (isOkbNote(data)) { alreadyOkb++; continue; }
    const entry = bundle.byPath.get(path)!;
    const missing = REQUIRED.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
    const ext = (data.x_okb ?? {}) as { template?: unknown; category?: unknown };
    const { category } = categorise({ path, type: data.type, template: ext.template, explicit: ext.category }, categories, byTemplate);
    const template = typeof ext.template === 'string' ? ext.template : TEMPLATE_OF[category] ?? null;
    const text = plain(doc.body);
    const repo = repos.length ? repoOf(path, entry.title, text) : undefined;
    const folder = repo ? `repos/${repo}` : template ? folderOf.get(template) ?? '' : posix.dirname(path) === '.' ? '' : posix.dirname(path);
    legacy.push({
      path, title: entry.title, hasFrontmatter: doc.hasFrontmatter, missing, tags: entry.tags,
      words: text ? text.split(' ').length : 0, headings: entry.headings.slice(0, 6), excerpt: text.slice(0, 360),
      wikilinks: links, guess: { template, folder, ...(repo ? { repo } : {}) },
    });
  }
  legacy.sort((a, b) => a.path.localeCompare(b.path));
  const otherFiles = [...bundle.snapshot.files.keys()].filter((f) => !f.endsWith('.md') && !f.startsWith('.okb/')).length;
  const { page, truncation } = paginate(legacy, { limit: options.limit ?? 40, cursor: options.cursor ?? null });
  return {
    kb: config.profile.id, root: config.kb.root, notes: bundle.docs.size, legacy: legacy.length, alreadyOkb, wikilinks, otherFiles,
    unreadable: bundle.unreadable, page, truncation, planPath: planPathFor(config),
    templates: templates.map((t) => ({ id: t.id, folder: t.folder, type: t.okfType })),
    repos,
  };
}

/** A first plan: every note written before OKB, with the guessed template; Claude fills the rest. */
export async function writePlanSkeleton(config: OkbConfig): Promise<{ path: string; notes: number; existed: boolean }> {
  const path = planPathFor(config);
  if ((await readTextIfExists(path)) !== null) return { path, notes: 0, existed: true };
  const all = await scanConversion(config, { limit: 100_000 });
  const notes = all.page.map((n) => ({ path: n.path, template: n.guess.template ?? '', title: n.title, description: '', tags: [...n.tags], ...(n.guess.repo ? { folder: `repos/${n.guess.repo}` } : {}) }));
  await writeJsonAtomic(path, { version: 1, links: true, move: true, notes });
  return { path, notes: notes.length, existed: false };
}

const safeFolder = z.string().max(200).refine((v) => v === '' || v === '.' || (!v.startsWith('/') && !v.split('/').includes('..') && !/[\\:*?"<>|]/.test(v)), 'a folder relative to the KB');
export const conversionPlanSchema = z.object({
  version: z.literal(1),
  /** Turn Obsidian links ([[…]]) and other non-portable links into Markdown links. */
  links: z.boolean().default(true),
  /** File each note in its template's folder (or the folder given). */
  move: z.boolean().default(true),
  notes: z.array(z.object({
    path: z.string().min(1),
    /** Leave this file exactly as it is. */
    keep: z.boolean().optional(),
    template: z.string().optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(400).optional(),
    status: z.enum(['draft', 'stable', 'deprecated']).optional(),
    tags: z.array(z.string().min(1).max(60)).max(12).optional(),
    /** Target folder; '.' keeps the current one; omitted: the template's folder. */
    folder: safeFolder.optional(),
    /** New file name, without folder. */
    name: z.string().max(120).regex(/^[^/\\]+\.md$/).optional(),
  }).strict()),
}).strict();
export type ConversionPlan = z.infer<typeof conversionPlanSchema>;

/** "Les bots RPA.md" → "les-bots-rpa.md". */
export function slugFile(name: string): string {
  const base = name.replace(/\.md$/i, '');
  const slug = base.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${slug || 'note'}.md`;
}

export type ConversionResult = {
  readonly proposal: Proposal;
  readonly converted: number;
  readonly moved: readonly { from: string; to: string }[];
  readonly linksRewritten: number;
  readonly manualLinks: readonly { file: string; line: number; url: string; why: string }[];
  readonly kept: number;
};

export async function buildConversion(config: OkbConfig, raw: unknown): Promise<ConversionResult> {
  const parsed = conversionPlanSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid conversion plan', { detail: { issues: parsed.error.issues.slice(0, 20) }, key: 'convertPlanInvalid' });
  const plan = parsed.data;
  const [bundle, templates] = await Promise.all([loadBundleFor(config), loadTemplates(config)]);
  const byId = new Map(templates.map((t) => [t.id, t]));

  // Check the whole plan before touching anything.
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const n of plan.notes) {
    if (seen.has(n.path)) problems.push(`${n.path}: listed twice`);
    seen.add(n.path);
    if (!bundle.docs.has(n.path as BundlePath)) { problems.push(`${n.path}: no such note`); continue; }
    if (bundle.docs.get(n.path as BundlePath)!.reserved) { problems.push(`${n.path}: reserved navigation file`); continue; }
    if (n.keep) continue;
    if (!n.template || !byId.has(n.template)) problems.push(`${n.path}: unknown template "${n.template ?? ''}"`);
    if (!n.title?.trim()) problems.push(`${n.path}: title missing`);
    if (!n.description || n.description.trim().length < 12) problems.push(`${n.path}: one useful sentence of description is needed`);
  }
  if (problems.length) throw new OkbError('E_INVALID', `the conversion plan has ${problems.length} problem(s)`, { detail: { problems: problems.slice(0, 40) }, key: 'convertPlanProblems', params: { count: String(problems.length), first: problems[0]! } });

  const files = new Map<string, string>(bundle.snapshot.files);
  // 1. Portable links, decided on the original notes (titles as they were).
  let linksRewritten = 0;
  let manualLinks: ConversionResult['manualLinks'] = [];
  if (plan.links) {
    const migration = await planMigration(config, 'portable-links', { bundle });
    for (const c of migration.proposal.changes) if (c.replaceDocument) files.set(c.path, c.replaceDocument.content);
    linksRewritten = migration.edits.length;
    manualLinks = migration.manual;
  }

  // 2. Front matter: what OKB needs, everything already there kept.
  const todo = plan.notes.filter((n) => !n.keep);
  for (const n of todo) {
    const text = files.get(n.path) ?? '';
    const doc = parseOkf(n.path, text);
    const data = { ...(doc.data as Record<string, unknown>) };
    const template = byId.get(n.template!)!;
    let at = new Date().toISOString();
    try { at = (await stat(bundlePathToAbsolute(config.kb.root, n.path))).mtime.toISOString(); } catch { /* keep now */ }
    const tags = [...new Set([...(Array.isArray(data.tags) ? data.tags.map(String) : []), ...(n.tags ?? [])])];
    const front: Record<string, unknown> = {
      type: template.okfType,
      title: n.title!.trim(),
      description: n.description!.trim(),
      status: n.status ?? (typeof data.status === 'string' ? data.status : 'stable'),
      ...(tags.length ? { tags } : {}),
      // Written by a person before OKB: the note says so, with the date of its file.
      generated: data.generated ?? { by: config.profile.humanActor, at },
    };
    for (const [k, v] of Object.entries(data)) if (!(k in front) && k !== 'x_okb') front[k] = v;
    front.x_okb = { ...((data.x_okb as Record<string, unknown> | undefined) ?? {}), template: template.id, converted: new Date().toISOString().slice(0, 10) };
    const body = doc.hasFrontmatter ? doc.body.replace(/^\r?\n/, '') : text;
    files.set(n.path, `---\n${YAML.stringify(front, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.replace(/^\s+/, '')}`);
  }

  // 3. Each note in its folder, every link to it and from it rewritten.
  const moved: { from: string; to: string }[] = [];
  if (plan.move) {
    for (const n of todo) {
      const template = byId.get(n.template!)!;
      const currentDir = posix.dirname(n.path) === '.' ? '' : posix.dirname(n.path);
      const folder = n.folder === '.' ? currentDir : n.folder ?? template.folder;
      const name = n.name ?? slugFile(posix.basename(n.path));
      const to = folder ? `${folder.replace(/\/+$/, '')}/${name}` : name;
      if (to === n.path) continue;
      if (files.has(to)) throw new OkbError('E_CONFLICT', `${to} already exists`, { key: 'convertTargetTaken', params: { from: n.path, to } });
      const snapshot = snapshotFromEntries(files);
      const mv = planMove(snapshot, n.path, to);
      const updated = applyFileEdits(snapshot, [...mv.inbound, ...mv.outbound]);
      for (const [p, text] of updated) files.set(p, text);
      files.set(to, updated.get(asBundlePath(n.path)) ?? files.get(n.path) ?? '');
      files.delete(n.path);
      moved.push({ from: n.path, to });
    }
  }

  const desired = new Map<string, string | null>();
  for (const [p, text] of files) desired.set(p, text);
  for (const p of bundle.snapshot.files.keys()) if (!files.has(p)) desired.set(p, null);
  const proposal = proposeFiles(config, bundle, desired, `conversion to the OKB format (${todo.length} notes)`, true);
  if (!proposal.changes.length) throw new OkbError('E_INVALID', 'the conversion changes nothing', { key: 'convertNothing' });
  return { proposal, converted: todo.length, moved, linksRewritten, manualLinks, kept: plan.notes.length - todo.length };
}
