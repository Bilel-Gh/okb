import { stat } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { categorise, loadCategories, templateCategories } from '../categories/categories.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { applyFileEdits, planMove, snapshotFromEntries } from '../links/check.js';
import { parseOkf } from '../okf/document.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { listRepos } from '../repo/registry.js';
import { statePaths } from '../state/paths.js';
import { loadTemplates } from '../templates/registry.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { asBundlePath, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';
import { addressFor, repoFolderIn, safeName } from './address.js';
import { decorateProposal, newNoteId } from './decorate.js';
import { BRAIN_PRESETS, type BrainLayout, type BrainPreset, type NamesLang } from './layout.js';
import { noteType, type Level } from './types.js';

/**
 * Turn a KB organised before 1.0 into a brain, without losing a word: every
 * note moves to the place its type and subject give it, every link to it and
 * from it is rewritten, it gets its id, and the subjects get their pages.
 * Two steps, like `okb kb convert`: OKB writes a plan with its guesses
 * (`plan`), Claude refines the subjects and themes it cannot guess, then OKB
 * builds one proposal (`build`). Nothing moves before the person approves.
 */
export const migrationEntrySchema = z.object({
  path: z.string().min(1),
  keep: z.boolean().optional(),
  type: z.string().optional(),
  title: z.string().max(200).optional(),
  product: z.string().max(80).optional(),
  repo: z.string().max(80).optional(),
  theme: z.string().max(80).optional(),
  ref: z.string().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  level: z.enum(['root', 'drawer', 'domain', 'product', 'repo']).optional(),
  /** A raw destination folder (inside the brain) when no type fits. */
  folder: z.string().max(240).optional(),
}).strict();
export const migrationPlanSchema = z.object({
  version: z.literal(1),
  preset: z.enum(BRAIN_PRESETS),
  names: z.enum(['fr', 'en']),
  notes: z.array(migrationEntrySchema),
}).strict();
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;
export type MigrationEntry = z.infer<typeof migrationEntrySchema>;

export function brainPlanPath(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'drafts', 'brain-plan.json');
}

/** Category or old template → the brain type a note of it becomes by default. */
const TYPE_OF_CATEGORY: Readonly<Record<string, string>> = {
  concept: 'concept', guide: 'guide', howto: 'procedure', process: 'method', case: 'experience', ticket: 'ticket', decision: 'decision', source: 'meeting', path: 'path',
};
const TYPE_OF_TEMPLATE: Readonly<Record<string, string>> = {
  concept: 'concept', guide: 'guide', procedure: 'procedure', process: 'method', tool: 'tool', automation: 'automation', experience: 'experience', decision: 'decision',
  meeting: 'meeting', tutorial: 'tutorial', 'client-case': 'client-case', path: 'path', 'repo-ticket': 'ticket',
};
const PACK_TYPE: Readonly<Record<string, string>> = {
  'comprendre.md': 'repo-hub', 'overview.md': 'repo-hub', 'demarrer.md': 'repo-start', 'getting-started.md': 'repo-start',
  'architecture.md': 'repo-architecture', 'interfaces.md': 'repo-interfaces', 'livrer-et-exploiter.md': 'repo-delivery', 'delivery.md': 'repo-delivery',
  'carte-du-code.md': 'repo-codemap', 'code-map.md': 'repo-codemap', 'questions-ouvertes.md': 'repo-questions', 'open-questions.md': 'repo-questions',
};

function dateOf(data: Record<string, unknown>, path: string): string | undefined {
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(posix.basename(path))?.[1];
  if (fromName) return fromName;
  const at = (data.generated as { at?: unknown } | undefined)?.at;
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : undefined;
}

/** OKB's first guesses: type from the template or category, repository from `repos/<id>/`. */
export async function planBrainMigration(config: OkbConfig, preset: BrainPreset, names: NamesLang, bundle?: Bundle): Promise<MigrationPlan> {
  const [kb, categories, templates] = await Promise.all([bundle ?? loadBundleFor(config), loadCategories(config), loadTemplates(config)]);
  const byTemplate = templateCategories(templates);
  const repos = (await listRepos().catch(() => [])).filter((r) => r.kb === config.profile.id);
  const notes: MigrationEntry[] = [];
  for (const [path, doc] of kb.docs) {
    if (doc.reserved) { notes.push({ path, keep: true }); continue; }
    const data = doc.data as Record<string, unknown>;
    const ext = (data.x_okb ?? {}) as { template?: unknown; category?: unknown; repo?: { id?: unknown; kind?: unknown } };
    const title = typeof data.title === 'string' ? data.title : undefined;
    const parts = path.split('/');
    // A repository's note (`repos/<id>/…`, or stamped with its id).
    const repoId = parts[0] === 'repos' && parts.length > 2 ? parts[1] : typeof ext.repo?.id === 'string' && ext.repo.id !== '*' ? ext.repo.id : undefined;
    if (repoId && (preset === 'work' || preset === 'projects')) {
      const repo = repos.find((r) => r.id === repoId);
      const repoName = safeName(repo?.name ?? repoId) || repoId;
      const rest = parts[0] === 'repos' ? parts.slice(2).join('/') : posix.basename(path);
      const packType = PACK_TYPE[rest];
      const isTicket = rest.startsWith('tickets/') || ext.repo?.kind === 'ticket';
      const ref = title ? /^([A-Za-z][A-Za-z0-9]{0,15}-\d{1,7})\b/.exec(title)?.[1]?.toUpperCase() : undefined;
      notes.push({
        path, repo: repoName, ...(repo?.product ? { product: repo.product } : {}),
        ...(packType ? { type: packType } : isTicket ? { type: 'ticket', ref: ref ?? (dateOf(data, path) ?? new Date().toISOString().slice(0, 10)), ...(title ? { title: ref ? title.replace(new RegExp(`^${ref}\\s*[—:-]?\\s*`, 'i'), '') : title } : {}), date: dateOf(data, path) } : { folder: rest.includes('/') ? posix.dirname(rest) : '', ...(title ? { title } : {}) }),
        ...(packType && title ? {} : {}),
      });
      continue;
    }
    const { category } = categorise({ path, type: data.type, template: ext.template, explicit: ext.category }, categories, byTemplate);
    const type = (typeof ext.template === 'string' ? TYPE_OF_TEMPLATE[ext.template] : undefined) ?? TYPE_OF_CATEGORY[category] ?? 'guide';
    const t = noteType(type);
    const usable = t && (!t.presets || t.presets.includes(preset)) ? type : 'guide';
    notes.push({ path, type: usable, ...(title ? { title } : {}), ...(usable === 'meeting' || usable === 'ticket' ? { date: dateOf(data, path) } : {}) });
  }
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { version: 1, preset, names, notes };
}

export async function writeBrainPlan(config: OkbConfig, plan: MigrationPlan): Promise<string> {
  const path = brainPlanPath(config);
  await writeJsonAtomic(path, plan);
  return path;
}

export async function readBrainPlan(config: OkbConfig): Promise<MigrationPlan | null> {
  const raw = await readJsonIfExists<unknown>(brainPlanPath(config));
  if (!raw) return null;
  const parsed = migrationPlanSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid brain plan', { detail: { issues: parsed.error.issues.slice(0, 20) }, key: 'brainPlanInvalid' });
  return parsed.data;
}

export type BrainMigration = {
  readonly proposal: Proposal;
  readonly moves: readonly { readonly from: string; readonly to: string }[];
  readonly kept: number;
  readonly problems: readonly string[];
};

/** Where one entry of the plan goes. */
export function destinationOf(layout: BrainLayout, entry: MigrationEntry, existing: ReadonlySet<string>, today: Date): string | null {
  if (entry.keep) return null;
  if (entry.folder !== undefined && !entry.type) {
    const base = entry.repo ? repoFolderIn(layout, entry.product, entry.repo) : '';
    const folder = [base, entry.folder].filter(Boolean).join('/');
    const name = posix.basename(entry.path);
    return folder ? `${folder}/${name}` : `${addressFor({ layout, today }, { type: 'capture', title: posix.basename(entry.path, '.md'), date: today.toISOString().slice(0, 10) }).path.split('/')[0]}/${name}`;
  }
  const type = noteType(entry.type ?? 'guide');
  if (!type) throw new OkbError('E_INVALID', `unknown type ${entry.type}`, { key: 'brainUnknownType', params: { type: entry.type ?? '' } });
  return addressFor({ layout, existing, today }, {
    type: type.id, title: entry.title ?? posix.basename(entry.path, '.md'),
    ...(entry.product ? { product: entry.product } : {}), ...(entry.repo ? { repo: entry.repo } : {}),
    ...(entry.theme ? { theme: entry.theme } : {}), ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.date ? { date: entry.date } : {}), ...(entry.level ? { level: entry.level as Level } : {}),
  }).path;
}

/** One proposal: every note at its place, its links rewritten, its id; the subjects' pages created. */
export async function buildBrainMigration(config: OkbConfig, raw: unknown): Promise<BrainMigration> {
  const parsed = migrationPlanSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid brain plan', { detail: { issues: parsed.error.issues.slice(0, 20) }, key: 'brainPlanInvalid' });
  const plan = parsed.data;
  const layout: BrainLayout = { preset: plan.preset, lang: plan.names };
  const bundle = await loadBundleFor(config);
  const files = new Map<string, string>(bundle.snapshot.files);
  const problems: string[] = [];
  const today = new Date();
  const taken = new Set<string>();
  const targets = new Map<string, string>();
  // Destinations first, all checked before anything moves.
  for (const entry of plan.notes) {
    if (!bundle.docs.has(entry.path as BundlePath)) { problems.push(`${entry.path}: no such note`); continue; }
    let to: string | null;
    try { to = destinationOf(layout, entry, new Set([...taken]), today); } catch (e) { problems.push(`${entry.path}: ${(e as Error).message}`); continue; }
    if (!to || to === entry.path) continue;
    if (taken.has(to) || (files.has(to) && !plan.notes.some((n) => n.path === to))) {
      // Two notes, one name: the second keeps its own file name in the same folder.
      const alt = `${posix.dirname(to)}/${posix.basename(entry.path)}`;
      if (taken.has(alt) || files.has(alt)) { problems.push(`${entry.path}: ${to} is taken`); continue; }
      to = alt;
    }
    taken.add(to);
    targets.set(entry.path, to);
  }
  if (problems.length) throw new OkbError('E_INVALID', `the brain plan has ${problems.length} problem(s)`, { detail: { problems: problems.slice(0, 40) }, key: 'brainPlanProblems', params: { count: String(problems.length), first: problems[0]! } });

  // Ids and brain positions in the front matter, before the moves (they keep them).
  for (const entry of plan.notes) {
    const to = targets.get(entry.path);
    if (!to && !entry.type) continue;
    const text = files.get(entry.path)!;
    const doc = parseOkf(entry.path, text);
    if (!doc.hasFrontmatter) continue;
    const ext = { ...((doc.data.x_okb as Record<string, unknown> | undefined) ?? {}) };
    const brain = { ...(entry.type ? { type: entry.type } : {}), ...(entry.product ? { product: entry.product } : {}), ...(entry.repo ? { repo: entry.repo } : {}), ...(entry.theme ? { theme: entry.theme } : {}), ...(entry.ref ? { ref: entry.ref } : {}) };
    const next = { ...doc.data, x_okb: { v: 1, ...ext, id: typeof ext.id === 'string' ? ext.id : newNoteId(), ...(Object.keys(brain).length ? { brain } : {}) } };
    files.set(entry.path, `---\n${YAML.stringify(next, { lineWidth: 0 })}---${doc.eol}${doc.body.startsWith('\n') ? '' : doc.eol}${doc.body}`);
  }
  const moves: { from: string; to: string }[] = [];
  for (const [from, to] of targets) {
    const snapshot = snapshotFromEntries(files);
    const mv = planMove(snapshot, from, to);
    const updated = applyFileEdits(snapshot, [...mv.inbound, ...mv.outbound]);
    for (const [p, text] of updated) files.set(p, text);
    files.set(to, updated.get(asBundlePath(from)) ?? files.get(from)!);
    files.delete(from);
    moves.push({ from, to });
  }
  const desired = new Map<string, string | null>();
  for (const [p, text] of files) desired.set(p, text);
  for (const p of bundle.snapshot.files.keys()) if (!files.has(p)) desired.set(p, null);
  const raw0 = proposeFiles(config, bundle, desired, `brain migration (${plan.preset}, ${moves.length} notes)`, true);
  // The moves travel with the proposal: the history of a note follows it to its new place.
  const proposal = { ...raw0, notes: [...raw0.notes, ...moves.map((m) => `move ${JSON.stringify(m)}`)] };
  if (!proposal.changes.length) throw new OkbError('E_INVALID', 'the brain migration changes nothing', { key: 'brainNothing' });
  // The brain's pages and breadcrumbs, as if the KB were already a brain.
  const asBrain = { ...config, kb: { ...config.kb, brain: { preset: plan.preset, names: plan.names, views: config.kb.brain?.views ?? 'app', version: 1 as const } } };
  const remaining = new Set<string>([...files.keys()]);
  const decorated = decorateProposal(asBrain, new Set([...bundle.snapshot.files.keys()].filter((p) => remaining.has(p))), proposal);
  return { proposal: decorated, moves, kept: plan.notes.filter((n) => n.keep).length, problems };
}

export async function fileMtime(config: OkbConfig, path: string): Promise<string | null> {
  try { return (await stat(bundlePathToAbsolute(config.kb.root, path))).mtime.toISOString(); } catch { return null; }
}
