
import type { OkbConfig } from '../config/schema.js';
import { productVersion } from '../integrations/system.js';
import { writeJsonAtomic, writeTextAtomic } from '../util/fsx.js';
import { detectCi, detectCommands, detectDocs, detectPublished, detectStack, detectTests } from './detect.js';
import { changeStats, gitIdentity, type ChangeStats } from './git.js';
import { authorSummary, detectCentral, detectCodeowners, detectDescription, detectGlossary, detectHotspots, detectModules, detectRisks, roleOf } from './insight.js';
import { buildInventory, type Inventory, type InventoryFile } from './inventory.js';
import { detectConsumes, detectEntities, detectEnv, detectEnvironments, detectProvides } from './interfaces.js';
import { questionHints } from './questions.js';
import type { RepoEntry } from './registry.js';
import { ensureRepoState, repoPaths } from './state.js';
import type { Area, PlanItem, RepoMap } from './types.js';

/**
 * `okb repo scan`: the whole repository mapped in a few seconds, without AI and
 * without running anything. The map is the backbone of the onboarding: it says
 * what exists, where to read, and which questions the repository can answer.
 */
export async function scanRepository(repo: Pick<RepoEntry, 'id' | 'name' | 'path'>): Promise<RepoMap> {
  const [inv, identity, stats, version] = await Promise.all([
    buildInventory(repo.path),
    gitIdentity(repo.path),
    changeStats(repo.path),
    productVersion(),
  ]);
  const stack = detectStack(inv);
  const commands = detectCommands(inv);
  const docs = detectDocs(inv);
  const ci = detectCi(inv);
  const tests = detectTests(inv, stack);
  const provides = detectProvides(inv);
  const consumes = detectConsumes(inv);
  const env = detectEnv(inv);
  const environments = detectEnvironments(inv);
  const entities = detectEntities(inv);
  const modules = detectModules(inv, stats);
  const hotspots = detectHotspots(inv, stats);
  const central = detectCentral(inv);
  const glossary = detectGlossary(inv, entities, provides);
  const risks = detectRisks(inv, commands, tests.files, ci.length);
  const plan = buildPlan(inv, stats, hotspots, central);

  const languages = new Map<string, { files: number; lines: number }>();
  for (const f of inv.files) {
    if (!f.lang || f.tier === 'skip') continue;
    const l = languages.get(f.lang) ?? { files: 0, lines: 0 };
    l.files += 1;
    l.lines += f.lines ?? 0;
    languages.set(f.lang, l);
  }
  const skipped = new Map<string, string[]>();
  for (const f of inv.files.filter((x) => x.tier === 'skip')) skipped.set(f.why, [...(skipped.get(f.why) ?? []), f.path]);

  const partial: Omit<RepoMap, 'questions'> = {
    version: 1,
    scannedAt: new Date().toISOString(),
    okbVersion: version,
    repo: {
      id: repo.id, name: repo.name, root: repo.path, remote: identity.remote, branch: identity.branch, defaultBranch: identity.defaultBranch,
      head: identity.head, headDate: identity.headDate, firstCommitDate: identity.firstCommitDate, commits: identity.commits, dirty: identity.dirty,
      description: detectDescription(inv),
    },
    files: {
      total: inv.files.length,
      fromGit: inv.fromGit,
      truncated: inv.truncated,
      byTier: { read: count(inv, 'read'), skim: count(inv, 'skim'), index: count(inv, 'index'), skip: count(inv, 'skip') },
      languages: [...languages].map(([lang, v]) => ({ lang, ...v })).sort((a, b) => b.lines - a.lines).slice(0, 12),
      skipped: [...skipped].map(([reason, paths]) => ({ reason, count: paths.length, examples: paths.slice(0, 3) })).sort((a, b) => b.count - a.count),
    },
    stack,
    published: detectPublished(inv),
    modules,
    docs,
    commands,
    provides,
    consumes,
    env,
    environments,
    configFiles: inv.files.filter((f) => f.kind === 'config' && !/(^|\/)(\.env|default-env\.json|\.cdsrc-private\.json)$/.test(f.path)).map((f) => f.path).slice(0, 40),
    entities,
    ci,
    tests,
    ownership: { codeowners: detectCodeowners(inv), authors: authorSummary(stats, inv), commitsLastYear: stats?.commitsInWindow ?? null },
    hotspots,
    central,
    glossary,
    risks,
    plan,
  };
  return { ...partial, questions: questionHints(partial) };
}

function count(inv: Inventory, tier: InventoryFile['tier']): number {
  return inv.files.filter((f) => f.tier === tier).length;
}

const READ_FILES = 80;
const READ_LINES = 15_000;
const SKIM_FILES = 100;
const LONG = 1500;
const SECRET_BEARING = /(^|\/)(\.env|default-env\.json|\.cdsrc-private\.json|[\w-]*credentials?[\w-]*\.json|[\w-]*secrets?[\w-]*\.(json|ya?ml))$/i;
const ROLE_FILE = /(handler|controller|service|resolver|router|routes?|repository|processor|job|listener|consumer|producer|usecase|use-case|command|query)s?\.(m?[jt]sx?|java|kt|py|go|cs)$/i;

/**
 * Tiers in priority order, under a reading budget. The budget keeps the first
 * pass feasible; nothing is hidden: the counts of what is indexed or skipped,
 * and why, travel with the plan.
 */
function buildPlan(inv: Inventory, stats: ChangeStats | null, hotspots: readonly { path: string }[], central: readonly { path: string }[]): RepoMap['plan'] {
  const rank = (f: InventoryFile): number | null => {
    if (f.kind === 'readme') return f.path.includes('/') ? 1 : 0;
    if (f.kind === 'doc' && /contributing|codeowners|pull_request_template/i.test(f.path)) return 2;
    if (f.kind === 'adr') return 3;
    if (f.kind === 'manifest') return f.path.includes('/') ? 6 : 5;
    if (f.kind === 'ci') return 7;
    if (f.kind === 'api' || f.kind === 'schema') return 8;
    if (f.kind === 'entry') return 9;
    if (f.kind === 'config' && /\.env\.(example|sample|template)$|application\.ya?ml$|\.cdsrc\.json$/i.test(f.path)) return 10;
    if (f.kind === 'doc' && /\.(md|mdx|adoc|rst)$/i.test(f.path) && !/changelog|history/i.test(f.path)) return 4;
    return null;
  };
  for (const f of inv.files) {
    if (['vendored', 'generated', 'lockfile', 'binary'].includes(f.kind)) { f.tier = 'skip'; continue; }
    if (SECRET_BEARING.test(f.path)) { f.tier = 'skip'; f.why = 'may hold credentials: only variable names are used'; continue; }
    if (f.kind === 'doc' && /\.(pdf|docx)$/i.test(f.path)) { f.tier = 'index'; continue; }
    f.tier = 'index';
  }
  const read: PlanItem[] = [];
  let readLines = 0;
  let docs = 0;
  const overflow: InventoryFile[] = [];
  const candidates = inv.files.filter((f) => f.tier === 'index' && rank(f) !== null && f.lines !== null)
    .sort((a, b) => rank(a)! - rank(b)! || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  for (const f of candidates) {
    const lines = f.lines ?? 0;
    const isDoc = f.kind === 'doc';
    if (lines > LONG || read.length >= READ_FILES || readLines + lines > READ_LINES || (isDoc && docs >= 25)) { overflow.push(f); continue; }
    f.tier = 'read';
    if (isDoc) docs++;
    readLines += lines;
    read.push({ path: f.path, lines: f.lines, why: f.why });
  }
  const skim: PlanItem[] = [];
  let skimLines = 0;
  const take = (f: InventoryFile | undefined, why: string) => {
    if (!f || f.tier !== 'index' || skim.length >= SKIM_FILES || f.lines === null) return;
    f.tier = 'skim';
    f.why = why;
    skimLines += f.lines;
    skim.push({ path: f.path, lines: f.lines, why });
  };
  const byPath = new Map(inv.files.map((f) => [f.path, f]));
  for (const f of overflow) take(f, f.lines !== null && f.lines > LONG ? `${f.why} (long: read the parts that matter)` : `${f.why} (beyond the first reading budget)`);
  for (const c of central) take(byPath.get(c.path), 'imported by many files: changes here ripple');
  for (const h of hotspots) take(byPath.get(h.path), 'changed often in the last year');
  for (const f of inv.files) if (ROLE_FILE.test(f.path) && (f.kind === 'source' || f.kind === 'entry')) take(f, 'name says it holds behaviour (handler, service, controller…)');
  const testsByArea = new Map<string, number>();
  for (const f of inv.files) {
    if (f.kind !== 'test') continue;
    const n = testsByArea.get(f.area) ?? 0;
    if (n >= 2) continue;
    testsByArea.set(f.area, n + 1);
    take(f, 'a test shows how the code is meant to be used');
  }
  void stats;
  const documents = inv.files.filter((f) => f.kind === 'doc' && /\.(pdf|docx)$/i.test(f.path)).map((f) => ({ path: f.path, lines: null, why: 'document: read it with okb ingest' }));
  const areas = new Map<string, { read: PlanItem[]; skim: PlanItem[]; indexed: number; lines: number }>();
  for (const f of inv.files) {
    if (f.tier === 'skip') continue;
    const a = areas.get(f.area) ?? { read: [], skim: [], indexed: 0, lines: 0 };
    if (f.tier === 'read') a.read.push({ path: f.path, lines: f.lines, why: f.why });
    else if (f.tier === 'skim') a.skim.push({ path: f.path, lines: f.lines, why: f.why });
    else a.indexed += 1;
    a.lines += f.lines ?? 0;
    areas.set(f.area, a);
  }
  const areaList: Area[] = [...areas].map(([path, a]) => ({
    id: path === '.' ? 'root' : path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'area',
    path, role: path === '.' ? null : roleOf(path), read: a.read, skim: a.skim, indexed: a.indexed, lines: a.lines,
  })).sort((x, y) => (x.path === '.' ? -1 : y.path === '.' ? 1 : y.read.length + y.skim.length - (x.read.length + x.skim.length) || y.lines - x.lines));
  return {
    read, skim, indexed: inv.files.filter((f) => f.tier === 'index').length, readLines, skimLines, documents, areas: areaList,
    truncated: overflow.some((f) => f.tier === 'index'),
  };
}

/**
 * Git-derived facts as a small document OKB can cite ("who changed what in the
 * last year"): names only, never e-mail addresses, from the local history.
 */
export function renderGitFacts(map: RepoMap, language: string): string {
  const fr = language.toLowerCase().startsWith('fr');
  const head = map.repo.head ? map.repo.head.slice(0, 12) : (fr ? 'sans commit' : 'no commit');
  const day = map.scannedAt.slice(0, 10);
  const lines = [
    `# ${fr ? 'Faits Git' : 'Git facts'} — ${map.repo.name} (${head}, ${day})`,
    '',
    fr ? 'Généré par `okb repo scan` à partir de l’historique Git local. Noms seulement, jamais d’adresse e-mail.' : 'Generated by `okb repo scan` from the local Git history. Names only, never e-mail addresses.',
    '',
    `## ${fr ? 'Activité' : 'Activity'}`,
    '',
    `- ${fr ? 'Commits au total' : 'Total commits'} : ${map.repo.commits ?? '?'}`,
    `- ${fr ? 'Premier commit' : 'First commit'} : ${map.repo.firstCommitDate?.slice(0, 10) ?? '?'}`,
    `- ${fr ? 'Dernier commit' : 'Last commit'} : ${map.repo.headDate?.slice(0, 10) ?? '?'}`,
    `- ${fr ? 'Commits sur les 12 derniers mois (hors fusions)' : 'Commits over the last 12 months (no merges)'} : ${map.ownership.commitsLastYear ?? '?'}`,
    '',
  ];
  if (map.ownership.authors.length) {
    lines.push(`## ${fr ? 'Qui a modifié quoi sur 12 mois' : 'Who changed what over 12 months'}`, '');
    for (const a of map.ownership.authors) lines.push(`- ${a.name} : ${a.changes} ${fr ? 'modifications de fichiers, surtout dans' : 'file changes, mostly in'} ${a.areas.join(', ')}`);
    lines.push('');
  }
  if (map.hotspots.length) {
    lines.push(`## ${fr ? 'Fichiers les plus modifiés sur 12 mois' : 'Most changed files over 12 months'}`, '');
    for (const h of map.hotspots) lines.push(`- ${h.path} : ${h.changes} commits`);
    lines.push('');
  }
  const modules = map.modules.filter((m) => m.lastChange);
  if (modules.length) {
    lines.push(`## ${fr ? 'Dernière modification par dossier' : 'Last change per folder'}`, '');
    for (const m of modules) lines.push(`- ${m.path} : ${m.lastChange!.slice(0, 10)}${m.authors.length ? ` (${m.authors.join(', ')})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Scan, then keep the map and the Git facts in the repository's private state. */
export async function scanAndStore(config: OkbConfig, repo: RepoEntry): Promise<{ map: RepoMap; mapPath: string; factsPath: string }> {
  const map = await scanRepository(repo);
  const paths = repoPaths(config, repo.id);
  await ensureRepoState(paths);
  await writeJsonAtomic(paths.map, map);
  await writeTextAtomic(paths.facts, renderGitFacts(map, config.writing.language ?? config.profile.answer.language));
  return { map, mapPath: paths.map, factsPath: paths.facts };
}

export function areaForFile(map: RepoMap, file: string): string {
  const parts = file.split('/');
  const two = parts.slice(0, 2).join('/');
  if (map.plan.areas.some((a) => a.path === two)) return two;
  return parts.length === 1 ? '.' : parts[0]!;
}

