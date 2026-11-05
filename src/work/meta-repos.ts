import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';

/**
 * Meta-repositories (chantier 3): a team keeps, in one Git repository with
 * almost no code, the table of contents of the repositories it ships together.
 * Each of its repositories is a submodule pinned to a version; the repositories
 * of other teams it builds on sit under `dependencies/`; next to them, the
 * documentation that spans them (`docs/`, hand-over notes in `KT/`, a
 * glossary), the delivery and compliance setup (`compliance/`: owners,
 * pipelines, scans) and the team's AI skills (`.github/skills/`). A workspace
 * holds several of them, and often a shared `knowledge/` folder.
 *
 * OKB reads that map instead of rebuilding it, and never writes there: no Git
 * command runs, nothing is copied, the skills are cited where they are. The
 * reader is tolerant: whatever the files hold, it keeps what it recognises and
 * says nothing about the rest. Names of teams, servers or products belong to
 * the person's own folders, never to OKB.
 */
export type SubRepo = {
  readonly name: string;
  /** Path relative to the meta-repository. */
  readonly path: string;
  readonly url: string | null;
  readonly branch: string | null;
  /** The submodule's folder is checked out (holds files). */
  readonly present: boolean;
};
export type Owner = { readonly who: string; readonly scope: string; readonly source: string };
export type Pipeline = { readonly name: string; readonly kind: 'github-actions' | 'jenkins' | 'other'; readonly source: string; readonly url: string | null };
export type Doc = { readonly path: string; readonly title: string };
export type Term = { readonly term: string; readonly definition: string; readonly source: string };
export type Skill = { readonly name: string; readonly description: string; readonly path: string };
export type MetaRepo = {
  readonly name: string;
  readonly path: string;
  readonly repos: readonly SubRepo[];
  /** Other teams' repositories this one builds on: read, never shipped or changed. */
  readonly dependencies: readonly SubRepo[];
  readonly owners: readonly Owner[];
  readonly pipelines: readonly Pipeline[];
  readonly docs: readonly Doc[];
  readonly kt: readonly Doc[];
  readonly glossary: readonly Term[];
  readonly skills: readonly Skill[];
  readonly compliance: readonly string[];
};
export type MetaWorkspace = { readonly root: string; readonly knowledge: readonly Doc[]; readonly metaRepos: readonly MetaRepo[] };

const MAX_FILE = 256 * 1024;
const MAX_DOCS = 400;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.venv']);

const exists = (p: string) => stat(p).then(() => true, () => false);

/** A repository with submodules is a meta-repository when it also holds the team's map: dependencies, compliance, hand-over notes or skills. */
export async function looksMeta(dir: string): Promise<boolean> {
  if (!(await exists(resolve(dir, '.gitmodules')))) return false;
  for (const part of ['dependencies', 'compliance', 'KT', '.github/skills']) if (await exists(resolve(dir, part))) return true;
  return false;
}
const text = (p: string) => stat(p).then((s) => (s.isFile() && s.size <= MAX_FILE ? readFile(p, 'utf8') : null), () => null);
const posix = (p: string) => p.split(sep).join('/');

/** `.gitmodules`, an INI file: one `[submodule "name"]` section per repository. */
export function parseGitmodules(raw: string): { name: string; path: string; url: string | null; branch: string | null }[] {
  const out: { name: string; path: string; url: string | null; branch: string | null }[] = [];
  let cur: { name: string; path?: string; url?: string; branch?: string } | null = null;
  const push = () => { if (cur?.path) out.push({ name: cur.name, path: cur.path, url: cur.url ?? null, branch: cur.branch ?? null }); };
  for (const line of raw.split(/\r?\n/)) {
    const head = /^\s*\[submodule\s+"([^"]+)"\]\s*$/.exec(line);
    if (head) { push(); cur = { name: head[1]! }; continue; }
    const kv = /^\s*(path|url|branch)\s*=\s*(.+?)\s*$/.exec(line);
    if (kv && cur) cur[kv[1] as 'path' | 'url' | 'branch'] = kv[2]!;
  }
  push();
  return out;
}

/** A workspace of meta-repositories: the folder itself, or the folders right under it, that hold a `.gitmodules`. */
export async function readMetaWorkspace(root: string): Promise<MetaWorkspace> {
  const at = resolve(root);
  const candidates = (await looksMeta(at)) ? [at] : (await readdir(at, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
    .map((d) => resolve(at, d.name));
  const metaRepos: MetaRepo[] = [];
  for (const dir of candidates.sort()) if (await looksMeta(dir)) metaRepos.push(await readMetaRepo(dir));
  return { root: at, knowledge: await docsIn(at, 'knowledge'), metaRepos };
}

/** The meta-repository and the workspace a folder belongs to, walking up from it. */
export async function metaForDir(dir: string): Promise<{ workspace: string; meta: string; repo: string | null } | null> {
  const start = resolve(dir);
  let cur = start;
  for (let i = 0; i < 12; i++) {
    if (await looksMeta(cur)) {
      const parent = dirname(cur);
      const rel = posix(relative(cur, start));
      const subs = parseGitmodules((await text(resolve(cur, '.gitmodules'))) ?? '');
      const repo = rel ? subs.find((x) => rel === x.path || rel.startsWith(`${x.path}/`))?.path ?? null : null;
      return { meta: cur, workspace: (await exists(resolve(parent, 'knowledge'))) || (await siblingsAreMeta(parent, cur)) ? parent : cur, repo };
    }
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return null;
}

async function siblingsAreMeta(parent: string, self: string): Promise<boolean> {
  for (const d of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
    const p = resolve(parent, d.name);
    if (d.isDirectory() && p !== self && await looksMeta(p)) return true;
  }
  return false;
}

/** `light` skips the documents and the glossary: enough for a session's first line, cheap at every start. */
export async function readMetaRepo(dir: string, options: { light?: boolean } = {}): Promise<MetaRepo> {
  const subs = parseGitmodules((await text(resolve(dir, '.gitmodules'))) ?? '');
  const sub = async (s: (typeof subs)[number]): Promise<SubRepo> => ({ ...s, name: basename(s.path), present: (await readdir(resolve(dir, s.path)).catch(() => [])).length > 0 });
  const all = await Promise.all(subs.map(sub));
  const isDep = (s: SubRepo) => /^dependencies\//.test(s.path);
  const compliance = await filesIn(dir, 'compliance', 200);
  const { owners, pipelines } = await deliverySetup(dir, compliance);
  const docs = options.light ? [] : await docsIn(dir, 'docs');
  return {
    name: basename(dir), path: dir,
    repos: all.filter((s) => !isDep(s)), dependencies: all.filter(isDep),
    owners, pipelines, docs, kt: options.light ? [] : await docsIn(dir, 'KT'),
    glossary: options.light ? [] : await glossaryOf(dir, docs),
    skills: await skillsIn(dir),
    compliance,
  };
}

/* ---------------------------------------------------------------- reading */

async function filesIn(dir: string, sub: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string, depth: number) => {
    if (out.length >= limit || depth > 6) return;
    for (const d of (await readdir(resolve(dir, rel), { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.name.startsWith('.') || SKIP.has(d.name)) continue;
      const p = `${rel}/${d.name}`;
      if (d.isDirectory()) await walk(p, depth + 1);
      else if (out.length < limit) out.push(p);
    }
  };
  await walk(sub, 0);
  return out;
}

async function docsIn(dir: string, sub: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const path of (await filesIn(dir, sub, MAX_DOCS)).filter((p) => /\.(md|markdown)$/i.test(p))) {
    const raw = (await text(resolve(dir, path))) ?? '';
    const title = /^#\s+(.+)$/m.exec(raw.replace(/^---[\s\S]*?\n---\n/, ''))?.[1]?.trim() ?? basename(path).replace(/\.(md|markdown)$/i, '');
    docs.push({ path, title });
  }
  return docs;
}

const OWNER_KEY = /^(owners?|maintainers?|responsibles?|contacts?|team|product[-_]?owner|po|codeowners)$/i;
const PIPELINE_KEY = /^(pipelines?|jenkins|workflows?|ci|cd|jobs?)$/i;

async function deliverySetup(dir: string, compliance: readonly string[]): Promise<{ owners: Owner[]; pipelines: Pipeline[] }> {
  const owners: Owner[] = [];
  const pipelines: Pipeline[] = [];
  for (const path of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS', ...compliance.filter((p) => /CODEOWNERS$/.test(p))]) {
    const raw = await text(resolve(dir, path));
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const [scope, ...who] = line.replace(/#.*/, '').trim().split(/\s+/);
      if (scope && who.length) for (const w of who) owners.push({ who: w, scope, source: path });
    }
  }
  for (const path of compliance) {
    if (/Jenkinsfile$/.test(path)) { pipelines.push({ name: basename(dirname(path)) === 'compliance' ? 'Jenkinsfile' : basename(dirname(path)), kind: 'jenkins', source: path, url: null }); continue; }
    if (!/\.(ya?ml|json)$/i.test(path)) continue;
    const raw = await text(resolve(dir, path));
    let data: unknown;
    try { data = raw ? YAML.parse(raw) : null; } catch { continue; }
    walkData(data, (key, value) => {
      if (OWNER_KEY.test(key)) for (const who of people(value)) owners.push({ who, scope: '*', source: path });
      if (PIPELINE_KEY.test(key)) for (const p of pipes(value, path)) pipelines.push(p);
    });
  }
  for (const path of await filesIn(dir, '.github/workflows', 50)) {
    if (!/\.ya?ml$/i.test(path)) continue;
    const raw = await text(resolve(dir, path));
    let name = basename(path).replace(/\.ya?ml$/i, '');
    try { const n = (YAML.parse(raw ?? '') as { name?: unknown } | null)?.name; if (typeof n === 'string') name = n; } catch { /* the file name will do */ }
    pipelines.push({ name, kind: 'github-actions', source: path, url: null });
  }
  const seen = new Set<string>();
  return {
    owners: owners.filter((o) => { const k = `${o.who}|${o.scope}`; if (seen.has(k)) return false; seen.add(k); return true; }),
    pipelines: pipelines.filter((p) => { const k = `${p.kind}|${p.name}|${p.source}`; if (seen.has(k)) return false; seen.add(k); return true; }),
  };
}

function walkData(data: unknown, visit: (key: string, value: unknown) => void, depth = 0): void {
  if (depth > 8 || !data || typeof data !== 'object') return;
  if (Array.isArray(data)) { for (const v of data) walkData(v, visit, depth + 1); return; }
  for (const [k, v] of Object.entries(data)) { visit(k, v); walkData(v, visit, depth + 1); }
}

function people(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,;]\s*/).map((s) => s.trim()).filter((s) => s && s.length <= 120);
  if (Array.isArray(value)) return value.flatMap(people);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const who = [o.name, o.email, o.id, o.user, o.github].find((v) => typeof v === 'string');
    return typeof who === 'string' ? [who] : [];
  }
  return [];
}

function pipes(value: unknown, source: string): Pipeline[] {
  const kindOf = (s: string): Pipeline['kind'] => (/jenkins/i.test(s) ? 'jenkins' : /actions|workflow|\.github/i.test(s) ? 'github-actions' : 'other');
  if (typeof value === 'string') return [{ name: value.slice(0, 120), kind: kindOf(`${source} ${value}`), source, url: /^https?:\/\//.test(value) ? value : null }];
  if (Array.isArray(value)) return value.flatMap((v) => pipes(v, source));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const name = [o.name, o.id, o.job, o.workflow].find((v) => typeof v === 'string');
    if (typeof name === 'string') {
      const url = typeof o.url === 'string' && /^https?:\/\//.test(o.url) ? o.url : null;
      return [{ name: name.slice(0, 120), kind: kindOf(`${source} ${String(o.type ?? '')} ${String(o.kind ?? '')} ${url ?? ''} ${name}`), source, url }];
    }
    // A map of pipelines by name: { build: {...}, release: {...} }
    return Object.entries(o).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => {
      const inner = v as Record<string, unknown>;
      const url = typeof inner.url === 'string' && /^https?:\/\//.test(inner.url) ? inner.url : null;
      return { name: k.slice(0, 120), kind: kindOf(`${source} ${String(inner.type ?? '')} ${url ?? ''}`), source, url };
    });
  }
  return [];
}

/** The glossary: a file named so, anywhere among the docs or at the top. Lines, list items, tables or headings. */
async function glossaryOf(dir: string, docs: readonly Doc[]): Promise<Term[]> {
  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter((p) => /glossa/i.test(p) && /\.(md|markdown)$/i.test(p));
  const paths = [...new Set([...files, ...docs.map((d) => d.path).filter((p) => /glossa/i.test(basename(p)))])];
  const terms: Term[] = [];
  for (const path of paths) {
    const raw = (await text(resolve(dir, path))) ?? '';
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(l);
      if (row && !/^[-: ]+$/.test(row[1]!) && !/^[-: ]+$/.test(row[2]!)) { terms.push({ term: clean(row[1]!), definition: clean(row[2]!), source: path }); continue; }
      const item = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([^*_:\n]{1,80}?)(?:\*\*|__)?\s*[:–]\s+(.{3,})$/.exec(l);
      if (item && !/^#/.test(l) && !/^https?$/i.test(item[1]!.trim())) { terms.push({ term: clean(item[1]!), definition: clean(item[2]!), source: path }); continue; }
      const head = /^#{2,4}\s+(.{1,80})$/.exec(l);
      if (head) {
        const next = lines.slice(i + 1).find((x) => x.trim());
        if (next && !/^#/.test(next)) terms.push({ term: clean(head[1]!), definition: clean(next), source: path });
      }
    }
  }
  // The header row of a table is not a term.
  return terms.filter((t) => !/^(term|terme|mot|word|acronym|acronyme|name|nom)$/i.test(t.term)).slice(0, 500);
}

const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);

async function skillsIn(dir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const d of await readdir(resolve(dir, '.github', 'skills'), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const path = `.github/skills/${d.name}/SKILL.md`;
    const raw = await text(resolve(dir, path));
    if (!raw) continue;
    let name = d.name; let description = '';
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
    try { const data = fm ? YAML.parse(fm) as Record<string, unknown> : {}; if (typeof data.name === 'string') name = data.name; if (typeof data.description === 'string') description = data.description; } catch { /* keep the folder name */ }
    skills.push({ name, description: description.replace(/\s+/g, ' ').trim().slice(0, 300), path });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** A few lines a session can carry: where this folder sits in the team's map. */
export function metaHeadline(meta: MetaRepo, repo: string | null): string {
  const r = repo ? meta.repos.find((x) => x.path === repo || repo.startsWith(`${x.path}/`)) ?? meta.dependencies.find((x) => x.path === repo || repo.startsWith(`${x.path}/`)) : null;
  const dep = r ? meta.dependencies.includes(r) : false;
  const parts = [
    `Meta-repository ${meta.name}: ${meta.repos.length} repositories of the team, ${meta.dependencies.length} dependencies (read only, never changed).`,
    r ? `This folder is ${r.name}${dep ? ', a dependency of another team: read it, do not change it.' : '.'}` : '',
    meta.skills.length ? `Delivery skills in .github/skills/: ${meta.skills.map((s) => s.name).join(', ')}. Use them for a delivery, do not rewrite them.` : '',
    meta.owners.length ? `Owners: ${[...new Set(meta.owners.map((o) => o.who))].slice(0, 6).join(', ')}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
