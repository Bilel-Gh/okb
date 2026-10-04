import { posix } from 'node:path';
import { findSecrets } from '../security/secrets.js';
import type { Inventory } from './inventory.js';
import { evidenceAt, filesOf, lineOf, parseJson, textOf } from './detect.js';
import type { ChangeStats } from './git.js';
import type { Command, Entity, Evidence, Iface, Module, Risk, Term } from './types.js';

/**
 * What a senior would point at on day one: which folder does what, which files
 * everything depends on, which ones change all the time, who works where, the
 * business words, and the places where the documentation and the code disagree.
 */
/** Role ids by folder-naming convention; the words come from the reader's language. */
const ROLES: readonly (readonly [RegExp, string])[] = [
  [/^(srv|server|service|services|api|backend|handlers?|controllers?|routes?)$/i, 'services'],
  [/^(db|database|data|model|models|schema|persistence|migrations?|entities|domain)$/i, 'data'],
  [/^(app|apps|ui|webapp|frontend|web|client|public|views|pages|components)$/i, 'ui'],
  [/^(test|tests|__tests__|e2e|spec|specs|integration-tests?)$/i, 'tests'],
  [/^(docs?|documentation|adr|wiki)$/i, 'docs'],
  [/^(scripts?|tools?|bin|hack|utils?-scripts)$/i, 'scripts'],
  [/^(infra|infrastructure|deploy|deployment|helm|charts?|k8s|kubernetes|terraform|\.pipeline|\.github|ci)$/i, 'deploy'],
  [/^(lib|libs|common|shared|core|utils?|helpers?|packages)$/i, 'shared'],
  [/^(config|conf|configuration|settings)$/i, 'config'],
  [/^(approuter|router|gateway)$/i, 'router'],
  [/^(src|source|main)$/i, 'source'],
  [/^(i18n|locales?|translations?)$/i, 'i18n'],
];

export function roleOf(area: string): string | null {
  const last = area.split('/').pop() ?? area;
  return ROLES.find(([re]) => re.test(last))?.[1] ?? null;
}

export function detectModules(inv: Inventory, stats: ChangeStats | null): Module[] {
  const byArea = new Map<string, { files: number; lines: number; langs: Map<string, number>; readme: string | null; changes: number; last: string | null; authors: Map<string, number> }>();
  const areaByPath = new Map(inv.files.map((f) => [f.path, f.area]));
  const authorsOf = new Map<string, Map<string, number>>();
  if (stats) for (const [author, files] of stats.authorFiles) for (const file of files) {
    const area = areaByPath.get(file) ?? file.split('/')[0]!;
    const m = authorsOf.get(area) ?? new Map<string, number>();
    m.set(author, (m.get(author) ?? 0) + 1);
    authorsOf.set(area, m);
  }
  for (const f of inv.files) {
    if (f.kind === 'vendored' || f.kind === 'generated' || f.kind === 'lockfile') continue;
    const a = byArea.get(f.area) ?? { files: 0, lines: 0, langs: new Map(), readme: null, changes: 0, last: null, authors: authorsOf.get(f.area) ?? new Map() };
    a.files += 1;
    a.lines += f.lines ?? 0;
    if (f.lang && !['Markdown', 'JSON', 'YAML', 'Text'].includes(f.lang)) a.langs.set(f.lang, (a.langs.get(f.lang) ?? 0) + (f.lines ?? 1));
    if (f.kind === 'readme' && (!a.readme || f.path.split('/').length < a.readme.split('/').length)) a.readme = f.path;
    const changes = stats?.fileChanges.get(f.path) ?? 0;
    a.changes += changes;
    const last = stats?.lastChange.get(f.path) ?? null;
    if (last && (!a.last || last > a.last)) a.last = last;
    byArea.set(f.area, a);
  }
  return [...byArea]
    .map(([path, a]) => ({
      path,
      role: path === '.' ? null : roleOf(path),
      files: a.files,
      lines: a.lines,
      languages: [...a.langs].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l]) => l),
      readme: a.readme,
      changes: a.changes,
      lastChange: a.last,
      authors: [...a.authors].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n]) => n),
    }))
    .sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : b.lines - a.lines));
}

/* --------------------------------------------------------------- ownership */

export function detectCodeowners(inv: Inventory): { pattern: string; owners: string[]; evidence: Evidence }[] {
  const file = inv.files.find((f) => /(^|\/)(\.github\/|docs\/)?CODEOWNERS$/.test(f.path));
  if (!file) return [];
  const text = textOf(inv, file.path) ?? '';
  const out: { pattern: string; owners: string[]; evidence: Evidence }[] = [];
  for (const m of text.matchAll(/^([^#\s][^\s]*)\s+(.+)$/gm)) {
    const owners = m[2]!.split(/\s+/).filter((o) => o.startsWith('@') || o.includes('@'));
    if (owners.length) out.push({ pattern: m[1]!, owners: owners.map((o) => (o.includes('@') && !o.startsWith('@') ? o.split('@')[0]! : o)), evidence: evidenceAt(file.path, text, m.index) });
  }
  return out.slice(0, 60);
}

export function authorSummary(stats: ChangeStats | null, inv: Inventory): { name: string; changes: number; areas: string[] }[] {
  if (!stats) return [];
  const areaByPath = new Map(inv.files.map((f) => [f.path, f.area]));
  return [...stats.authorFiles]
    .map(([name, files]) => {
      const areas = new Map<string, number>();
      for (const file of files) {
        const area = areaByPath.get(file) ?? file.split('/')[0]!;
        areas.set(area, (areas.get(area) ?? 0) + 1);
      }
      return { name, changes: files.length, areas: [...areas].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a) };
    })
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 12);
}

/* ------------------------------------------------------- hotspots, fan-in */

export function detectHotspots(inv: Inventory, stats: ChangeStats | null): { path: string; changes: number; lines: number | null }[] {
  if (!stats) return [];
  const known = new Map(inv.files.map((f) => [f.path, f]));
  return [...stats.fileChanges]
    .filter(([p]) => {
      const f = known.get(p);
      return f && ['source', 'entry', 'schema', 'api', 'config', 'manifest', 'script'].includes(f.kind) && !/package\.json$/.test(p);
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, changes]) => ({ path, changes, lines: known.get(path)?.lines ?? null }));
}

const JS_EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.cds', '/index.ts', '/index.js', '/index.tsx', '/index.cds'];

/** The modules most other files import: where a change ripples furthest. */
export function detectCentral(inv: Inventory): { path: string; importedBy: number }[] {
  const paths = new Set(inv.files.map((f) => f.path));
  const counts = new Map<string, Set<string>>();
  const hit = (from: string, target: string | null) => {
    if (!target || target === from) return;
    const set = counts.get(target) ?? new Set<string>();
    set.add(from);
    counts.set(target, set);
  };
  const javaIndex = new Map<string, string>();
  for (const f of inv.files) {
    const m = /(?:^|\/)src\/main\/(?:java|kotlin)\/(.+)\.(java|kt)$/.exec(f.path);
    if (m) javaIndex.set(m[1]!.replace(/\//g, '.'), f.path);
  }
  for (const f of inv.files) {
    if (!['source', 'entry', 'schema', 'script', 'test'].includes(f.kind)) continue;
    const text = textOf(inv, f.path);
    if (!text) continue;
    const dir = posix.dirname(f.path);
    if (/\.(m?[jt]sx?|cjs|cds)$/.test(f.path)) {
      for (const m of text.matchAll(/(?:from\s*|require\(\s*|import\(\s*|using\s*\{[^}]*\}\s*from\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const base = posix.normalize(posix.join(dir, m[1]!));
        const stripped = base.replace(/\.(m?js|cjs)$/, '');
        const candidates = [...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => stripped + e)];
        hit(f.path, candidates.find((c) => paths.has(c)) ?? null);
      }
    } else if (/\.(java|kt)$/.test(f.path)) {
      for (const m of text.matchAll(/^import\s+([\w.]+)\s*;?$/gm)) hit(f.path, javaIndex.get(m[1]!) ?? null);
    } else if (/\.py$/.test(f.path)) {
      for (const m of text.matchAll(/^from\s+([\w.]+)\s+import/gm)) {
        const mod = m[1]!.replace(/\./g, '/');
        hit(f.path, [`${mod}.py`, `${mod}/__init__.py`, `src/${mod}.py`].find((c) => paths.has(c)) ?? null);
      }
    }
  }
  return [...counts].map(([path, from]) => ({ path, importedBy: from.size })).filter((x) => x.importedBy >= 2).sort((a, b) => b.importedBy - a.importedBy).slice(0, 15);
}

/* ---------------------------------------------------------------- glossary */

const TECH_WORDS = new Set(['id', 'ids', 'uuid', 'name', 'names', 'description', 'descr', 'type', 'types', 'data', 'value', 'values', 'item', 'items', 'list', 'service', 'services', 'handler', 'handlers', 'util', 'utils', 'helper', 'helpers', 'test', 'tests', 'config', 'index', 'main', 'app', 'base', 'common', 'core', 'default', 'admin', 'user', 'users', 'error', 'errors', 'message', 'messages', 'text', 'texts', 'title', 'label', 'code', 'codes', 'key', 'keys', 'entity', 'entities', 'model', 'models', 'catalog', 'manager', 'controller', 'repository', 'dto', 'impl', 'api', 'temp', 'tmp', 'cuid', 'managed', 'createdat', 'modifiedat', 'createdby', 'modifiedby', 'currency', 'language', 'country', 'yes', 'no', 'ok', 'cancel', 'save', 'edit', 'delete', 'create', 'update', 'search', 'filter', 'apptitle', 'appdescription', 'flpTitle', 'flpsubtitle']);

export function detectGlossary(inv: Inventory, entities: readonly Entity[], provides: readonly Iface[]): Term[] {
  const candidates = new Map<string, { term: string; from: Term['from']; where: Set<string> }>();
  const add = (raw: string, from: Term['from'], where: string) => {
    const term = raw.trim();
    const key = term.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüç]+/gi, '');
    if (term.length < 3 || term.length > 60 || TECH_WORDS.has(key) || /^\d/.test(term)) return;
    const found = candidates.get(key) ?? { term, from, where: new Set<string>() };
    found.where.add(where);
    candidates.set(key, found);
  };
  for (const e of entities) add(e.name, 'entity', e.evidence.file);
  for (const p of provides) if (p.kind === 'cds-service' && !p.name.includes(' ')) add(p.name.replace(/Service$/, ''), 'service', p.evidence.file);
  for (const f of filesOf(inv, (f) => f.kind === 'i18n' && /(^|\/)i18n(_en|_fr|_de)?\.properties$/i.test(f.path)).slice(0, 6)) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/^\s*[\w.-]+\s*[=:]\s*(.+)$/gm)) {
      const label = m[1]!.trim();
      if (label.split(/\s+/).length <= 4 && /^[\p{L}][\p{L}\s'’-]+$/u.test(label)) add(label, 'label', f.path);
    }
  }
  // How often each term shows up says how central it is: the number of files
  // whose identifiers or words contain it (SalesOrder, sales_order, "sales order").
  const sources = filesOf(inv, (f) => ['source', 'entry', 'schema', 'api', 'doc', 'readme', 'i18n'].includes(f.kind)).slice(0, 6000);
  const keyOf = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '');
  const wanted = new Map([...candidates.keys()].map((k) => [keyOf(k), k] as const));
  const counts = new Map<string, { n: number; where: string[] }>();
  for (const f of sources) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    const seen = new Set<string>();
    for (const m of text.matchAll(/[\p{L}][\p{L}\p{N}_]{2,}/gu)) seen.add(keyOf(m[0]));
    for (const m of text.matchAll(/[\p{L}]+(?:[ _-][\p{L}]+){1,3}/gu)) seen.add(keyOf(m[0]));
    for (const key of seen) {
      const term = wanted.get(key);
      if (!term) continue;
      const c = counts.get(term) ?? { n: 0, where: [] };
      c.n += 1;
      if (c.where.length < 5) c.where.push(f.path);
      counts.set(term, c);
    }
  }
  const out: Term[] = [];
  for (const [key, c] of candidates) {
    const words = c.term.replace(/([a-z])([A-Z])/g, '$1 $2');
    const found = counts.get(key);
    const where = [...new Set([...c.where, ...(found?.where ?? [])])].slice(0, 5);
    out.push({ term: c.from === 'label' ? c.term : words, count: Math.max(found?.n ?? 0, c.where.size), where, from: c.from });
  }
  return out.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).slice(0, 40);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ risks */

export function detectRisks(inv: Inventory, commands: readonly Command[], testFiles: number, ciCount: number): Risk[] {
  const risks: Risk[] = [];
  const readme = inv.files.find((f) => f.kind === 'readme' && !f.path.includes('/'));
  if (!readme) risks.push({ kind: 'no-readme', detail: 'no README at the root of the repository' });
  else if ((readme.lines ?? 0) < 15) risks.push({ kind: 'thin-readme', detail: `the root README has only ${readme.lines ?? 0} lines`, params: { file: readme.path, lines: readme.lines ?? 0 }, evidence: { file: readme.path, line: 1, text: (textOf(inv, readme.path) ?? '').split('\n')[0]!.slice(0, 200) } });
  if (testFiles === 0) risks.push({ kind: 'no-tests', detail: 'no automated test file found' });
  if (ciCount === 0) risks.push({ kind: 'no-ci', detail: 'no CI/CD pipeline file found' });
  for (const f of inv.files) {
    const base = posix.basename(f.path);
    if (/^\.env$|^default-env\.json$|^\.cdsrc-private\.json$/.test(base)) risks.push({ kind: 'tracked-env', detail: `${f.path} is present and not ignored by Git: it may hold credentials (its values are never read)`, params: { file: f.path }, evidence: { file: f.path, line: 1, text: base } });
  }
  let scanned = 0;
  for (const f of inv.files) {
    if (!['source', 'entry', 'config', 'manifest', 'ci', 'doc', 'readme', 'script'].includes(f.kind) || /^\.env$|default-env\.json$/.test(posix.basename(f.path))) continue;
    const text = textOf(inv, f.path);
    if (!text || scanned++ > 3000) continue;
    // Strong formats anywhere; a plain `password = "…"` only where configuration lives (tests use fake ones).
    const strongOnly = f.kind === 'test' || f.kind === 'source' || f.kind === 'entry' || f.kind === 'doc' || f.kind === 'readme';
    for (const s of findSecrets(text).filter((x) => !strongOnly || !/assign/.test(x.kind)).slice(0, 2)) {
      risks.push({ kind: 'secret-like', detail: `${s.kind} at ${f.path}:${s.line} (value not copied)`, params: { what: s.kind, file: f.path, line: s.line }, evidence: { file: f.path, line: s.line, text: `(${s.kind}, value hidden)` } });
    }
  }
  risks.push(...detectDrift(inv, commands));
  const todos = filesOf(inv, (f) => f.kind === 'source' || f.kind === 'entry')
    .map((f) => ({ f, n: (textOf(inv, f.path)?.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  for (const { f, n } of todos) {
    const text = textOf(inv, f.path)!;
    risks.push({ kind: 'todo', detail: `${n} TODO/FIXME in ${f.path}`, params: { count: n, file: f.path }, evidence: evidenceAt(f.path, text, text.search(/\b(TODO|FIXME|HACK|XXX)\b/)) });
  }
  for (const f of filesOf(inv, (f) => (f.kind === 'source' || f.kind === 'entry') && (f.lines ?? 0) > 1500).sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0)).slice(0, 5)) {
    risks.push({ kind: 'large-file', detail: `${f.path} has ${f.lines} lines`, params: { file: f.path, lines: f.lines ?? 0 }, evidence: { file: f.path, line: 1, text: (textOf(inv, f.path) ?? '').split('\n')[0]!.slice(0, 200) } });
  }
  return risks;
}

/**
 * The documentation says one thing, the repository another: a README command
 * whose script does not exist, a path that is not there. A drift is a reason to
 * ask, not proof the documentation is wrong (the script may live elsewhere).
 */
export function detectDrift(inv: Inventory, commands: readonly Command[]): Risk[] {
  const out: Risk[] = [];
  const scripts = new Map<string, Set<string>>();
  for (const c of commands) if (c.from === 'package.json') {
    const set = scripts.get(c.cwd) ?? new Set<string>();
    set.add(c.name);
    scripts.set(c.cwd, set);
  }
  const makeTargets = new Set(commands.filter((c) => c.from === 'makefile').map((c) => c.name));
  const hasMakefile = inv.files.some((f) => /^makefile$/i.test(posix.basename(f.path)));
  for (const c of commands) {
    if (c.from !== 'readme' && c.from !== 'docs') continue;
    const npm = /^(?:npm run|yarn|pnpm(?: run)?)\s+([\w:.-]+)/.exec(c.run);
    if (npm && !['install', 'add', 'i', 'ci', 'dlx', 'exec', 'create', 'init', 'test', 'start'].includes(npm[1]!)) {
      const any = [...scripts.values()].some((s) => s.has(npm[1]!));
      if (scripts.size && !any) out.push({ kind: 'doc-drift', detail: `${c.evidence.file} says \`${c.run}\`, but no package.json declares a "${npm[1]}" script`, params: { code: 'script', doc: c.evidence.file, line: c.evidence.line, said: c.run, name: npm[1]! }, evidence: c.evidence });
    }
    const make = /^make\s+([\w.-]+)/.exec(c.run);
    if (make && (!hasMakefile || !makeTargets.has(make[1]!))) out.push({ kind: 'doc-drift', detail: `${c.evidence.file} says \`${c.run}\`, but ${hasMakefile ? `the Makefile has no "${make[1]}" target` : 'there is no Makefile'}`, params: { code: 'make', doc: c.evidence.file, line: c.evidence.line, said: c.run, name: make[1]! }, evidence: c.evidence });
  }
  // A path in the documentation is checked only when it starts in a folder that
  // exists here (so it names this repository) and matches no file by suffix.
  const paths = new Set(inv.files.map((f) => f.path));
  const dirs = new Set(inv.files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))));
  const top = new Set(inv.files.map((f) => f.path.split('/')[0]!));
  const suffixes = inv.files.map((f) => `/${f.path}`);
  for (const f of filesOf(inv, (f) => (f.kind === 'readme' || f.kind === 'doc') && !/changelog|history|release/i.test(f.path)).slice(0, 40)) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/`((?:\.\/)?[\w.-]+\/[\w./-]*[\w-]\.[a-z]{1,5})`/gi)) {
      const ref = m[1]!.replace(/^\.\//, '');
      if (/[*<>{}$]/.test(ref) || !top.has(ref.split('/')[0]!)) continue;
      const relative = posix.normalize(posix.join(posix.dirname(f.path), ref));
      if (paths.has(ref) || dirs.has(ref) || paths.has(relative) || suffixes.some((s) => s.endsWith(`/${ref}`))) continue;
      out.push({ kind: 'doc-drift', detail: `${f.path} mentions \`${m[1]}\`, which is not in the repository`, params: { code: 'path', doc: f.path, line: lineOf(text, m.index), said: m[1]!, name: m[1]! }, evidence: evidenceAt(f.path, text, m.index) });
    }
  }
  return out.slice(0, 20);
}

/** The repository's own one-line description: package.json, then the README's first paragraph. */
export function detectDescription(inv: Inventory): string | null {
  const pkg = inv.files.find((f) => f.path === 'package.json');
  const json = pkg ? parseJson(textOf(inv, pkg.path) ?? '') : null;
  if (typeof json?.description === 'string' && json.description.trim()) return json.description.trim().slice(0, 300);
  const readme = inv.files.find((f) => f.kind === 'readme' && !f.path.includes('/'));
  const text = readme ? textOf(inv, readme.path) : null;
  if (!text) return null;
  const para = text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('[!') && !p.startsWith('![') && !p.startsWith('<') && !p.startsWith('```') && !p.startsWith('|') && p.length > 20);
  return para ? para.replace(/\s+/g, ' ').slice(0, 300) : null;
}
