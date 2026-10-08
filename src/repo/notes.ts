import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { isInside } from '../kb/registry.js';
import { prepareProposal, type IngestReport, type IngestTarget } from '../pipeline/ingest.js';
import { listProposals, saveProposal } from '../proposal/store.js';
import { assertNoSecrets } from '../security/guard.js';
import { acquire, extractSource } from '../sources/registry.js';
import { OkbError } from '../util/errors.js';
import { writeJsonAtomic, writeTextAtomic } from '../util/fsx.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { locateQuote, resolveDossier, type DossierV3 } from './dossier.js';
import { getTemplate, sectionHeading } from '../templates/registry.js';
import { gitIdentity } from './git.js';
import { isBrainPlace, notePath, noteDescription, noteTitle, packNote, repoFolder, REPOS_FOLDER, ticketPath, type RepoPlace } from './pack.js';
import { repoPlace } from '../brain/products.js';
import { questionById, type NoteKind } from './questions.js';
import type { RepoEntry } from './registry.js';
import { addCoverage, ensureRepoState, listJson, loadProgress, repoPaths, saveProgress, type RepoPaths } from './state.js';

export type RepoContext = { readonly repo: RepoEntry; readonly config: OkbConfig; readonly paths: RepoPaths };

export async function repoContext(config: OkbConfig, repo: RepoEntry): Promise<RepoContext> {
  const paths = repoPaths(config, repo.id);
  await ensureRepoState(paths);
  return { repo, config, paths };
}

function language(config: OkbConfig): string {
  return config.writing.language ?? config.profile.answer.language;
}

/* ------------------------------------------------------------ repo notes */

export type RepoNote = { readonly path: BundlePath; readonly title: string; readonly kind: string; readonly commit: string | null };

/**
 * Notes of this repository in the KB: by `x_okb.repo.id`, or by living under
 * `repos/<id>/` — in a repository KB (`flat`), its notes and its `tickets/`.
 */
export function repoNotes(bundle: Bundle, id: string, place: RepoPlace = false): RepoNote[] {
  const out: RepoNote[] = [];
  for (const [path, doc] of bundle.docs) {
    const meta = (doc.data.x_okb as { repo?: { id?: unknown; kind?: unknown; commit?: unknown } } | undefined)?.repo;
    const inFolder = place === true ? path.startsWith('tickets/') : path.startsWith(`${repoFolder(id, place)}/`);
    if (meta?.id !== id && !inFolder) continue;
    if (/(^|\/)index\.md$/.test(path)) continue;
    out.push({
      path,
      title: typeof doc.data.title === 'string' ? doc.data.title : path,
      kind: typeof meta?.kind === 'string' ? meta.kind : /(^|\/)(tickets|Tickets|Tâches)\//.test(path) ? 'ticket' : 'other',
      commit: typeof meta?.commit === 'string' ? meta.commit : null,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Pending proposals that create or change notes of this repository. */
export async function pendingRepoProposals(config: OkbConfig, id: string, place?: RepoPlace): Promise<{ id: string; paths: string[]; createdAt: string }[]> {
  const where = place ?? config.kb.kind === 'repo';
  const prefix = where === true ? '' : `${repoFolder(id, where)}/`;
  return (await listProposals(config))
    .filter((p) => p.status === 'prepared' || p.status === 'partially-applied')
    .map((p) => ({ id: p.id, createdAt: p.createdAt, paths: [...new Set(p.changes.map((c) => c.path as string))].filter((x) => x.startsWith(prefix)) }))
    .filter((p) => p.paths.length > 0);
}

/* ------------------------------------------------------- writing a note */

export type WriteOptions = {
  readonly kind?: NoteKind | 'ticket' | 'other';
  readonly create?: string;
  readonly append?: string;
  readonly heading?: string;
  readonly title?: string;
  readonly description?: string;
  readonly pending?: { readonly files: ReadonlyMap<BundlePath, string>; readonly proposalIds: readonly string[] };
  readonly conceptAssistLevel?: 'off' | 'targeted' | 'pedagogical';
  readonly linkInto?: readonly BundlePath[];
  readonly reprocess?: boolean;
  /** Other private folders the dossier may cite (the repository's own KB state, when writing into its workspace's KB). */
  readonly sourceDirs?: readonly string[];
  /** The accepted suggestion this note answers (required in a brain when Claude writes). */
  readonly suggestion?: string;
  /** The quality reviewer's grade out of 20, kept on a created note for its score. */
  readonly quality?: number;
};

export type WriteResult = {
  readonly report: IngestReport;
  readonly target: IngestTarget;
  readonly dossier: DossierV3;
  readonly coverage: Record<string, 'all' | string[]>;
};

/**
 * Prepare a proposal for one note of the repository pack (or a ticket note)
 * from a version 3 dossier. Nothing is written in the KB: the person approves.
 */
export async function writeRepoNote(ctx: RepoContext, raw: unknown, options: WriteOptions = {}): Promise<WriteResult> {
  const { config, repo, paths } = ctx;
  const lang = language(config);
  const { dossier, resolved } = await resolveDossier(config, raw, repo, [paths.dir, ...(options.sourceDirs ?? [])]);
  const kind = options.kind ?? dossier.note ?? 'other';
  const place = await repoPlace(config, repo);
  const pack = kind !== 'ticket' && kind !== 'other' ? packNote(kind) : null;
  if (kind === 'questions') throw new OkbError('E_INVALID', 'the open-questions note is generated: use okb repo questions --propose', { key: 'repoQuestionsGenerated' });
  const template = dossier.template ?? pack?.template ?? (kind === 'ticket' ? (config.kb.brain ? 'ticket' : 'repo-ticket') : undefined);
  let analysis: Record<string, unknown> = { ...resolved.analysis, ...(template ? { template } : {}) };
  const identity = await gitIdentity(repo.path);
  const repoMeta = { id: repo.id, kind, commit: identity.head, ...(identity.dirty ? { dirty: true } : {}) };
  const bundle = await loadBundleFor(config);

  let target: IngestTarget;
  if (options.append) {
    target = { mode: 'append', path: asBundlePath(options.append), heading: options.heading ?? defaultHeading(lang) };
  } else if (options.create) {
    target = createTarget(asBundlePath(options.create), options, kind, repo, lang, repoMeta, place);
  } else if (pack) {
    const path = notePath(repo.id, pack.kind, lang, place);
    if (bundle.byPath.has(path) || options.pending?.files.has(path)) {
      if (!options.heading) {
        throw new OkbError('E_CONFLICT', `${path} already exists`, { key: 'repoNoteExists', params: { path }, hint: `Add a dated section with --heading "…", or revise it with okb revise ${path}.` });
      }
      target = { mode: 'append', path, heading: options.heading };
    } else {
      target = createTarget(path, options, kind, repo, lang, repoMeta, place);
    }
  } else if (kind === 'ticket') {
    if (!options.title) throw new OkbError('E_INVALID', 'a ticket note needs --title', { key: 'repoTicketTitle' });
    target = createTarget(ticketPath(repo.id, options.title, new Date(), place), options, kind, repo, lang, repoMeta, place);
  } else {
    throw new OkbError('E_INVALID', 'choose where the note goes: --note <kind>, --create <path> or --append <path>', { key: 'repoWriteTarget' });
  }

  // In a brain, a note Claude writes needs the person's accepted suggestion (a pack covers the repository's folder).
  const { requireAccepted, linkProposal } = await import('../suggest/guard.js');
  const accepted = await requireAccepted(config, target.path, options.suggestion);
  if (target.mode === 'append' && template) analysis = await asUpdateSections(config, analysis, template, lang);
  const report = await prepareProposal(config, resolved.docs, {
    target,
    analysis,
    notes: resolved.notes,
    notice: noticeFor(lang, repo.name, identity.head, identity.dirty, resolved.docs.some((d) => d.source.adapter !== 'repo-excerpt')),
    // A shared note (concepts, guides, decisions…) keeps belonging to the whole KB: no repository stamp.
    ...(target.mode === 'append' && !isShared(bundle, target.path, repo.id, place) ? { xOkbPatch: { repo: { ...repoMeta, kind: existingKind(bundle, target.path) ?? kind } } } : {}),
    ...(options.pending ? { pending: options.pending } : {}),
    ...(options.conceptAssistLevel ? { conceptAssistLevel: options.conceptAssistLevel } : {}),
    ...(options.linkInto?.length ? { linkInto: options.linkInto } : {}),
    ...(options.reprocess ? { reprocess: true } : {}),
  });
  if (report.proposal.changes.length) { await saveProposal(config, report.proposal); await linkProposal(config, accepted, report.proposal.id); }

  const progress = await loadProgress(paths);
  const now = new Date().toISOString();
  for (const [file, lines] of Object.entries(resolved.coverage)) addCoverage(progress, file, lines, identity.head, 'note');
  for (const q of dossier.answers) {
    if (!questionById(q)) continue;
    progress.questions[q] = { status: 'answered', note: target.path, proposalId: report.proposal.id, at: now };
  }
  for (const u of dossier.unknowns) {
    if (!u.question || !questionById(u.question) || progress.questions[u.question]?.status === 'answered') continue;
    progress.questions[u.question] = { status: 'unknown', why: u.text, ...(u.askWho ? { askWho: u.askWho } : {}), looked: u.looked, at: now };
  }
  if (report.proposal.changes.length) {
    progress.anchors[target.path] = { commit: identity.head, files: resolved.files, quotes: resolved.quotes, proposalId: report.proposal.id, kind: kind === 'other' ? 'other' : kind, at: now };
  }
  await saveProgress(paths, progress);
  return { report, target, dossier, coverage: resolved.coverage };
}

/** The opening line of a repository note: where its facts come from, and how far they go. */
export function noticeFor(lang: string, name: string, head: string | null, dirty: boolean, otherSources: boolean): string {
  const fr = lang.toLowerCase().startsWith('fr');
  const commit = head ? head.slice(0, 7) : null;
  const day = new Date().toISOString().slice(0, 10);
  const where = fr
    ? `Écrit depuis le code et la doc de **${name}**${commit ? ` au commit \`${commit}\`${dirty ? ' (avec des modifications non commitées)' : ''}` : ''}, le ${day}${otherSources ? ', et d’autres sources citées' : ''}.`
    : `Written from the code and docs of **${name}**${commit ? ` at commit \`${commit}\`${dirty ? ' (with uncommitted changes)' : ''}` : ''}, on ${day}${otherSources ? ', and other cited sources' : ''}.`;
  return fr
    ? `${where} Chaque affirmation renvoie au fichier et aux lignes ; les déductions sont signalées. Lire le code ne prouve pas comment il se comporte en production.`
    : `${where} Every statement points to the file and lines; deductions are marked. Reading code does not prove how it behaves in production.`;
}

/**
 * A dated update adds only some of the note's sections: role sections become
 * free sections carrying the template's own headings, so the landmarks stay the
 * same without requiring every mandatory role again.
 */
async function asUpdateSections(config: OkbConfig, analysis: Record<string, unknown>, templateId: string, lang: string): Promise<Record<string, unknown>> {
  const template = await getTemplate(config, templateId);
  const emojis = (analysis.style as { emojis?: string } | undefined)?.emojis === 'landmarks';
  const sections = (analysis.sections as { role?: string; heading?: string }[]).map((s) => {
    const def = s.role ? template.sections.find((x) => x.role === s.role) : undefined;
    if (!s.role) return s;
    const { role: _role, ...rest } = s;
    return { ...rest, heading: def ? sectionHeading(def, lang, emojis) : s.role };
  });
  const { template: _t, ...rest } = analysis;
  return { ...rest, sections };
}

function existingKind(bundle: Bundle, path: BundlePath): string | null {
  const kind = (bundle.docs.get(path)?.data.x_okb as { repo?: { kind?: unknown } } | undefined)?.repo?.kind;
  return typeof kind === 'string' ? kind : null;
}

function defaultHeading(lang: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return lang.startsWith('fr') ? `Mise à jour du ${day}` : `Update of ${day}`;
}

/**
 * A note outside the repository's folder that no repository claims: it belongs
 * to the whole KB. In a repository KB every note is the repository's.
 */
function isShared(bundle: Bundle, path: BundlePath, id: string, place: RepoPlace): boolean {
  if (place === true || path.startsWith(`${repoFolder(id, place)}/`) || (!isBrainPlace(place) && path.startsWith(`${REPOS_FOLDER}/`))) return false;
  // In a brain, every repository lives under `…/Code/<repo>/`: a note there is a repository's.
  if (isBrainPlace(place) && /\/(Code)\//.test(path)) return false;
  const meta = (bundle.docs.get(path)?.data.x_okb as { repo?: { id?: unknown } } | undefined)?.repo;
  return !meta || meta.id === '*';
}

function createTarget(path: BundlePath, options: WriteOptions, kind: string, repo: RepoEntry, lang: string, repoMeta: Record<string, unknown>, place: RepoPlace): IngestTarget {
  const pack = kind !== 'ticket' && kind !== 'other' && kind !== 'questions' ? packNote(kind as NoteKind) : null;
  const title = options.title ?? (pack ? noteTitle(pack.kind, repo.name, lang) : null);
  if (!title) throw new OkbError('E_INVALID', 'this note needs --title', { key: 'repoTicketTitle' });
  // Created outside `repos/` (a business concept, a feature across repositories): a shared note.
  const shared = place !== true && (isBrainPlace(place) ? !path.startsWith(`${place.folder}/`) : !path.startsWith(`${REPOS_FOLDER}/`));
  return {
    mode: 'create', path, title,
    description: options.description ?? (pack ? noteDescription(pack.kind, repo.name, lang) : title),
    tags: shared ? [repo.id] : ['repo', repo.id, ...(kind === 'ticket' ? ['ticket'] : [])],
    ...(shared && options.quality === undefined ? {} : { xOkb: { ...(shared ? {} : { repo: repoMeta }), ...(options.quality !== undefined ? { review: reviewOf(options.quality) } : {}) } }),
  };
}

/** The quality reviewer's grade as the note keeps it: out of 20, by whom, when. */
export function reviewOf(score: number): { score: number; by: string; at: string } {
  return { score: Math.max(0, Math.min(20, Math.round(score))), by: 'okb-quality-reviewer', at: new Date().toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------- findings */

const evidence = z.object({ file: z.string().min(1), lines: z.string().optional(), quote: z.string().min(1) }).strict();
const findingsSchema = z.object({
  version: z.literal(1),
  repo: z.string(),
  area: z.string().min(1),
  read: z.array(z.object({ file: z.string().min(1), lines: z.union([z.literal('all'), z.array(z.string())]).default('all') }).strict()).default([]),
  facts: z.array(z.object({
    question: z.string().regex(/^q-[a-z0-9-]+$/).optional(),
    topic: z.string().max(80).optional(),
    text: z.string().min(3).max(1200),
    kind: z.enum(['reported', 'inferred']),
    evidence: z.array(evidence).min(1),
  }).strict()).default([]),
  unknowns: z.array(z.object({ question: z.string().regex(/^q-[a-z0-9-]+$/).optional(), text: z.string().min(3), looked: z.array(z.string()).default([]) }).strict()).default([]),
  terms: z.array(z.object({ term: z.string().min(2), meaning: z.string().min(3), evidence: z.array(evidence).min(1) }).strict()).default([]),
  incomplete: z.boolean().default(false),
}).strict();
export type Findings = z.infer<typeof findingsSchema>;

/**
 * Save what a reading agent found in one area, after checking every quote
 * against the files: a wrong quote fails here, not three steps later.
 */
export async function addFindings(ctx: RepoContext, raw: unknown): Promise<{ file: string; facts: number; unknowns: number; terms: number; questions: string[]; covered: number }> {
  const parsed = findingsSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid findings file', { detail: { issues: parsed.error.issues } });
  const f = parsed.data;
  if (f.repo !== ctx.repo.id) throw new OkbError('E_INVALID', `the findings are for repository "${f.repo}", not "${ctx.repo.id}"`);
  assertNoSecrets(f, 'findings');
  const cache = new Map<string, string>();
  const located = async (ev: z.infer<typeof evidence>) => {
    const { abs, rel } = resolveCited(ctx, ev.file);
    let text = cache.get(abs);
    if (text === undefined) {
      text = rel !== null && !/\.(vtt|srt|pdf|docx|html?)$/i.test(abs)
        ? (await readFile(abs, 'utf8').catch(() => { throw new OkbError('E_NOT_FOUND', `cited file not found: ${ev.file}`, { key: 'repoFileMissing', params: { file: ev.file } }); }))
        : (await extractSource(await acquire(abs, ctx.config), ctx.config)).blocks.map((b) => b.text).join('\n');
      cache.set(abs, text);
    }
    const loc = locateQuote(text, ev.quote, ev.lines);
    if (!loc) throw new OkbError('E_INVALID', `quote is not in ${ev.file}: "${ev.quote.slice(0, 80)}"`, { key: 'repoQuoteMissing', params: { file: ev.file, quote: ev.quote.slice(0, 80) } });
    return { ...ev, file: rel ?? abs, ...(rel !== null ? { lines: loc.start === loc.end ? `${loc.start}` : `${loc.start}-${loc.end}` } : {}) };
  };
  const facts = [];
  for (const fact of f.facts) facts.push({ ...fact, evidence: await Promise.all(fact.evidence.map(located)) });
  const terms = [];
  for (const term of f.terms) terms.push({ ...term, evidence: await Promise.all(term.evidence.map(located)) });
  const identity = await gitIdentity(ctx.repo.path);
  const progress = await loadProgress(ctx.paths);
  let covered = 0;
  for (const r of f.read) {
    const { rel } = resolveCited(ctx, r.file);
    if (rel === null) continue;
    if (!(await stat(resolve(ctx.repo.path, rel)).then((s) => s.isFile(), () => false))) continue;
    addCoverage(progress, rel, r.lines, identity.head, 'findings');
    covered++;
  }
  for (const fact of facts) for (const ev of fact.evidence) if (!isAbsolute(ev.file) && ev.lines) addCoverage(progress, ev.file, [ev.lines], identity.head, 'findings');
  const n = (await listJson(ctx.paths.findings)).length + 1;
  const name = `${String(n).padStart(3, '0')}-${f.area.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'area'}.json`;
  const file = resolve(ctx.paths.findings, name);
  await writeJsonAtomic(file, { ...f, facts, terms, commit: identity.head, savedAt: new Date().toISOString() });
  const questions = [...new Set(facts.map((x) => x.question).filter((q): q is string => Boolean(q && questionById(q))))];
  progress.findings.push({ id: name.replace(/\.json$/, ''), area: f.area, file, claims: facts.length, at: new Date().toISOString() });
  for (const u of f.unknowns) {
    if (!u.question || !questionById(u.question) || progress.questions[u.question]) continue;
    progress.questions[u.question] = { status: 'unknown', why: u.text, looked: u.looked, at: new Date().toISOString() };
  }
  await saveProgress(ctx.paths, progress);
  return { file, facts: facts.length, unknowns: f.unknowns.length, terms: terms.length, questions, covered };
}

function resolveCited(ctx: RepoContext, file: string): { abs: string; rel: string | null } {
  const abs = isAbsolute(file) ? resolve(file) : resolve(ctx.repo.path, file);
  if (isInside(abs, ctx.repo.path)) return { abs, rel: relative(ctx.repo.path, abs).split(sep).join('/') };
  if (isAbsolute(file) && (/\.(vtt|srt|md|markdown|txt|pdf|docx|html?)$/i.test(abs) || isInside(abs, ctx.paths.dir))) return { abs, rel: null };
  throw new OkbError('E_FORBIDDEN_PATH', `cited file is outside the repository: ${file}`);
}

/** All saved findings, for the writing phase. */
export async function loadFindings(ctx: RepoContext): Promise<(Findings & { commit?: string })[]> {
  const out = [];
  for (const name of await listJson(ctx.paths.findings)) {
    try { out.push(JSON.parse(await readFile(resolve(ctx.paths.findings, name), 'utf8'))); } catch { /* skip a broken file */ }
  }
  return out;
}

/* -------------------------------------------------------------- answers */

/**
 * An answer from a person (the user, a senior, a colleague) becomes a dated
 * source OKB can cite: "Réponse de Marie, 4 octobre". It is knowledge only once
 * a note integrates it through an approved proposal.
 */
export async function recordAnswer(ctx: RepoContext, input: { question?: string; text: string; by: string }): Promise<{ file: string; question: string | null }> {
  const text = input.text.trim();
  if (text.length < 2) throw new OkbError('E_INVALID', 'the answer is empty', { key: 'repoAnswerEmpty' });
  assertNoSecrets({ text }, 'answer');
  const q = input.question ? questionById(input.question) : undefined;
  if (input.question && !q) throw new OkbError('E_INVALID', `unknown question "${input.question}"`, { key: 'repoQuestionUnknown', params: { id: input.question }, hint: 'okb repo questions' });
  const lang = language(ctx.config);
  const day = new Date().toISOString().slice(0, 10);
  const progress = await loadProgress(ctx.paths);
  const n = progress.answers.length + 1;
  const file = resolve(ctx.paths.answers, `${day}-${String(n).padStart(3, '0')}-${q?.id ?? 'note'}.md`);
  const title = q ? (lang.startsWith('fr') ? q.text.fr : q.text.en) : (lang.startsWith('fr') ? 'Information donnée' : 'Information given');
  // No name unless one is given: « me » and anonymous actors stay unnamed.
  const given = input.by.trim();
  const by = given && !['me', 'anonymous', 'moi'].includes(given.toLowerCase()) ? given : '';
  // The title names the person and the day: it is what a footnote shows.
  await writeTextAtomic(file, [
    `# ${lang.startsWith('fr') ? (by ? `Réponse de ${by}` : 'Réponse') : (by ? `Answer from ${by}` : 'Answer')}, ${day} : ${title}`,
    '',
    `${ctx.repo.name} · ${q?.id ?? (lang.startsWith('fr') ? 'information libre' : 'free information')}`,
    '',
    text,
    '',
  ].join('\n'));
  progress.answers.push({ id: `a-${n}`, question: q?.id ?? null, file, by: by || 'me', at: new Date().toISOString() });
  if (q && progress.questions[q.id]?.status !== 'answered') {
    progress.questions[q.id] = { status: 'received', answerFile: file, at: new Date().toISOString() };
  }
  await saveProgress(ctx.paths, progress);
  return { file, question: q?.id ?? null };
}
