import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { complete, type AiRequest, type AiResult } from '../ai/provider.js';
import { recordAiUsage } from '../ai/usage.js';
import { repoPlace } from '../brain/products.js';
import type { OkbConfig } from '../config/schema.js';
import { passagesFor, type Passage } from '../find/answer.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { repoNotes } from '../repo/notes.js';
import { QUESTIONS } from '../repo/questions.js';
import { findRepo, type RepoEntry } from '../repo/registry.js';
import { loadMap, loadProgress, repoPaths } from '../repo/state.js';
import { findSecrets } from '../security/secrets.js';
import { statePaths } from '../state/paths.js';
import { dailyBudget, spentToday } from '../suggest/suggest.js';
import { estimateTokens } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';

/**
 * The knowledge exam of a repository (roadmap §5.1): « if Claude reads this KB,
 * does it find the right information? ». A fixed series of questions — the 25
 * onboarding questions, plus the team's own with their expected answer — is
 * answered by the model from the repository's notes only (never a 🔒 note, never
 * a passage holding a secret), then each answer is graded against a reference
 * the notes did not write: the expected answer, a person's recorded answer, or
 * the lines of code the scan points to. Without a reference a question is
 * not graded; with one, a question the notes cannot answer counts as wrong.
 * The cost is announced before anything is sent and counts in the daily budget.
 */
export type ExamRepo = { readonly id: string; readonly name: string; readonly folder?: string | null };
export type ExamGrade = 'right' | 'partial' | 'wrong' | 'ungraded';
export type Reference = 'expected' | 'person' | 'code' | 'none';
export type ExamQuestion = { readonly id: string; readonly text: string; readonly custom: boolean; readonly expected?: string; readonly reference: Reference; readonly found: number };
export type ExamPlan = { readonly repo: string; readonly questions: readonly ExamQuestion[]; readonly tokens: number; readonly budget: { readonly spent: number; readonly daily: number } };
export type ExamItem = {
  readonly id: string; readonly question: string; readonly custom: boolean;
  readonly answer: string; readonly found: number; readonly notes: readonly string[];
  readonly grade: ExamGrade;
  /** The grader's reason, or why it was not graded: not-found · not-in-notes · no-answer · no-reference · undecided. */
  readonly why: string;
  readonly reference: Reference;
};
export type ExamResult = {
  readonly repo: string; readonly name: string; readonly at: string;
  readonly score: number | null;
  readonly counts: Readonly<Record<ExamGrade, number>>;
  readonly items: readonly ExamItem[];
  readonly tokens: number; readonly provider: string;
};
export type ExamHistory = ExamResult & { readonly history: readonly { readonly at: string; readonly score: number | null }[] };
export type Ask = (req: AiRequest) => Promise<AiResult>;

type CustomQuestion = { readonly id: string; readonly text: string; readonly expected: string; readonly at: string };
type ExamFile = { version: 1; questions: CustomQuestion[]; results: ExamResult[] };

const KEEP = 10;
const NOT_IN_NOTES = 'NOT IN THE NOTES';
const EXCERPT_LINES = 16;

/* ----------------------------------------------------------------- pure */

/** Right answers count whole, partial ones half, over the graded questions; null when none could be graded. */
export function examScore(items: readonly Pick<ExamItem, 'grade'>[]): number | null {
  const graded = items.filter((i) => i.grade !== 'ungraded');
  if (!graded.length) return null;
  const points = graded.reduce((n, i) => n + (i.grade === 'right' ? 1 : i.grade === 'partial' ? 0.5 : 0), 0);
  return Math.round((100 * points) / graded.length);
}

/** The JSON object in a model's reply — fenced, or amid prose — or null, never a guess. */
export function jsonBlock(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter((c): c is string => Boolean(c && c.trim().startsWith('{')));
  for (const c of candidates) { try { return JSON.parse(c) as unknown; } catch { /* next */ } }
  return null;
}

/* --------------------------------------------------------------- storage */

const fileOf = (config: OkbConfig, repo: ExamRepo) => resolve(statePaths(config).root, 'exams', `${repo.id.replace(/[^\w.-]+/g, '-')}.json`);

async function load(config: OkbConfig, repo: ExamRepo): Promise<ExamFile> {
  return (await readJsonIfExists<ExamFile>(fileOf(config, repo))) ?? { version: 1, questions: [], results: [] };
}

/** A question of the team's own, with the answer it expects. */
export async function addExamQuestion(config: OkbConfig, repo: ExamRepo, text: string, expected: string): Promise<CustomQuestion> {
  const q = text.trim();
  const a = expected.trim();
  if (q.length < 5 || a.length < 1) throw new OkbError('E_INVALID', 'a question and its expected answer are needed', { key: 'examQuestionEmpty' });
  if (findSecrets(`${q}\n${a}`).length) throw new OkbError('E_INVALID', 'the question or its answer looks like it holds a secret', { key: 'examQuestionSecret' });
  const data = await load(config, repo);
  const made = { id: `x-${randomBytes(3).toString('hex')}`, text: q, expected: a, at: new Date().toISOString() };
  data.questions.push(made);
  await writeJsonAtomic(fileOf(config, repo), data);
  return made;
}

export async function removeExamQuestion(config: OkbConfig, repo: ExamRepo, id: string): Promise<void> {
  const data = await load(config, repo);
  if (!data.questions.some((q) => q.id === id)) throw new OkbError('E_NOT_FOUND', `no exam question ${id}`, { key: 'examQuestionUnknown', params: { id } });
  data.questions = data.questions.filter((q) => q.id !== id);
  await writeJsonAtomic(fileOf(config, repo), data);
}

/** The last result, with the scores before it (newest first); null before a first exam. */
export async function lastExam(config: OkbConfig, repo: ExamRepo): Promise<ExamHistory | null> {
  const { results } = await load(config, repo);
  return results[0] ? { ...results[0], history: results.map((r) => ({ at: r.at, score: r.score })) } : null;
}

export async function examQuestionsOf(config: OkbConfig, repo: ExamRepo): Promise<readonly CustomQuestion[]> {
  return (await load(config, repo)).questions;
}

/* ------------------------------------------------------------- preparing */

const langOf = (config: OkbConfig): 'fr' | 'en' => ((config.writing.language ?? config.profile.answer.language ?? 'en').startsWith('fr') ? 'fr' : 'en');

type Prepared = ExamQuestion & { readonly passages: readonly Passage[]; readonly referenceText: string };

/** The repository's own notes: its folder in a brain, or the notes that name it. */
function scopeOf(bundle: Bundle, repo: ExamRepo, entry: RepoEntry | null, place: Awaited<ReturnType<typeof repoPlace>> | null): Set<string> {
  const scope = new Set<string>();
  if (repo.folder) for (const e of bundle.entries) if (!e.reserved && e.path.startsWith(`${repo.folder}/`)) scope.add(e.path);
  if (entry) for (const n of repoNotes(bundle, entry.id, place ?? false)) scope.add(n.path);
  return scope;
}

/** Lines of code the scan points to for a question, never a line that looks like a secret. */
async function codeReference(entry: RepoEntry, hints: readonly { file: string; line: number }[]): Promise<string> {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const h of hints) {
    if (parts.length >= 3 || !h.file || seen.has(h.file)) continue;
    seen.add(h.file);
    const path = resolve(entry.path, h.file);
    const inside = relative(entry.path, path);
    if (inside.startsWith('..') || isAbsolute(inside)) continue;
    const text = await readFile(path, 'utf8').catch(() => null);
    if (!text || text.includes('\u0000')) continue;
    const lines = text.split('\n');
    const from = Math.max(1, h.line - 2);
    const excerpt = lines.slice(from - 1, from - 1 + EXCERPT_LINES).join('\n').trimEnd();
    if (!excerpt.trim() || findSecrets(excerpt).length) continue;
    parts.push(`--- ${h.file}:${from}\n${excerpt}`);
  }
  return parts.join('\n\n');
}

async function personReference(answers: readonly { question: string | null; file: string }[], id: string): Promise<string> {
  const texts: string[] = [];
  for (const a of answers.filter((x) => x.question === id)) {
    const raw = await readFile(a.file, 'utf8').catch(() => '');
    // The heading and the line naming the repository are the answer's frame, not its content.
    const body = raw.split('\n').slice(4).join('\n').trim();
    if (body && !findSecrets(body).length) texts.push(body);
  }
  return texts.join('\n\n');
}

async function prepare(config: OkbConfig, repo: ExamRepo, options: { env: NodeJS.ProcessEnv; only?: readonly string[]; bundle?: Bundle }): Promise<Prepared[]> {
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const entry = await findRepo(repo.id, options.env).then((r) => (r && r.kb === config.profile.id ? r : null), () => null);
  const place = entry ? await repoPlace(config, entry) : null;
  const scope = scopeOf(bundle, repo, entry, place);
  const lang = langOf(config);
  const map = entry ? await loadMap(repoPaths(config, entry.id)) : null;
  const progress = entry ? await loadProgress(repoPaths(config, entry.id)) : null;
  const custom = (await load(config, repo)).questions;
  const wanted = (id: string, isCustom: boolean) => !options.only?.length || options.only.includes(id) || (isCustom && options.only.includes('custom'));
  const out: Prepared[] = [];
  const ask = (text: string) => {
    if (!scope.size) return [];
    const { passages } = passagesFor(config, bundle, text, { notes: 4, perNote: 2, scope });
    return passages.filter((p) => !p.secret && !findSecrets(p.text).length);
  };
  for (const q of QUESTIONS) {
    if (!wanted(q.id, false)) continue;
    const text = q.text[lang];
    const passages = ask(text);
    const person = progress ? await personReference(progress.answers, q.id) : '';
    const hints = map?.questions.find((h) => h.id === q.id)?.hints ?? [];
    const code = !person && entry && hints.length ? await codeReference(entry, hints) : '';
    const reference: Reference = person ? 'person' : code ? 'code' : 'none';
    out.push({ id: q.id, text, custom: false, reference, found: passages.length, passages, referenceText: person || code });
  }
  for (const q of custom) {
    if (!wanted(q.id, true)) continue;
    const passages = ask(q.text);
    out.push({ id: q.id, text: q.text, custom: true, expected: q.expected, reference: 'expected', found: passages.length, passages, referenceText: q.expected });
  }
  return out;
}

/* --------------------------------------------------------------- prompts */

function answerRequest(lang: 'fr' | 'en', items: readonly Prepared[]): AiRequest {
  const system = [
    'You take an exam about one software repository. Under each question are numbered excerpts of the team’s notes about it.',
    `For each question, answer in ${lang === 'fr' ? 'French' : 'English'} in at most three plain sentences, using only that question’s excerpts — never your own knowledge.`,
    `If its excerpts do not answer the question, the answer is exactly: ${NOT_IN_NOTES}`,
    'Reply with JSON only: {"answers":[{"id":"<question id>","answer":"<answer>"}]}',
  ].join('\n');
  const prompt = items.map((q) => [`### ${q.id}`, `Question: ${q.text}`, ...q.passages.map((p) => `[${p.n}] ${p.title}: ${p.text}`)].join('\n')).join('\n\n');
  return { system, prompt, size: 'small', maxTokens: Math.min(8000, 220 + items.length * 180) };
}

function gradeRequest(lang: 'fr' | 'en', items: readonly { q: Prepared; answer: string }[]): AiRequest {
  const system = [
    'You grade answers to an exam about one software repository, each against its reference only.',
    'right: correct, and enough to act on. partial: correct but missing something important, or partly wrong. wrong: incorrect, or contradicts the reference. unknown: the reference does not let you decide.',
    'A reference is either the expected answer, a person’s answer, or lines of the repository’s code.',
    `For each, give the grade and a reason in ${lang === 'fr' ? 'French' : 'English'}, at most 15 words.`,
    'Reply with JSON only: {"grades":[{"id":"<question id>","grade":"right|partial|wrong|unknown","why":"<reason>"}]}',
  ].join('\n');
  const label = { expected: 'Expected answer', person: 'A person’s answer', code: 'Code', none: '' } as const;
  const prompt = items.map(({ q, answer }) => [`### ${q.id}`, `Question: ${q.text}`, `Answer: ${answer}`, `${label[q.reference]}:`, q.referenceText].join('\n')).join('\n\n');
  return { system, prompt, size: 'small', maxTokens: Math.min(6000, 200 + items.length * 90) };
}

/* ------------------------------------------------------------ the exam */

function estimate(lang: 'fr' | 'en', prepared: readonly Prepared[]): number {
  const answering = prepared.filter((q) => q.found > 0);
  if (!answering.length) return 0;
  const a = answerRequest(lang, answering);
  const graded = answering.filter((q) => q.reference !== 'none');
  const g = graded.length ? gradeRequest(lang, graded.map((q) => ({ q, answer: 'x'.repeat(240) }))) : null;
  return estimateTokens(a.system + a.prompt) + a.maxTokens + (g ? estimateTokens(g.system + g.prompt) + g.maxTokens : 0);
}

/** What the exam will ask, which questions the notes can answer and can be graded, and its cost — nothing sent. */
export async function planExam(config: OkbConfig, repo: ExamRepo, options: { env?: NodeJS.ProcessEnv; only?: readonly string[]; bundle?: Bundle; now?: Date } = {}): Promise<ExamPlan> {
  const env = options.env ?? process.env;
  const prepared = await prepare(config, repo, { env, ...(options.only ? { only: options.only } : {}), ...(options.bundle ? { bundle: options.bundle } : {}) });
  const [spent, daily] = await Promise.all([spentToday(config, options.now ?? new Date()), dailyBudget(env)]);
  return {
    repo: repo.id,
    questions: prepared.map(({ passages: _p, referenceText: _r, ...q }) => q),
    tokens: estimate(langOf(config), prepared),
    budget: { spent, daily },
  };
}

function strings(value: unknown, key: string, field: string): Map<string, Record<string, string>> {
  const list = (value as Record<string, unknown> | null)?.[key];
  const out = new Map<string, Record<string, string>>();
  if (!Array.isArray(list)) return out;
  for (const x of list as Record<string, unknown>[]) if (typeof x?.id === 'string' && typeof x[field] === 'string') out.set(x.id, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v)])));
  return out;
}

export async function runExam(config: OkbConfig, repo: ExamRepo, options: { env?: NodeJS.ProcessEnv; only?: readonly string[]; bundle?: Bundle; now?: Date; ask?: Ask } = {}): Promise<ExamResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const ask: Ask = options.ask ?? ((req) => complete(req, env));
  const lang = langOf(config);
  const prepared = await prepare(config, repo, { env, ...(options.only ? { only: options.only } : {}), ...(options.bundle ? { bundle: options.bundle } : {}) });
  const answering = prepared.filter((q) => q.found > 0);
  const cost = estimate(lang, prepared);
  if (cost) {
    const [spent, budget] = await Promise.all([spentToday(config, now), dailyBudget(env)]);
    if (spent + cost > budget) throw new OkbError('E_INVALID', `daily budget reached (${spent} + ${cost} > ${budget} tokens)`, { key: 'budgetExceeded', params: { spent, cost, budget } });
  }
  let tokens = 0;
  let provider = 'none';
  const call = async (req: AiRequest, key: string) => {
    const r = await ask(req);
    tokens += r.tokens.input + r.tokens.output;
    provider = r.provider;
    const parsed = strings(jsonBlock(r.text), key, key === 'answers' ? 'answer' : 'grade');
    if (!parsed.size) throw new OkbError('E_IO', `the AI gave no readable ${key}`, { key: 'aiFailed', params: { error: r.text.slice(0, 160) } });
    return parsed;
  };
  const answers = answering.length ? await call(answerRequest(lang, answering), 'answers') : new Map<string, Record<string, string>>();
  const toGrade = answering
    .map((q) => ({ q, answer: (answers.get(q.id)?.answer ?? '').trim() }))
    .filter(({ q, answer }) => q.reference !== 'none' && answer && !answer.includes(NOT_IN_NOTES));
  const grades = toGrade.length ? await call(gradeRequest(lang, toGrade), 'grades') : new Map<string, Record<string, string>>();
  if (tokens) await recordAiUsage(config, { tokens, purpose: 'exam', provider }, now);

  const items: ExamItem[] = prepared.map((q) => {
    const base = { id: q.id, question: q.text, custom: q.custom, found: q.found, notes: [...new Set(q.passages.map((p) => String(p.path)))], reference: q.reference };
    // Not in the notes: wrong when a reference says there is an answer to find; otherwise nothing to measure.
    if (!q.found) return { ...base, answer: '', grade: q.reference === 'none' ? 'ungraded' : 'wrong', why: 'not-found' };
    const answer = (answers.get(q.id)?.answer ?? '').trim();
    if (!answer) return { ...base, answer, grade: 'wrong', why: 'no-answer' };
    if (answer.includes(NOT_IN_NOTES)) return { ...base, answer: '', grade: 'wrong', why: 'not-in-notes' };
    if (q.reference === 'none') return { ...base, answer, grade: 'ungraded', why: 'no-reference' };
    const g = grades.get(q.id);
    const grade = g?.grade === 'right' || g?.grade === 'partial' || g?.grade === 'wrong' ? g.grade : 'ungraded';
    return { ...base, answer, grade, why: grade === 'ungraded' ? 'undecided' : (g?.why ?? '').slice(0, 200) };
  });
  const counts = { right: 0, partial: 0, wrong: 0, ungraded: 0 } as Record<ExamGrade, number>;
  for (const i of items) counts[i.grade]++;
  const result: ExamResult = { repo: repo.id, name: repo.name, at: now.toISOString(), score: examScore(items), counts, items, tokens, provider };
  const data = await load(config, repo);
  data.results = [result, ...data.results].slice(0, KEEP);
  await writeJsonAtomic(fileOf(config, repo), data);
  return result;
}
