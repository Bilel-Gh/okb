import { open, readdir, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { listFiles } from './git.js';

/**
 * Every file of a repository, classified the way a careful newcomer would
 * triage it: what must be read in full (documentation, manifests, interfaces,
 * entry points), what deserves a skim (central or busy code), what is only
 * indexed (the rest of the code) and what is skipped, always with the reason.
 * Nothing is executed and nothing outside the repository is read.
 */
export type FileKind =
  | 'readme' | 'doc' | 'adr' | 'manifest' | 'ci' | 'config' | 'api' | 'schema' | 'entry'
  | 'source' | 'test' | 'i18n' | 'script' | 'generated' | 'vendored' | 'lockfile' | 'binary' | 'other';
export type Tier = 'read' | 'skim' | 'index' | 'skip';

export type InventoryFile = {
  readonly path: string;
  readonly lang: string | null;
  kind: FileKind;
  readonly bytes: number;
  lines: number | null;
  tier: Tier;
  why: string;
  /** Top-level folder, or two levels in a monorepo (`packages/api`). `.` for root files. */
  readonly area: string;
};

export type Inventory = {
  readonly root: string;
  readonly files: InventoryFile[];
  readonly fromGit: boolean;
  /** Text content of files small enough to analyse, by path. */
  readonly text: ReadonlyMap<string, string>;
  readonly truncated: boolean;
};

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy',
  py: 'Python', go: 'Go', rs: 'Rust', cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++',
  cds: 'CDS', abap: 'ABAP', asddls: 'ABAP CDS', ddls: 'ABAP CDS', srvd: 'ABAP CDS', bdef: 'ABAP CDS', dcls: 'ABAP CDS',
  sql: 'SQL', hdbtable: 'SQL', hdbview: 'SQL', hdbcds: 'CDS',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
  html: 'HTML', css: 'CSS', scss: 'CSS', less: 'CSS', vue: 'Vue', svelte: 'Svelte',
  xml: 'XML', json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', properties: 'Properties',
  md: 'Markdown', mdx: 'Markdown', rst: 'reStructuredText', adoc: 'AsciiDoc', txt: 'Text',
  gradle: 'Gradle', tf: 'Terraform', proto: 'Protobuf', graphql: 'GraphQL', gql: 'GraphQL', prisma: 'Prisma',
};

const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'target', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', '.nyc_output',
  '__pycache__', '.venv', 'venv', '.tox', '.gradle', '.idea', '.vscode', 'gen', '@cds-models', 'mta_archives', '.mta',
  'obj', '.terraform', '.cache', '.parcel-cache', '.turbo', 'tmp', '.git', 'bower_components', 'jspm_packages', '.angular',
]);
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'gradle.lockfile', 'bun.lockb', 'packages.lock.json']);
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|bmp|tiff?|svgz|woff2?|ttf|eot|otf|zip|tar|gz|tgz|bz2|xz|7z|rar|jar|war|ear|mtar|exe|dll|so|dylib|class|pyc|o|a|lib|bin|mp[34]|wav|mov|avi|webm|ogg|pdf|docx?|pptx?|xlsx?|odt|ods|key|numbers|psd|ai|sketch|fig|sqlite|db|keystore|jks|p12|pfx)$/i;
const READABLE_DOC_EXT = /\.(pdf|docx)$/i;
const MONOREPO_PARENTS = new Set(['packages', 'apps', 'services', 'modules', 'libs', 'components', 'microservices', 'projects']);
const MAX_TEXT_BYTES = 768_000;
const MAX_TEXT_TOTAL = 160_000_000;
const MAX_FILES = 60_000;

export function areaOf(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return '.';
  if (MONOREPO_PARENTS.has(parts[0]!) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

function extOf(path: string): string {
  const base = posix.basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** What a file is, from its name and place alone (content refines it later). */
export function classify(path: string): { kind: FileKind; why: string } {
  const base = posix.basename(path);
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const ext = extOf(path);
  if (segments.slice(0, -1).some((s) => SKIP_DIRS.has(s))) return { kind: 'vendored', why: 'dependencies or build output' };
  if (LOCKFILES.has(base)) return { kind: 'lockfile', why: 'dependency lock file' };
  if (/\.min\.(js|css)$|\.map$|\.snap$|\.bundle\.js$/i.test(base)) return { kind: 'generated', why: 'minified, bundled or snapshot file' };
  if (READABLE_DOC_EXT.test(base) && /(^|\/)(docs?|documentation|wiki|specs?|architecture|design)\//i.test(lower)) return { kind: 'doc', why: 'document (read it with okb ingest)' };
  if (BINARY_EXT.test(base)) return { kind: 'binary', why: 'binary or media file' };
  if (/^readme(\.[a-z]+)?$/i.test(base)) return { kind: 'readme', why: 'README' };
  if (/(^|\/)(adr|adrs|decisions?|architecture[-_ ]decisions?)\//i.test(lower) && /\.(md|mdx|adoc|rst|txt)$/i.test(base)) return { kind: 'adr', why: 'architecture decision record' };
  if (/^(codeowners|contributing(\.md)?|changelog(\.md)?|history\.md|security\.md|code_of_conduct\.md|maintainers(\.md)?|owners(\.md)?|pull_request_template\.md)$/i.test(base)) return { kind: 'doc', why: 'project convention file' };
  if (/\.(md|mdx|adoc|rst)$/i.test(base)) return { kind: 'doc', why: 'documentation' };
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.ya?ml$|^jenkinsfile$|^azure-pipelines\.ya?ml$|(^|\/)\.pipeline\/config\.ya?ml$|^\.travis\.ya?ml$|^bitbucket-pipelines\.ya?ml$|(^|\/)\.circleci\/config\.ya?ml$|^cloudbuild\.ya?ml$/i.test(lower)) return { kind: 'ci', why: 'CI/CD pipeline' };
  if (/^(package\.json|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|mta\.ya?ml|xs-app\.json|xs-security\.json|ui5(-[\w-]+)?\.ya?ml|\.cdsrc(-private)?\.json|dockerfile(\.[\w-]+)?|docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml|chart\.yaml|pyproject\.toml|setup\.py|setup\.cfg|requirements(-[\w-]+)?\.txt|pipfile|go\.mod|cargo\.toml|gemfile|composer\.json|makefile|procfile|\.abapgit\.xml|nx\.json|lerna\.json|turbo\.json|pnpm-workspace\.yaml|tsconfig\.json|angular\.json|vite\.config\.[jt]s|webpack\.config\.[jt]s|next\.config\.[jt]s|nest-cli\.json)$/i.test(base)
    || /\.mtaext$/i.test(base) || /\.(csproj|sln|fsproj)$/i.test(base)
    || /(^|\/)webapp\/manifest\.json$/i.test(lower) || /^manifest(-[\w-]+)?\.ya?ml$/i.test(base)) return { kind: 'manifest', why: 'build, packaging or deployment manifest' };
  if (/^\.env(\.(example|sample|template|dist|defaults))$|^default-env\.json$|^\.env$/i.test(base)) return { kind: 'config', why: 'environment configuration (names only, never values)' };
  if (/(^|\/)(helm|charts?|k8s|kubernetes|deploy|deployment|manifests?|infra|terraform)\//i.test(lower) && /\.(ya?ml|tf|json)$/i.test(base)) return { kind: 'manifest', why: 'infrastructure manifest' };
  if (/(openapi|swagger|asyncapi)[\w.-]*\.(ya?ml|json)$/i.test(base) || /\.(proto|graphql|gql|edmx)$/i.test(base) || /\.srvd(\.asddls)?$/i.test(base)) return { kind: 'api', why: 'API definition' };
  if (ext === 'cds' || /\.(prisma|hdbtable|hdbview|hdbcds)$/i.test(base) || /(^|\/)(migrations?|db\/changelog|flyway|liquibase)\//i.test(lower)) return { kind: 'schema', why: 'data or service model' };
  if (/(^|\/)i18n\/|\.properties$/i.test(lower) && /i18n|messages|texts/i.test(lower)) return { kind: 'i18n', why: 'user-facing texts (business vocabulary)' };
  if (/(^|\/)(tests?|__tests__|spec|specs|e2e|integration-tests?)\/|\.(test|spec|it)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$/.test(path)) return { kind: 'test', why: 'automated test' };
  if (/(^|\/)(application|bootstrap)(-[\w-]+)?\.(ya?ml|properties)$|(^|\/)config\/[^/]+\.(json|ya?ml|toml|js|ts)$|\.config\.(js|ts|cjs|mjs)$|(^|\/)\.[\w-]+rc(\.json|\.ya?ml|\.js)?$/i.test(lower)) return { kind: 'config', why: 'configuration' };
  if (/^(server|app|main|index|start|bootstrap|cli)\.(js|ts|mjs|cjs|py|go|java|kt)$/i.test(base) && segments.length <= 3) return { kind: 'entry', why: 'probable entry point (by name)' };
  if (/Application\.(java|kt)$/.test(base)) return { kind: 'entry', why: 'probable application entry point' };
  if (/^(scripts?|tools?|bin|hack)\//i.test(lower) || /\.(sh|bash|zsh|ps1)$/i.test(base)) return { kind: 'script', why: 'script or tool' };
  if (LANG[ext]) return { kind: 'source', why: 'source code' };
  return { kind: 'other', why: 'other file' };
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, prefix: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name === '.git') continue;
        await rec(join(dir, entry.name), rel);
      } else if (entry.isFile()) out.push(rel);
      if (out.length >= MAX_FILES) return;
    }
  }
  await rec(root, '');
  return out;
}

async function readHead(abs: string, bytes: number): Promise<Buffer> {
  const handle = await open(abs, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function buildInventory(root: string): Promise<Inventory> {
  const listed = await listFiles(root);
  const paths = (listed ?? (await walk(root))).filter((p) => !p.startsWith('.git/'));
  const truncated = paths.length > MAX_FILES;
  const files: InventoryFile[] = [];
  const text = new Map<string, string>();
  let total = 0;
  for (const path of paths.slice(0, MAX_FILES)) {
    const abs = resolve(root, path);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) continue;
    const { kind, why } = classify(path);
    const entry: InventoryFile = { path, lang: LANG[extOf(path)] ?? (posix.basename(path).toLowerCase().startsWith('dockerfile') ? 'Dockerfile' : null), kind, bytes: info.size, lines: null, tier: 'index', why, area: areaOf(path) };
    files.push(entry);
    if (kind === 'vendored' || kind === 'lockfile' || kind === 'binary' || kind === 'generated' || (kind === 'doc' && READABLE_DOC_EXT.test(path))) continue;
    if (info.size > MAX_TEXT_BYTES || total + info.size > MAX_TEXT_TOTAL) continue;
    const bytes = await readHead(abs, info.size).catch(() => null);
    if (!bytes || bytes.includes(0)) { entry.kind = 'binary'; entry.why = 'binary content'; continue; }
    const content = bytes.toString('utf8');
    if (/@generated|auto-?generated|do not edit|generated by/i.test(content.slice(0, 600)) && entry.kind !== 'readme') {
      entry.kind = 'generated';
      entry.why = 'marked as generated';
    }
    entry.lines = content.length ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0;
    text.set(path, content);
    total += info.size;
  }
  return { root, files, fromGit: listed !== null, text, truncated };
}

export const LANGUAGES = LANG;
