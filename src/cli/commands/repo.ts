import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../../config/load.js';
import type { OkbConfig } from '../../config/schema.js';
import { lang as uiLang, t, tn } from '../../i18n/index.js';
import { kbNames, listKbs, readRootConfig, type KbSummary } from '../../kb/registry.js';
import { saveProposal } from '../../proposal/store.js';
import { cloudSyncedFolder, confidentialDefaultRoot, kbRemotes } from '../../repo/confidential.js';
import { freshness, repoStatus, type QuestionView, type RepoStatus } from '../../repo/status.js';
import { gitIdentity, gitRoot } from '../../repo/git.js';
import { proposeLandscape, proposeQuestionsNote, askWho, riskText } from '../../repo/generated.js';
import { addFindings, loadFindings, recordAnswer, repoContext, repoNotes, writeRepoNote, type RepoContext } from '../../repo/notes.js';
import { isBrainPlace, notePath, PACK, READING_ORDER } from '../../repo/pack.js';
import { repoPlace } from '../../brain/products.js';
import { KIND_ICON, kindOf } from '../../work/kinds.js';
import { QUESTIONS, THEMES, questionById, type NoteKind } from '../../repo/questions.js';
import { addRepo, findRepo, listRepos, removeRepo, repoForDir, type RepoEntry } from '../../repo/registry.js';
import { scanAndStore } from '../../repo/scan.js';
import { loadMap, loadProgress } from '../../repo/state.js';
import { ticketContext } from '../../repo/ticket.js';
import type { RepoMap } from '../../repo/types.js';
import { resolveStyle } from '../../style/resolve.js';
import { pick } from '../../templates/registry.js';
import { getTemplate } from '../../templates/registry.js';
import { OkbError } from '../../util/errors.js';
import { writeJsonAtomic } from '../../util/fsx.js';
import { asBundlePath } from '../../util/paths.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { flagBool, flagList, flagNumber, flagString, flagValues } from '../args.js';
import { choose, input, intro, outro, spin } from '../ui/prompt.js';
import { columns, paint, sym, tilde, truncate, width } from '../ui/term.js';
import { canAsk, effective, type Ctx } from './common.js';
import { layoutOf } from '../../brain/layout.js';
import { noteType } from '../../brain/types.js';

/**
 * `okb repo` — a code repository's own knowledge base, kept inside one of the
 * person's KBs (`repos/<id>/`): a deterministic map of the code, a reading plan,
 * the onboarding questions, notes written from cited code, and the follow-up
 * after each ticket. Claude does the reading and writing through /okb-dev:onboard
 * and /okb-dev:ticket; every note goes through a proposal the person approves.
 */
export async function cmdRepo(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0];
  switch (sub) {
    case undefined: return repoHome(ctx);
    case 'list': case 'ls': return repoList(ctx);
    case 'add': return repoAdd(ctx);
    case 'scan': return repoScan(ctx);
    case 'status': case 'st': return repoStatusCmd(ctx);
    case 'plan': return repoPlan(ctx);
    case 'findings': return repoFindings(ctx);
    case 'template': return repoTemplate(ctx);
    case 'write': return repoWrite(ctx);
    case 'questions': case 'q': return repoQuestions(ctx);
    case 'answer': return repoAnswer(ctx);
    case 'interview': return repoInterview(ctx);
    case 'update': case 'refresh': return repoUpdate(ctx);
    case 'ticket': return repoTicket(ctx);
    case 'landscape': case 'map': return repoLandscape(ctx);
    case 'context': return repoContextCmd(ctx);
    case 'remove': case 'forget': return repoRemove(ctx);
    case 'level': case 'niveau': return repoLevelCmd(ctx);
    default: {
      if (await findRepo(sub)) return repoStatusCmd({ ...ctx, args: { ...ctx.args, positionals: ['status', sub] } });
      throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb repo [add|scan|status|questions|answer|update|ticket|landscape|list]' } });
    }
  }
}

/* ---------------------------------------------------------------- helpers */

type Picked = { repo: RepoEntry; config: OkbConfig; ctx: RepoContext };

/** The repository a command is about: `--repo`, a positional id or path, or the current folder. */
async function pickRepo(ctx: Ctx, positional?: string): Promise<Picked> {
  const wanted = flagString(ctx.args, 'repo') ?? positional;
  let repo: RepoEntry | null = null;
  if (wanted) repo = await findRepo(wanted);
  else {
    const found = await repoForDir(process.cwd());
    if (found?.moved) repo = (await addRepo({ path: found.repo.path, kb: found.repo.kb, id: found.repo.id, name: found.repo.name })).repo;
    else repo = found?.repo ?? null;
  }
  if (!repo) {
    const root = wanted ? null : await gitRoot(process.cwd());
    throw new OkbError('E_NOT_FOUND', wanted ? `repository "${wanted}" is not registered` : 'this folder is not a repository OKB documents', {
      key: wanted ? 'repoUnknown' : 'repoNotHere', params: { id: wanted ?? '', path: tilde(root ?? process.cwd()) },
      hint: root ? 'okb repo add' : 'okb repo list',
    });
  }
  const kbFlag = flagString(ctx.args, 'kb') ?? flagString(ctx.args, 'profile');
  if (kbFlag && kbFlag !== repo.kb) throw new OkbError('E_CONFLICT', `repository "${repo.id}" lives in the KB "${repo.kb}"`, { key: 'repoOtherKb', params: { id: repo.id, kb: repo.kb } });
  const { config } = await loadConfig({ profileId: repo.kb });
  return { repo, config, ctx: await repoContext(config, repo) };
}

function lang(config: OkbConfig): string {
  return config.writing.language ?? config.profile.answer.language;
}

/** "Label   value", the value wrapped under itself. */
function kv(label: string, value: string, labelW = 13): string {
  const cols = columns();
  const room = Math.max(20, cols - labelW - 4);
  const words = value.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (width(`${line} ${w}`) <= room) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => `  ${i === 0 ? paint.dim(label) + ' '.repeat(Math.max(1, labelW - width(label))) : ' '.repeat(labelW)}${l}`).join('\n');
}

/** A paragraph wrapped to the terminal, indented by two spaces. */
function para(text: string): string {
  const room = Math.max(30, columns() - 4);
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (!line) line = w;
    else if (width(`${line} ${w}`) <= room) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.map((l) => `  ${l}`).join('\n');
}

function short(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—';
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
}

/* ------------------------------------------------------------------- home */

async function repoHome(ctx: Ctx): Promise<number> {
  const here = await repoForDir(process.cwd());
  if (here) return repoStatusCmd({ ...ctx, args: { ...ctx.args, positionals: ['status'] } });
  const code = await repoList(ctx);
  if (ctx.mode === 'text' && (await gitRoot(process.cwd()))) {
    ctx.out.line();
    ctx.out.tip(t('repo.home.here', { path: tilde((await gitRoot(process.cwd()))!) }));
    ctx.out.next(['okb repo add']);
  }
  return code;
}

async function repoList(ctx: Ctx): Promise<number> {
  const repos = await listRepos();
  const kbs = await listKbs();
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, repos }); return 0; }
  if (!repos.length) {
    ctx.out.info(t('repo.list.none'));
    ctx.out.next(['cd <repo> && okb repo add', '/okb-dev:onboard']);
    return 0;
  }
  ctx.out.line(paint.bold(t('repo.list.title', { n: repos.length })));
  ctx.out.line();
  for (const r of repos) {
    const kb = kbs.find((k) => k.id === r.kb);
    ctx.out.line(`  📦 ${paint.name(r.name)}  ${paint.dim(`${t('repo.list.inKb', { kb: kb?.name ?? r.kb })} · ${tilde(r.path)}`)}`);
  }
  ctx.out.next(['okb repo status <repo>', 'okb repo landscape']);
  return 0;
}

/* -------------------------------------------------------------------- add */

/** `okb repo add --all <folder>`: the folder becomes a workspace (`okb workspace add`). */
async function repoAddAll(ctx: Ctx, folder: string): Promise<number> {
  const { workspaceAdd } = await import('./work.js');
  return workspaceAdd(ctx, folder);
}

async function repoAdd(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  // `--all` is a switch: the folder is the argument (default: here).
  if (flagBool(args, 'all')) return repoAddAll(ctx, args.positionals[1] ?? process.cwd());
  const path = resolve(args.positionals[1] ?? process.cwd());
  const root = (await gitRoot(path)) ?? path;
  const existing = (await listRepos()).find((r) => resolve(r.path) === root);
  const asked = flagString(args, 'kb') ?? flagString(args, 'new-kb') ?? flagString(args, 'new-repo-kb');
  let kb: string;
  if (existing && !asked) kb = existing.kb;
  else {
    const choice = await chooseKb(ctx, root, 'repo');
    // Repositories beside it and the person chose a workspace: the whole folder is registered.
    if (choice === WORKSPACE_CHOICE) {
      const { workspaceAdd } = await import('./work.js');
      return workspaceAdd(ctx, dirname(root));
    }
    kb = choice;
  }
  const { repo, created } = await addRepo({ path: root, kb, ...(flagString(args, 'name') ? { name: flagString(args, 'name')! } : {}) });
  const { config } = await loadConfig({ profileId: repo.kb });
  const scan = flagBool(args, 'scan', true);
  const result = scan ? await withSpinner(ctx, t('repo.scan.running', { name: repo.name }), () => scanAndStore(config, repo)) : null;
  if (ctx.mode === 'json') {
    out.json({ ok: true, created, repo, kb: { id: config.profile.id, root: config.kb.root, confidential: config.kb.confidential, kind: await kindOf(config.profile.id, config) }, ...(result ? { mapPath: result.mapPath, factsPath: result.factsPath, summary: compact(result.map) } : {}) });
    return 0;
  }
  const place = await repoPlace(config, repo);
  const folder = place === true ? config.kb.root : `${config.kb.root}/${isBrainPlace(place) ? place.folder : `repos/${repo.id}`}`;
  out.ok(t(created ? 'repo.add.done' : 'repo.add.again', { name: paint.name(repo.name), kb: paint.name(config.profile.displayName || config.profile.id), folder: paint.path(folder) }));
  if (result) {
    out.line();
    renderScan(ctx, result.map, config);
  }
  return 0;
}

async function withSpinner<T>(ctx: Ctx, text: string, run: () => Promise<T>): Promise<T> {
  if (!canAsk(ctx)) return run();
  const s = spin(text);
  try { const r = await run(); s.done(); return r; } catch (e) { s.fail(); throw e; }
}

/** The answer « register the whole folder as a workspace » to `chooseKb`. */
export const WORKSPACE_CHOICE = '__workspace';

/**
 * Which KB holds a repository (`purpose: 'repo'`) or a workspace's
 * repositories (`'workspace'`), with the recommended choice explained:
 * - a repository inside a workspace goes to the workspace's KB;
 * - a repository with other repositories beside it: make that folder a workspace;
 * - a repository on its own: a KB for that repository alone;
 * - a workspace: a new work KB, or an existing one that holds repositories.
 * Company code stays in confidential KBs, on this machine.
 */
export async function chooseKb(ctx: Ctx, root: string, purpose: 'repo' | 'workspace'): Promise<string> {
  const { args, out } = ctx;
  const kbs = await listKbs();
  const asked = flagString(args, 'kb');
  if (asked) {
    if (!kbs.some((k) => k.id === asked)) throw new OkbError('E_NOT_FOUND', `KB "${asked}" is not installed`, { key: 'kbUnknown', params: { id: asked } });
    if (purpose === 'workspace' && (await kindOf(asked)) === 'repo') throw new OkbError('E_INVALID', `KB "${asked}" is a repository KB`, { key: 'kbIsRepoKb', params: { id: asked } });
    return asked;
  }
  const { reposIn, workspaceForDir } = await import('../../work/workspaces.js');
  const here = purpose === 'repo' ? await workspaceForDir(root) : null;
  const siblings = purpose === 'repo' && !here ? (await reposIn(dirname(root))).filter((r) => resolve(r) !== resolve(root)) : [];
  const newName = flagString(args, 'new-kb') ?? flagString(args, 'new-repo-kb');
  if (newName) {
    // `--new-repo-kb`: a KB for this repository alone; `--new-kb`: a work KB for several repositories.
    const kind = flagString(args, 'new-repo-kb') || flagString(args, 'kind') === 'repo' ? 'repo' : 'workspace';
    return createCodeKb(ctx, { name: newName, dir: flagString(args, 'dir') ?? null, kind, repoRoot: purpose === 'repo' ? root : null, inRepo: flagBool(args, 'in-repo') });
  }
  // Inside a workspace, its KB is the obvious one.
  if (here) {
    if (ctx.mode === 'text') out.info(t('repo.add.inWorkspace', { ws: paint.name(here.name) }));
    return here.kb;
  }
  const info = await Promise.all(kbs.map(async (k) => ({ k, kind: await kindOf(k.id), confidential: await isConfidential(k.id), remotes: k.exists ? await kbRemotes(k.root) : [], synced: cloudSyncedFolder(k.root) })));
  if (!canAsk(ctx)) {
    throw new OkbError('E_INVALID', 'choose the KB that will hold this repository: --kb <id> or --new-kb "<name>"', {
      key: purpose === 'repo' && siblings.length ? 'repoNeedsKbSiblings' : 'repoNeedsKb',
      params: { kbs: info.map(({ k, kind }) => `${k.id} (${t(`kb.kind.${kind}`)})`).join(', ') || '—', n: siblings.length, parent: tilde(dirname(root)) },
    });
  }
  const name = kbNames(root.split('/').pop() ?? 'repo').display;
  intro(paint.bold(purpose === 'repo' ? t('repo.add.title', { name }) : t('ws.add.title', { name })));
  const hint = ({ k, kind, confidential, remotes, synced }: (typeof info)[number]) => [
    `${KIND_ICON[kind]} ${t(`kb.kind.${kind}`)}`, confidential ? t('repo.add.hint.confidential') : '', remotes.length ? t('repo.add.hint.remote') : '', synced ? t('repo.add.hint.synced', { where: synced }) : '',
  ].filter(Boolean).join(' · ') || tilde(k.root);
  const codeKbs = info.filter((x) => x.kind === 'workspace');
  type Option = { value: string; label: string; hint?: string; recommended?: boolean };
  const options: Option[] = [];
  if (purpose === 'repo') {
    // Other repositories beside it: the folder is a team's, make it a workspace.
    if (siblings.length) options.push({ value: WORKSPACE_CHOICE, label: t('repo.add.makeWorkspace', { parent: tilde(dirname(root)), n: siblings.length + 1 }), hint: t('repo.add.makeWorkspaceHint'), recommended: true });
    options.push({ value: '__repo', label: t('repo.add.repoKb'), hint: t('repo.add.repoKbHint'), recommended: !siblings.length });
    for (const x of codeKbs) options.push({ value: x.k.id, label: t('repo.add.joinKb', { name: x.k.name }), hint: hint(x) });
    for (const x of info.filter((y) => y.kind === 'topic')) options.push({ value: x.k.id, label: x.k.name, hint: `${hint(x)} · ${t('repo.add.topicWarn')}` });
  } else {
    options.push({ value: '__newws', label: t('repo.add.newKb'), hint: t('repo.add.newKbHint'), recommended: !codeKbs.length });
    for (const x of codeKbs) options.push({ value: x.k.id, label: x.k.name, hint: hint(x), recommended: codeKbs[0] === x });
    for (const x of info.filter((y) => y.kind === 'topic')) options.push({ value: x.k.id, label: x.k.name, hint: `${hint(x)} · ${t('repo.add.topicWarn')}` });
  }
  const choice = await choose(purpose === 'repo' ? t('repo.add.kbQ') : t('ws.add.kbQ'), options);
  if (choice === WORKSPACE_CHOICE) return choice;
  if (choice !== '__repo' && choice !== '__newws') return choice;
  const kind = choice === '__repo' ? 'repo' : 'workspace';
  // The person names the KB; the repository's or the folder's name is only a hint.
  const kbName = await input(kind === 'repo' ? t('repo.add.repoKbName') : t('repo.add.newKbName'), {
    placeholder: kind === 'repo' ? name : t('repo.add.newKbDefault'),
    validate: (v) => (v.trim() ? undefined : t('wiz.required')),
  });
  let inRepo = false;
  if (kind === 'repo') {
    inRepo = await choose(t('repo.add.whereQ'), [
      { value: false, label: t('repo.add.whereOutside'), hint: t('repo.add.whereOutsideHint'), recommended: true },
      { value: true, label: t('repo.add.whereInside'), hint: t('repo.add.whereInsideHint') },
    ]);
  }
  return createCodeKb(ctx, { name: kbName, dir: null, kind, repoRoot: purpose === 'repo' ? root : null, inRepo });
}

async function isConfidential(id: string): Promise<boolean> {
  try { return (await loadConfig({ profileId: id })).config.kb.confidential; } catch { return false; }
}

/**
 * A KB for code: confidential, pedagogical writing, every note on a template,
 * a plain local folder (OKB never puts it under Git). A repository KB goes
 * outside the repository by default, or inside it (`inRepo`) in a folder Git
 * is told to ignore on this machine only (`.git/info/exclude`, never shared).
 */
export async function createCodeKb(ctx: Ctx, input: { name: string; dir: string | null; kind: 'repo' | 'workspace'; repoRoot: string | null; inRepo?: boolean }): Promise<string> {
  const { runWizard, wizardContext, defaultAnswers } = await import('../../setup/wizard.js');
  const { writeSetting } = await import('../../settings/settings.js');
  const kbs = await listKbs();
  const wctx = await wizardContext(process.env);
  const uiLang = (await readRootConfig()).ui?.language ?? 'auto';
  const writing = kbs[0]?.writingLanguage ?? (t('ui.yes') === 'Oui' ? 'fr' : 'en');
  const base = defaultAnswers(wctx, input.name, writing === 'fr' ? 'fr' : 'en');
  const { folder } = kbNames(input.name);
  const parent = kbs.find((k) => k.root)?.root;
  let root = input.dir ? resolve(input.dir) : confidentialDefaultRoot(folder, parent ? dirname(parent) : null);
  if (!input.dir && input.inRepo && input.repoRoot) {
    root = resolve(input.repoRoot, IN_REPO_FOLDER);
    await excludeLocally(input.repoRoot, IN_REPO_FOLDER);
  }
  const { id } = await runWizard({
    ...base, uiLanguage: uiLang as never, root, writingLanguage: writing, preset: 'pedagogique', conceptAssist: 'pedagogical', requireTemplate: true,
    kind: input.kind, plugin: false, launcher: null, activate: false, adopt: false,
  }, () => {});
  await writeSetting(id, 'kb.confidential', true);
  // OKB 1.0: a KB for code is a work brain — products, their repositories, their tickets.
  // A KB kept inside its repository stays the repository's own (flat) KB.
  if (!input.inRepo) {
    const { setBrainConfig } = await import('../../brain/config.js');
    await setBrainConfig(id, { preset: 'work', names: writing === 'fr' ? 'fr' : 'en' });
  }
  if (ctx.mode === 'text') ctx.out.ok(t(input.kind === 'repo' ? 'repo.add.repoKbCreated' : 'repo.add.kbCreated', { name: paint.name(input.name), root: paint.path(root) }));
  return id;
}

/** The folder of a repository KB kept inside its repository. */
export const IN_REPO_FOLDER = '.okb-kb';

/** Tell Git, on this machine only, to ignore a folder of the repository (`.git/info/exclude` is never committed). */
async function excludeLocally(repoRoot: string, folder: string): Promise<void> {
  const { git } = await import('../../repo/git.js');
  const { appendFile, mkdir } = await import('node:fs/promises');
  const rel = (await git(repoRoot, ['rev-parse', '--git-path', 'info/exclude'])).trim();
  const file = resolve(repoRoot, rel);
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current.split('\n').some((l) => l.trim() === `/${folder}/`)) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# OKB: this repository's knowledge base, kept on this machine\n/${folder}/\n`);
}

/* ------------------------------------------------------------------- scan */

async function repoScan(ctx: Ctx): Promise<number> {
  const target = ctx.args.positionals[1];
  let picked: Picked;
  try {
    picked = await pickRepo(ctx, target);
  } catch (e) {
    // Scanning a folder that is not registered yet: register it first (asks for the KB).
    if (e instanceof OkbError && (e.key === 'repoNotHere' || (e.key === 'repoUnknown' && target && (await gitRoot(resolve(target)))))) {
      return repoAdd({ ...ctx, args: { ...ctx.args, positionals: ['add', ...(target ? [target] : [])] } });
    }
    throw e;
  }
  const { repo, config } = picked;
  const result = await withSpinner(ctx, t('repo.scan.running', { name: repo.name }), () => scanAndStore(config, repo));
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, repo, mapPath: result.mapPath, factsPath: result.factsPath, summary: compact(result.map, flagBool(ctx.args, 'full')) });
    return 0;
  }
  renderScan(ctx, result.map, config);
  return 0;
}

/** What Claude needs to plan the reading without loading the whole map. */
export function compact(map: RepoMap, full = false) {
  const cap = <T>(list: readonly T[], n: number) => (full ? list : list.slice(0, n));
  const ev = (e: { file: string; line: number }) => `${e.file}:${e.line}`;
  return {
    repo: map.repo,
    files: { total: map.files.total, byTier: map.files.byTier, languages: map.files.languages.slice(0, 6), skipped: map.files.skipped },
    stack: map.stack.map((s) => ({ id: s.id, label: s.label, version: s.version, at: ev(s.evidence[0]!) })),
    published: map.published.map((p) => ({ kind: p.kind, name: p.name, at: ev(p.evidence) })),
    modules: map.modules.map((m) => ({ path: m.path, role: m.role, files: m.files, lines: m.lines, languages: m.languages, readme: m.readme, authors: m.authors })),
    docs: cap(map.docs, 40).map((d) => ({ path: d.path, kind: d.kind, title: d.title, lines: d.lines })),
    commands: cap(map.commands, 40).map((c) => ({ kind: c.kind, run: c.run, from: c.from, at: ev(c.evidence) })),
    provides: cap(map.provides, 60).map((p) => ({ kind: p.kind, name: p.name, detail: p.detail, at: ev(p.evidence), count: p.count })),
    consumes: cap(map.consumes, 60).map((p) => ({ kind: p.kind, name: p.name, detail: p.detail, at: ev(p.evidence), count: p.count })),
    env: map.env.map((e) => ({ name: e.name, sensitive: e.sensitive, defaulted: e.defaulted, at: ev(e.evidence[0]!) })),
    environments: map.environments.map((e) => ({ name: e.name, at: ev(e.evidence[0]!) })),
    entities: cap(map.entities, 60).map((e) => ({ name: e.name, kind: e.kind, at: ev(e.evidence), relations: e.relations })),
    ci: map.ci,
    tests: map.tests,
    ownership: { codeowners: map.ownership.codeowners.map((o) => ({ pattern: o.pattern, owners: o.owners, at: ev(o.evidence) })), authors: map.ownership.authors.slice(0, 6) },
    central: map.central,
    hotspots: map.hotspots,
    glossary: cap(map.glossary, 25),
    risks: map.risks.map((r) => ({ kind: r.kind, detail: r.detail, ...(r.evidence ? { at: ev(r.evidence) } : {}) })),
    plan: {
      read: map.plan.read.length, readLines: map.plan.readLines, skim: map.plan.skim.length, skimLines: map.plan.skimLines, indexed: map.plan.indexed, truncated: map.plan.truncated,
      documents: map.plan.documents,
      areas: map.plan.areas.map((a) => ({ id: a.id, path: a.path, role: a.role, read: a.read.length, skim: a.skim.length, indexed: a.indexed, lines: a.lines })),
    },
    questions: map.questions.map((q) => ({ id: q.id, theme: q.theme, status: q.status, hints: q.hints.map(ev), ...(q.note ? { note: q.note } : {}) })),
  };
}

function renderScan(ctx: Ctx, map: RepoMap, config: OkbConfig): void {
  const { out } = ctx;
  const l = lang(config);
  out.line(`📦 ${paint.name(map.repo.name)}  ${paint.dim(t('repo.scan.subtitle', { commit: short(map.repo.head), date: day(map.repo.headDate), branch: map.repo.branch ?? '—' }))}`);
  if (map.repo.description) { out.line(); out.line(`  ${paint.dim('“')}${truncate(map.repo.description, columns() - 6)}${paint.dim('”')}`); }
  out.line();
  const totalLines = map.files.languages.reduce((n, x) => n + x.lines, 0);
  const langs = map.files.languages.slice(0, 4).map((x) => `${x.lang} ${Math.round((x.lines / Math.max(1, totalLines)) * 100)} %`).join(', ');
  const tooling = new Set(['jest', 'mocha', 'vitest', 'junit', 'pytest', 'playwright', 'cypress', 'wdio', 'sap-cap-dk', 'ui5-tooling', 'logging', 'axios', 'auth-lib', 'typescript', 'otel', 'sap-audit', 'sap-logging']);
  const main = map.stack.filter((s) => !tooling.has(s.id));
  out.line(kv(t('repo.scan.stack'), main.slice(0, 9).map((s, i) => s.label + (i < 3 && s.version && /^[\d^~>=<.x ]+$/.test(s.version) ? paint.dim(` ${s.version}`) : '')).join(' · ') + (main.length > 9 ? paint.dim(` +${main.length - 9}`) : '') || '—'));
  out.line(kv(t('repo.scan.files'), t('repo.scan.filesValue', { files: map.files.total, lines: totalLines.toLocaleString(l), langs })));
  if (map.ownership.authors.length) out.line(kv(t('repo.scan.people'), map.ownership.authors.slice(0, 4).map((a) => a.name).join(', ') + paint.dim(` (${t('repo.scan.peopleWhy')})`)));
  const modules = map.modules.filter((m) => m.path !== '.' && !['tests', 'docs'].includes(m.role ?? '')).slice(0, 7);
  if (modules.length) {
    out.line();
    out.line(paint.bold(t('repo.scan.modules')));
    const w = Math.min(28, Math.max(...modules.map((m) => width(m.path))) + 1);
    for (const m of modules) {
      out.line(`  ${paint.code(`${m.path}/`)}${' '.repeat(Math.max(1, w - width(m.path)))}${paint.dim(truncate(`${m.role ? t(`repo.role.${m.role}`) : '·'} · ${tn('repo.scan.nFiles', m.files)} · ${m.lines.toLocaleString(l)} l.${m.languages.length ? ` · ${m.languages.join(', ')}` : ''}`, columns() - w - 4))}`);
    }
  }
  out.line();
  const provided = groupIfaces(map.provides.filter((p) => p.kind !== 'url'));
  out.line(kv(t('repo.scan.provides'), provided || paint.dim(t('repo.scan.nothingFound'))));
  const consumed = consumedSummary(map);
  out.line(kv(t('repo.scan.consumes'), consumed.length ? consumed.join(paint.dim(' · ')) : paint.dim(t('repo.scan.nothingFound'))));
  const sensitive = map.env.filter((e) => e.sensitive).length;
  out.line(kv(t('repo.scan.config'), [tn('repo.scan.nVars', map.env.length, { sensitive }), map.environments.length ? t('repo.scan.envs', { list: map.environments.map((e) => e.name).join(', ') }) : ''].filter(Boolean).join(' · ')));
  const rank = (c: RepoMap['commands'][number]) => (c.cwd === '.' ? 0 : 1) + (c.from === 'package.json' || c.from === 'makefile' ? 0 : 2);
  const runs = ['install', 'start', 'dev', 'test', 'build', 'deploy'].flatMap((k) => map.commands.filter((c) => c.kind === k && c.from !== 'docs').sort((a, b) => rank(a) - rank(b)).slice(0, 1)).map((c) => c.run);
  if (runs.length) out.line(kv(t('repo.scan.commands'), runs.map((r) => paint.code(r)).join(paint.dim(' · '))));
  if (map.ci.length) out.line(kv('CI', map.ci.map((c) => `${c.system}${c.stages.length ? paint.dim(` : ${c.stages.slice(0, 5).join(', ')}`) : ''}`).join(' · ')));
  out.line(kv(t('repo.scan.tests'), map.tests.files ? tn('repo.scan.nTests', map.tests.files, { fw: map.tests.frameworks.join(', ') || '?' }) : paint.warn(t('repo.scan.noTests'))));
  const risks = map.risks.filter((r) => ['doc-drift', 'secret-like', 'tracked-env', 'no-readme', 'thin-readme'].includes(r.kind));
  if (risks.length) {
    out.line();
    out.line(paint.bold(t('repo.scan.watch')));
    for (const r of risks.slice(0, 6)) out.line(`  ${sym.warn()} ${riskText(r, l).replace(/`([^`]+)`/g, (_m, x: string) => paint.code(x))}`);
    if (risks.length > 6) out.line(paint.dim(`    +${risks.length - 6}`));
  }
  out.line();
  out.line(paint.bold(t('repo.scan.plan')));
  out.line(para(t('repo.scan.planLine', { read: map.plan.read.length, readLines: map.plan.readLines.toLocaleString(l), skim: map.plan.skim.length, indexed: map.plan.indexed, skipped: map.files.byTier.skip })));
  const hinted = map.questions.filter((q) => q.status === 'hinted').length;
  const reading = map.questions.filter((q) => q.status === 'needs-reading').length;
  const unknown = map.questions.filter((q) => q.status === 'unknown').length;
  out.line(para(t('repo.scan.questionsLine', { total: map.questions.length, hinted: paint.ok(String(hinted)), reading: paint.info(String(reading)), unknown: paint.warn(String(unknown)) })));
  out.next([t('repo.next.onboard'), `okb repo status ${map.repo.id}`]);
}

/** Who the repository calls, people-first: named services, destinations, platform services, hosts. */
function consumedSummary(map: RepoMap): string[] {
  const out: string[] = [];
  const shown = new Set<string>();
  for (const c of map.consumes.filter((x) => x.kind === 'external-service')) {
    const dest = /destination ([\w.-]+)/.exec(c.detail ?? '')?.[1];
    out.push(dest ? `${c.name}${paint.dim(` (destination ${dest})`)}` : c.name);
    shown.add(c.name);
    if (dest) shown.add(dest);
  }
  for (const c of map.consumes.filter((x) => x.kind === 'destination' && !shown.has(x.name))) { out.push(`${c.name}${paint.dim(' (destination)')}`); shown.add(c.name); }
  const platform = [...new Set(map.consumes.filter((x) => x.kind === 'service-binding').map((x) => /service ([\w.-]+)/.exec(x.detail ?? '')?.[1]).filter((x): x is string => Boolean(x)))];
  if (platform.length) out.push(`${paint.dim('services ')}${platform.join(', ')}`);
  for (const kind of ['database', 'messaging'] as const) {
    for (const c of map.consumes.filter((x) => x.kind === kind)) if (!platform.some((p) => (c.detail ?? '').includes(p))) out.push(`${c.name}${c.detail ? paint.dim(` (${c.detail})`) : ''}`);
  }
  const hosts = map.consumes.filter((x) => x.kind === 'url' && x.detail !== 'local').map((x) => x.name);
  if (hosts.length) out.push(...hosts.slice(0, 4));
  const containers = map.consumes.filter((x) => x.kind === 'container').map((x) => x.name);
  if (containers.length) out.push(`${paint.dim('containers ')}${containers.slice(0, 5).join(', ')}`);
  return out.slice(0, 12);
}

function groupIfaces(list: readonly { kind: string; name: string }[]): string {
  const counts = new Map<string, number>();
  for (const i of list) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => tn(`repo.iface.${kind}`, n)).join(' · ');
}

/* ----------------------------------------------------------------- status */

/** A text bar: ██████░░░░ */
export function levelBar(percent: number, size = 20): string {
  const full = Math.round((Math.max(0, Math.min(100, percent)) / 100) * size);
  return '█'.repeat(full) + '░'.repeat(size - full);
}

/** A gap of the knowledge level, in the person's words (`knowledge.gap.*`). */
export function gapText(g: { key: string; points: number; params: Readonly<Record<string, string | number>> }, l: string): string {
  const params: Record<string, string | number> = { ...g.params, points: g.points };
  if (typeof g.params.kind === 'string') params.page = pick(noteType(g.params.kind)?.label ?? { fr: g.params.kind, en: g.params.kind }, l);
  return t(g.key, params);
}

/** `okb repo level [<repo>]` — how well OKB knows each repository, and what to do to know it better. */
async function repoLevelCmd(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const { brainRepos } = await import('../../knowledge/brain-repos.js');
  const { repoLevel } = await import('../../knowledge/level.js');
  const { listRepos } = await import('../../repo/registry.js');
  const wanted = ctx.args.positionals[1];
  const repos = layoutOf(config)
    ? await brainRepos(config)
    : (await listRepos()).filter((r) => r.kb === config.profile.id).map((r) => ({ id: r.id, name: r.name, product: r.product ?? '', folder: null, linked: true, path: r.path }));
  const chosen = wanted ? repos.filter((r) => r.id === wanted || r.name === wanted) : repos;
  if (wanted && !chosen.length) throw new OkbError('E_NOT_FOUND', `no repository ${wanted} in this KB`, { key: 'repoUnknown', params: { id: wanted } });
  const bundle = await loadBundleFor(config);
  const { scoreBundle } = await import('../../scores/scores.js');
  const scores = new Map((await scoreBundle(config, bundle)).map((x) => [x.path as string, x]));
  const levels = [];
  for (const r of chosen) levels.push({ repo: r, level: await repoLevel(config, r, { bundle, scores }) });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, repos: levels.map(({ repo, level }) => ({ id: repo.id, name: repo.name, product: repo.product, linked: repo.linked, ...level })) }); return 0; }
  if (!levels.length) { ctx.out.line(t('knowledge.none')); return 0; }
  // Page names in the language of OKB's messages, like the rest of the line.
  const l = uiLang();
  for (const { repo, level } of levels) {
    ctx.out.line(`📦 ${paint.name(repo.name)}  ${paint.info(levelBar(level.percent))} ${paint.bold(`${level.percent} %`)} · ${t(`knowledge.tier.${level.tier}`)}${level.partial ? paint.dim(`  ${t('knowledge.partial')}`) : ''}`);
    for (const g of level.next) ctx.out.line(paint.dim(`   ${t('knowledge.points', { n: Math.max(1, Math.round(g.points)) })} · ${gapText(g, l)}`));
  }
  return 0;
}

async function repoStatusCmd(ctx: Ctx): Promise<number> {
  const { repo, config, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[1]);
  const status = await repoStatus(rctx);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...status }); return 0; }
  renderStatus(ctx, status, config, repo);
  return 0;
}

const NOTE_STATE: Record<RepoStatus['notes'][number]['state'], () => string> = {
  written: () => sym.ok(),
  pending: () => paint.info('◐'),
  missing: () => paint.dim('○'),
};

function renderStatus(ctx: Ctx, s: RepoStatus, config: OkbConfig, repo: RepoEntry): void {
  const { out } = ctx;
  const l = lang(config);
  out.line(`📦 ${paint.name(repo.name)}  ${paint.dim(t('repo.status.subtitle', { kb: config.profile.displayName || config.profile.id, commit: short(s.head) }))}`);
  out.line();
  out.line(kv(t('repo.status.scan'), s.scan.at ? `${day(s.scan.at)} · ${short(s.scan.commit)}${s.scan.behind ? `  ${paint.warn(t('repo.status.behind'))}` : ''}` : paint.warn(t('repo.status.noScan'))));
  const c = s.coverage;
  if (c.readTotal) out.line(kv(t('repo.status.read'), `${bar(c.readFiles, c.readTotal)} ${t('repo.status.readValue', { read: c.readFiles, total: c.readTotal, skim: c.skimFiles, skimTotal: c.skimTotal })}`));
  out.line();
  out.line(paint.bold(t('repo.status.notes')));
  for (const kind of READING_ORDER) {
    const n = s.notes.find((x) => x.kind === kind)!;
    const pack = PACK.find((p) => p.kind === kind)!;
    out.line(`  ${NOTE_STATE[n.state]()} ${pack.emoji} ${n.state === 'missing' ? paint.dim(t(`repo.note.${kind}`)) : t(`repo.note.${kind}`)}  ${paint.dim(n.state === 'written' ? n.path : t(`repo.noteState.${n.state}`))}`);
  }
  if (s.tickets || s.otherNotes) out.line(`  ${paint.dim(t('repo.status.more', { tickets: s.tickets, other: s.otherNotes }))}`);
  out.line();
  const counts = countQuestions(s.questions);
  out.line(paint.bold(t('repo.status.questions')));
  out.line(para(`${bar(counts.answered, QUESTIONS.length)} ${t('repo.status.questionsValue', { answered: counts.answered, total: QUESTIONS.length, pending: counts.pending, received: counts.received, unknown: counts.unknown, open: counts.open })}`));
  if (s.stale) out.line(`  ${sym.warn()} ${paint.warn(tn('repo.status.stale', s.stale))}`);
  if (s.pending.length) out.line(`  ${paint.info('◐')} ${tn('repo.status.pending', s.pending.length)}`);
  void l;
  out.next(s.next.map((n) => (n === '/okb-dev:onboard' ? t('repo.next.onboard') : n)));
}

function bar(done: number, total: number, w = 12): string {
  const filled = total ? Math.round((done / total) * w) : 0;
  return paint.ok('█'.repeat(filled)) + paint.dim('░'.repeat(w - filled));
}

function countQuestions(views: readonly QuestionView[]): { answered: number; pending: number; received: number; unknown: number; open: number } {
  return {
    answered: views.filter((v) => v.state === 'answered').length,
    pending: views.filter((v) => v.state === 'pending').length,
    received: views.filter((v) => v.state === 'received').length,
    unknown: views.filter((v) => v.state === 'unknown').length,
    open: views.filter((v) => v.state === 'open' || v.state === 'found').length,
  };
}

/* ------------------------------------------------------------------- plan */

async function repoPlan(ctx: Ctx): Promise<number> {
  const { repo, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[1]);
  const map = await loadMap(rctx.paths);
  if (!map) throw new OkbError('E_NOT_FOUND', 'scan the repository first', { key: 'repoNoScan', params: { id: repo.id }, hint: `okb repo scan ${repo.id}` });
  const progress = await loadProgress(rctx.paths);
  const areaId = flagString(ctx.args, 'area');
  const areas = map.plan.areas.filter((a) => !areaId || a.id === areaId || a.path === areaId);
  if (areaId && !areas.length) throw new OkbError('E_NOT_FOUND', `no area "${areaId}"`, { key: 'repoNoArea', params: { area: areaId, areas: map.plan.areas.map((a) => a.id).join(', ') } });
  const withDone = (items: readonly { path: string; lines: number | null; why: string }[]) => items.map((i) => ({ ...i, done: Boolean(progress.coverage[i.path]) }));
  const plan = areas.map((a) => ({ ...a, read: withDone(a.read), skim: withDone(a.skim) }));
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, repo: repo.id, root: repo.path, head: map.repo.head, documents: map.plan.documents, areas: plan, findingsDir: rctx.paths.findings, draftsDir: rctx.paths.drafts });
    return 0;
  }
  ctx.out.line(paint.bold(t('repo.plan.title', { name: repo.name })));
  for (const a of plan) {
    ctx.out.line();
    ctx.out.line(`${paint.code(`${a.path === '.' ? t('repo.plan.root') : `${a.path}/`}`)} ${paint.dim(`${a.role ? t(`repo.role.${a.role}`) : ''} · ${t('repo.plan.areaLine', { read: a.read.length, skim: a.skim.length, indexed: a.indexed })}`)}`);
    for (const i of [...a.read, ...a.skim].slice(0, flagBool(ctx.args, 'all') ? 999 : 8)) {
      ctx.out.line(`  ${i.done ? sym.ok() : a.read.includes(i) ? paint.dim('□') : paint.dim('·')} ${i.path}${i.lines ? paint.dim(` (${i.lines} l.)`) : ''}`);
    }
    if (a.read.length + a.skim.length > 8 && !flagBool(ctx.args, 'all')) ctx.out.line(paint.dim(`  … ${a.read.length + a.skim.length - 8} (--all)`));
  }
  return 0;
}

/* --------------------------------------------------------------- findings */

async function repoFindings(ctx: Ctx): Promise<number> {
  const action = ctx.args.positionals[1] ?? 'list';
  if (action === 'add') {
    const file = ctx.args.positionals[2];
    if (!file) throw new OkbError('E_INVALID', 'usage: okb repo findings add <findings.json>', { key: 'usage', params: { usage: 'okb repo findings add <findings.json>' } });
    const raw = JSON.parse(await readFile(resolve(file), 'utf8')) as { repo?: string };
    const { ctx: rctx } = await pickRepo(ctx, typeof raw.repo === 'string' ? raw.repo : undefined);
    const result = await addFindings(rctx, raw);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, ...result });
    else ctx.out.ok(t('repo.findings.saved', { facts: result.facts, unknowns: result.unknowns, terms: result.terms, files: result.covered }));
    return 0;
  }
  const { ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[2]);
  const findings = await loadFindings(rctx);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, findings }); return 0; }
  if (!findings.length) { ctx.out.info(t('repo.findings.none')); return 0; }
  for (const f of findings) ctx.out.line(`  ${sym.bullet()} ${paint.code(f.area)}  ${paint.dim(t('repo.findings.line', { facts: f.facts.length, unknowns: f.unknowns.length, terms: f.terms.length }))}`);
  return 0;
}

/* --------------------------------------------------------------- template */

async function repoTemplate(ctx: Ctx): Promise<number> {
  const kind = (ctx.args.positionals[1] ?? '') as NoteKind | 'ticket';
  const known = [...PACK.filter((p) => p.template).map((p) => p.kind), 'ticket'];
  if (!known.includes(kind)) throw new OkbError('E_INVALID', `usage: okb repo template <${known.join('|')}>`, { key: 'usage', params: { usage: `okb repo template <${known.join('|')}>` } });
  const { repo, config, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[2]);
  const templateId = kind === 'ticket' ? 'repo-ticket' : PACK.find((p) => p.kind === kind)!.template!;
  const template = await getTemplate(config, templateId);
  const style = resolveStyle(config, {}).style;
  const skeleton = {
    version: 3, repo: repo.id, note: kind, template: templateId, style,
    read: [], summary: '',
    sections: template.sections.map((s) => ({ role: s.role, claims: [], aids: [] })),
    concepts: [], corrections: [], openQuestions: [], unknowns: [], answers: QUESTIONS.filter((q) => q.note === kind).map((q) => q.id), related: [],
  };
  const path = resolve(rctx.paths.drafts, `${kind}.template.json`);
  await writeJsonAtomic(path, skeleton);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, path, template: templateId, questions: QUESTIONS.filter((q) => q.note === kind).map((q) => ({ id: q.id, text: pick(q.text, lang(config)) })), skeleton });
  else ctx.out.line(path);
  return 0;
}

/* ------------------------------------------------------------------ write */

async function repoWrite(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const file = flagString(args, 'analysis-file') ?? flagString(args, 'dossier');
  if (!file) throw new OkbError('E_INVALID', 'usage: okb repo write --analysis-file <dossier.json>', { key: 'usage', params: { usage: 'okb repo write --analysis-file <dossier.json> [--note <kind>]' } });
  const raw = JSON.parse(await readFile(resolve(file), 'utf8')) as { repo?: string };
  const picked = await pickRepo(ctx, ctx.args.positionals[1] ?? (typeof raw.repo === 'string' ? raw.repo : undefined));
  let { config, ctx: rctx } = picked;
  // A repository with its own KB writes the shared part into its workspace's KB (`--to-kb`).
  const toKb = flagString(args, 'to-kb');
  const sourceDirs: string[] = [];
  if (toKb && toKb !== config.profile.id) {
    const { workspaceOfRepo } = await import('../../work/scope.js');
    const ws = await workspaceOfRepo(picked.repo);
    const target = flagString(args, 'append') ?? flagString(args, 'create');
    if (!ws || ws.kb !== toKb || !target || target.startsWith('repos/')) {
      throw new OkbError('E_INVALID', `--to-kb ${toKb}: only a shared note of the repository's workspace KB`, { key: 'repoToKb', params: { kb: toKb } });
    }
    sourceDirs.push(rctx.paths.dir);
    config = (await loadConfig({ profileId: toKb })).config;
    rctx = await repoContext(config, picked.repo);
  }
  const after = flagList(args, 'after');
  let pending;
  if (after.length) {
    const { pendingCreationsFor } = await import('./legacy.js');
    pending = (await pendingCreationsFor(config, after)) ?? undefined;
  }
  const result = await writeRepoNote(rctx, raw, {
    ...(sourceDirs.length ? { sourceDirs } : {}),
    ...(flagString(args, 'note') ? { kind: flagString(args, 'note') as NoteKind } : {}),
    ...(flagString(args, 'create') ? { create: flagString(args, 'create')! } : {}),
    ...(flagString(args, 'append') ? { append: flagString(args, 'append')! } : {}),
    ...(flagString(args, 'heading') ? { heading: flagString(args, 'heading')! } : {}),
    ...(flagString(args, 'title') ? { title: flagString(args, 'title')! } : {}),
    ...(flagString(args, 'description') ? { description: flagString(args, 'description')! } : {}),
    ...(pending ? { pending } : {}),
    ...(flagString(args, 'concept-assist') ? { conceptAssistLevel: flagString(args, 'concept-assist') as never } : {}),
    ...(flagList(args, 'link-into').length ? { linkInto: flagList(args, 'link-into').map(asBundlePath) } : {}),
    ...(flagBool(args, 'reprocess') ? { reprocess: true } : {}),
    ...(flagString(args, 'suggestion') ? { suggestion: flagString(args, 'suggestion')! } : {}),
    ...(flagNumber(args, 'quality') !== undefined ? { quality: flagNumber(args, 'quality')! } : {}),
  });
  const p = result.report.proposal;
  if (ctx.mode === 'json') {
    out.json({
      ok: true, proposalId: p.id, target: result.target, changes: p.changes.map((c) => ({ id: c.id, kind: c.kind, path: c.path, category: c.category, label: c.label, dependsOn: c.dependsOn })),
      notes: p.notes, candidates: result.report.candidates, skipped: result.report.skipped, answers: result.dossier.answers, unknowns: result.dossier.unknowns.length,
    });
    return 0;
  }
  if (!p.changes.length) { out.info(t('repo.write.noop')); return 0; }
  out.ok(t('repo.write.done', { path: paint.code(result.target.path), n: p.changes.length }));
  for (const n of p.notes.slice(0, 6)) out.line(`  ${paint.dim(`· ${n}`)}`);
  out.next([`okb review ${p.id} --diff`]);
  return 0;
}

/* -------------------------------------------------------------- questions */

async function repoQuestions(ctx: Ctx): Promise<number> {
  const { repo, config, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[1]);
  const map = await loadMap(rctx.paths);
  if (!map) throw new OkbError('E_NOT_FOUND', 'scan the repository first', { key: 'repoNoScan', params: { id: repo.id }, hint: `okb repo scan ${repo.id}` });
  const place = await repoPlace(config, repo);
  if (flagBool(ctx.args, 'propose')) {
    const proposal = await proposeQuestionsNote(rctx);
    if (proposal.changes.length) await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.id, changes: proposal.changes.length, path: notePath(repo.id, 'questions', lang(config), place) });
    else if (!proposal.changes.length) ctx.out.info(t('repo.questions.upToDate'));
    else { ctx.out.ok(t('repo.questions.proposed', { path: paint.code(notePath(repo.id, 'questions', lang(config), place)) })); ctx.out.next([`okb review ${proposal.id} --diff`]); }
    return 0;
  }
  const status = await repoStatus(rctx);
  const l = lang(config);
  const onlyOpen = flagBool(ctx.args, 'open');
  const views = status.questions.filter((v) => !onlyOpen || ['unknown', 'open', 'found', 'received'].includes(v.state));
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, repo: repo.id, questions: views.map((v) => {
      const hint = map.questions.find((h) => h.id === v.id);
      const files = v.looked?.length ? v.looked : hint?.hints.map((h) => h.file) ?? [];
      return { ...v, text: pick(questionById(v.id)!.text, l), why: v.why ?? pick(questionById(v.id)!.why, l), note: v.note ?? notePath(repo.id, questionById(v.id)!.note, l, place), hints: hint?.hints ?? [], askWho: v.askWho ?? askWho(map, files, l) };
    }) });
    return 0;
  }
  const icon: Record<QuestionView['state'], string> = { answered: sym.ok(), pending: paint.info('◐'), received: '📨', found: paint.info('🔎'), unknown: paint.warn('?'), open: paint.dim('○') };
  ctx.out.line(paint.bold(t('repo.questions.title', { name: repo.name })));
  for (const theme of THEMES) {
    const items = views.filter((v) => v.theme === theme.id);
    if (!items.length) continue;
    ctx.out.line();
    ctx.out.line(`${theme.emoji} ${paint.bold(pick(theme.label, l))}`);
    for (const v of items) {
      const q = questionById(v.id)!;
      ctx.out.line(`  ${icon[v.state]} ${v.state === 'answered' ? paint.dim(pick(q.text, l)) : pick(q.text, l)}  ${paint.dim(v.id)}`);
      if (v.state === 'unknown' || v.state === 'open') {
        const hint = map.questions.find((h) => h.id === v.id);
        const who = v.askWho ?? askWho(map, v.looked?.length ? v.looked : hint?.hints.map((h) => h.file) ?? [], l);
        if (who) ctx.out.line(`      ${paint.dim(`${t('repo.questions.ask')} ${who}`)}`);
      }
    }
  }
  const counts = countQuestions(status.questions);
  ctx.out.line();
  ctx.out.line(paint.dim(t('repo.questions.legend')));
  ctx.out.next([...(counts.unknown + counts.open ? [`okb repo answer <q-…> "…"`, `okb repo interview`] : []), `okb repo questions --propose`]);
  return 0;
}

async function repoAnswer(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const question = args.positionals[1] && /^q-/.test(args.positionals[1]) ? args.positionals[1] : undefined;
  const textParts = args.positionals.slice(question ? 2 : 1);
  const fromFile = flagString(args, 'file');
  const text = fromFile ? await readFile(resolve(fromFile), 'utf8') : textParts.join(' ');
  if (!text.trim()) throw new OkbError('E_INVALID', 'usage: okb repo answer <q-id> "<answer>" [--by "<who>"]', { key: 'usage', params: { usage: 'okb repo answer <q-id> "<answer>" [--by "<who>"]' } });
  const { ctx: rctx } = await pickRepo(ctx);
  const by = flagString(args, 'by') ?? rctx.config.profile.humanActor.replace(/^human:/, '');
  const result = await recordAnswer(rctx, { ...(question ? { question } : {}), text, by });
  if (ctx.mode === 'json') out.json({ ok: true, ...result });
  else { out.ok(t('repo.answer.saved', { by })); out.line(paint.dim(`  ${tilde(result.file)}`)); out.next([t('repo.next.integrate')]); }
  return 0;
}

/** For someone who knows the repository: go through the open questions and answer what you can. */
async function repoInterview(ctx: Ctx): Promise<number> {
  if (!canAsk(ctx)) throw new OkbError('E_INVALID', 'okb repo interview asks questions in a terminal', { key: 'needsTerminal', params: { command: 'okb repo interview' } });
  const { repo, config, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[1]);
  const status = await repoStatus(rctx);
  const l = lang(config);
  const open = status.questions.filter((v) => ['unknown', 'open', 'found'].includes(v.state));
  intro(paint.bold(t('repo.interview.title', { name: repo.name })));
  const by = await input(t('repo.interview.who'), { initial: config.profile.humanActor.replace(/^human:/, '') });
  let saved = 0;
  for (const v of open) {
    const q = questionById(v.id)!;
    const answer = await input(`${pick(q.text, l)}\n${paint.dim(pick(q.why, l))}`, { placeholder: t('repo.interview.skip') });
    if (!answer.trim()) continue;
    await recordAnswer(rctx, { question: v.id, text: answer, by });
    saved++;
  }
  outro(saved ? tn('repo.interview.done', saved) : t('repo.interview.none'));
  if (saved) ctx.out.next([t('repo.next.integrate')]);
  return 0;
}

/* ----------------------------------------------------------------- update */

async function repoUpdate(ctx: Ctx): Promise<number> {
  const { repo, config, ctx: rctx } = await pickRepo(ctx, ctx.args.positionals[1]);
  const before = await loadMap(rctx.paths);
  const identity = await gitIdentity(repo.path);
  const rescan = !before || before.repo.head !== identity.head || flagBool(ctx.args, 'scan');
  if (rescan) await withSpinner(ctx, t('repo.scan.running', { name: repo.name }), () => scanAndStore(config, repo));
  const fresh = await freshness(rctx);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, rescanned: rescan, ...fresh }); return 0; }
  ctx.out.line(paint.bold(t('repo.update.title', { name: repo.name, commit: short(fresh.head) })));
  if (rescan) ctx.out.line(paint.dim(`  ${t('repo.update.rescanned')}`));
  ctx.out.line();
  if (!fresh.notes.length) { ctx.out.info(t('repo.update.noNotes')); ctx.out.next([t('repo.next.onboard')]); return 0; }
  const verdictIcon = { fresh: sym.ok(), changed: paint.info('◐'), stale: sym.warn(), unknown: paint.dim('○') } as const;
  for (const n of fresh.notes) {
    ctx.out.line(`  ${verdictIcon[n.verdict]} ${n.path}  ${paint.dim(t(`repo.verdict.${n.verdict}`))}`);
    for (const f of n.files.slice(0, 5)) ctx.out.line(`      ${paint.dim(t(`repo.fileState.${f.state}`, { file: f.file, to: f.to ?? '', missing: f.missingQuotes }))}`);
  }
  if (fresh.news.length) {
    ctx.out.line();
    ctx.out.line(paint.bold(t('repo.update.news')));
    for (const n of fresh.news.slice(0, 8)) ctx.out.line(`  + ${paint.code(n.file)} ${paint.dim(n.why)}`);
  }
  const todo = fresh.notes.filter((n) => n.verdict === 'stale' || n.verdict === 'changed').length;
  ctx.out.next(todo || fresh.news.length ? [t('repo.next.refresh')] : []);
  return 0;
}

/* ----------------------------------------------------------------- ticket */

async function repoTicket(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { repo, ctx: rctx } = await pickRepo(ctx, args.positionals[1]);
  const ticketFile = flagString(args, 'ticket-file');
  const ticket = ticketFile ? await readFile(resolve(ticketFile), 'utf8') : flagValues(args, 'ticket').join('\n');
  const result = await ticketContext(rctx, {
    ...(flagString(args, 'base') ? { base: flagString(args, 'base')! } : {}),
    ...(flagString(args, 'title') ? { title: flagString(args, 'title')! } : {}),
    ...(ticket ? { ticket } : {}),
    ...(flagString(args, 'by') ? { by: flagString(args, 'by')! } : {}),
  });
  if (ctx.mode === 'json') { out.json({ ok: true, repo: repo.id, ...result }); return 0; }
  out.ok(t('repo.ticket.context', { title: paint.bold(result.title), commits: result.commits.length, files: result.changes.length, base: result.base.ref }));
  out.line(paint.dim(`  ${tilde(result.file)}`));
  if (result.affectedNotes.length) {
    out.line();
    out.line(paint.bold(t('repo.ticket.affected')));
    for (const n of result.affectedNotes) out.line(`  ${sym.bullet()} ${n.path} ${paint.dim(`(${n.files.slice(0, 3).join(', ')})`)}`);
  }
  out.next([t('repo.next.ticket')]);
  return 0;
}

/* -------------------------------------------------------------- landscape */

async function repoLandscape(ctx: Ctx): Promise<number> {
  const here = await repoForDir(process.cwd());
  const kbId = flagString(ctx.args, 'kb') ?? here?.repo.kb ?? (await listRepos())[0]?.kb;
  if (!kbId) { ctx.out.info(t('repo.list.none')); return 0; }
  const { config } = await loadConfig({ profileId: kbId });
  const { landscapeNote } = await import('../../repo/generated.js');
  if (flagBool(ctx.args, 'propose')) {
    const proposal = await proposeLandscape(config);
    if (!proposal) {
      if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: null, changes: 0 });
      else ctx.out.info(t('repo.landscape.none'));
      return 0;
    }
    if (proposal.changes.length) await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.id, changes: proposal.changes.length });
    else if (!proposal.changes.length) ctx.out.info(t('repo.questions.upToDate'));
    else { ctx.out.ok(t('repo.landscape.proposed')); ctx.out.next([`okb review ${proposal.id} --diff`]); }
    return 0;
  }
  const note = await landscapeNote(config);
  if (!note) { ctx.out.info(t('repo.landscape.none')); return 0; }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, repos: note.repos.map((r) => r.id), edges: note.edges }); return 0; }
  ctx.out.line(paint.bold(t('repo.landscape.title', { n: note.repos.length, kb: config.profile.displayName || config.profile.id })));
  ctx.out.line();
  if (!note.edges.length) ctx.out.line(paint.dim(`  ${t('repo.landscape.noEdges')}`));
  for (const e of note.edges) ctx.out.line(`  ${paint.name(e.from)} ${paint.dim('→')} ${paint.name(e.to)}  ${paint.dim(e.label)}`);
  ctx.out.next(['okb repo landscape --propose']);
  return 0;
}

/* ---------------------------------------------------------------- context */

/**
 * For the plugin's session hook: what Claude should know when a session opens
 * inside a repository — its notes in the KB, open questions, outdated notes —
 * or, in an undocumented Git repository, that onboarding can be offered.
 */
async function repoContextCmd(ctx: Ctx): Promise<number> {
  const text = await repoContextText(resolve(flagString(ctx.args, 'cwd') ?? process.cwd()));
  if (ctx.mode === 'json') ctx.out.json({ ok: true, context: text });
  else if (text) ctx.out.line(text);
  return 0;
}

export async function repoContextText(cwd: string): Promise<string> {
  const found = await repoForDir(cwd);
  let text = '';
  if (found) {
    const { config } = await loadConfig({ profileId: found.repo.kb });
    const rctx = await repoContext(config, found.repo);
    const bundle = await loadBundleFor(config);
    const place = await repoPlace(config, found.repo);
    const notes = repoNotes(bundle, found.repo.id, place);
    const status = await repoStatus(rctx, { bundle });
    const counts = countQuestions(status.questions);
    const lines = [
      `OKB knows this repository: "${found.repo.name}" (KB "${config.profile.displayName || config.profile.id}", folder ${config.kb.root}/${isBrainPlace(place) ? place.folder : place ? '' : `repos/${found.repo.id}`}).`,
      notes.length
        ? `Its notes, written from the code and approved by the user — read the relevant one before exploring the code, and cite it when you use it:\n${notes.slice(0, 12).map((n) => `- ${config.kb.root}/${n.path} — ${n.title}`).join('\n')}`
        : 'No note has been written yet: /okb-dev:onboard reads the repository and writes its onboarding notes (offer it if the user is discovering the code).',
      `Onboarding questions: ${counts.answered}/${QUESTIONS.length} covered, ${counts.unknown + counts.open} open (okb repo questions).${status.stale ? ` ${status.stale} note(s) may be outdated since the code changed (okb repo update).` : ''}`,
      'When the user finishes a ticket or a piece of work in this repository, offer /okb-dev:ticket (ask first) so its KB keeps up with the code. Never write in the KB directly.',
    ];
    text = lines.join('\n');
  } else {
    const root = await gitRoot(cwd);
    const kbs = await listKbs();
    const { isInside, readOwner } = await import('../../kb/registry.js');
    const kb = kbs.find((k) => isInside(cwd, k.root));
    if (kb) {
      // The folder of an OKB KB: its notes, not code to onboard.
      return `OKB: this folder is the OKB KB "${kb.name}" (id ${kb.id}): notes, not a code repository — never offer /okb-dev:onboard here. If its notes were written before OKB (no front matter), offer /okb:convert to convert them through a proposal (ask first).`;
    }
    let suggest = kbs.length > 0;
    if (suggest) try { suggest = (await loadConfig({})).config.routing.suggest; } catch { /* no active KB */ }
    if (root && (await readOwner(root).catch(() => null))) return '';
    const { looksLikeNotes } = await import('../../work/workspaces.js');
    if (root && (await looksLikeNotes(root))) {
      text = `OKB: this folder looks like a knowledge base written before OKB ("${root.split('/').pop()}": Markdown notes, not code). Never offer /okb-dev:onboard for it (that is for code repositories). If the user wants it in OKB, offer /okb:convert: it connects the folder as a KB (asking its name) and converts its notes through a proposal they review.`;
    } else if (root && suggest) {
      text = `OKB: this folder is a Git repository OKB does not document yet ("${root.split('/').pop()}"). If the user says they are discovering or starting on it, offer /okb-dev:onboard to build its knowledge base (ask first; never run it unasked).`;
    }
  }
  return text;
}

/* ----------------------------------------------------------------- remove */

async function repoRemove(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[1];
  if (!id) throw new OkbError('E_INVALID', 'usage: okb repo remove <repo>', { key: 'usage', params: { usage: 'okb repo remove <repo>' } });
  const repo = await removeRepo(id);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, removed: repo });
  else ctx.out.ok(t('repo.removed', { name: repo.name }));
  return 0;
}

