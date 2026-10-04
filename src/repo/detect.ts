import { posix } from 'node:path';
import type { Inventory, InventoryFile } from './inventory.js';
import type { CiPipeline, Command, CommandKind, DocFile, Evidence, StackItem } from './types.js';

/** Line number (1-based) of a character index. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** The evidence for a match: file, line and the line as written (bounded). */
export function evidenceAt(file: string, text: string, index: number): Evidence {
  const line = lineOf(text, index);
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  const raw = text.slice(start, end === -1 ? undefined : end).trim();
  return { file, line, text: raw.length > 200 ? `${raw.slice(0, 197)}…` : raw };
}

/** First line of `file` containing `needle`, else line 1. */
export function evidenceFor(file: string, text: string, needle: string | RegExp): Evidence {
  const index = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  return evidenceAt(file, text, Math.max(0, index));
}

export function filesOf(inv: Inventory, test: (f: InventoryFile) => boolean): InventoryFile[] {
  return inv.files.filter(test);
}

export function textOf(inv: Inventory, path: string): string | null {
  return inv.text.get(path) ?? null;
}

export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text.replace(/^﻿/, '')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/* ------------------------------------------------------------------ stack */

const NPM_STACK: readonly (readonly [RegExp, string, string])[] = [
  [/^@sap\/cds$/, 'sap-cap', 'SAP CAP (Node.js)'],
  [/^@sap\/cds-dk$/, 'sap-cap-dk', 'SAP CAP dev kit (cds CLI)'],
  [/^@sap\/cds-mtxs$/, 'sap-cap-mtx', 'SAP CAP multitenancy (MTX)'],
  [/^@sap\/approuter$/, 'sap-approuter', 'SAP Application Router'],
  [/^@sap\/xssec$/, 'sap-xsuaa', 'SAP XSUAA security'],
  [/^@sap-cloud-sdk\//, 'sap-cloud-sdk', 'SAP Cloud SDK'],
  [/^(@sap\/hana-client|hdb|@cap-js\/hana)$/, 'hana', 'SAP HANA client'],
  [/^(@cap-js\/sqlite|sqlite3|better-sqlite3)$/, 'sqlite', 'SQLite'],
  [/^(@cap-js\/postgres|pg|postgres)$/, 'postgres', 'PostgreSQL client'],
  [/^(mysql2?|mariadb)$/, 'mysql', 'MySQL / MariaDB client'],
  [/^(mongodb|mongoose)$/, 'mongodb', 'MongoDB'],
  [/^(redis|ioredis)$/, 'redis', 'Redis'],
  [/^kafkajs$/, 'kafka', 'Kafka client'],
  [/^amqplib$|^@sap\/xb-msg/, 'amqp', 'AMQP messaging'],
  [/^@ui5\/cli$/, 'ui5-tooling', 'UI5 tooling'],
  [/^@sap\/ux-ui5-tooling$|^@sap-ux\//, 'fiori-tools', 'SAP Fiori tools'],
  [/^express$/, 'express', 'Express'],
  [/^fastify$/, 'fastify', 'Fastify'],
  [/^@nestjs\/core$/, 'nestjs', 'NestJS'],
  [/^koa$/, 'koa', 'Koa'],
  [/^@hapi\/hapi$/, 'hapi', 'hapi'],
  [/^next$/, 'nextjs', 'Next.js'],
  [/^react$/, 'react', 'React'],
  [/^vue$/, 'vue', 'Vue'],
  [/^@angular\/core$/, 'angular', 'Angular'],
  [/^svelte$/, 'svelte', 'Svelte'],
  [/^(graphql|@apollo\/server|apollo-server)$/, 'graphql', 'GraphQL'],
  [/^typeorm$/, 'typeorm', 'TypeORM'],
  [/^(prisma|@prisma\/client)$/, 'prisma', 'Prisma'],
  [/^sequelize$/, 'sequelize', 'Sequelize'],
  [/^jest$/, 'jest', 'Jest'],
  [/^mocha$/, 'mocha', 'Mocha'],
  [/^vitest$/, 'vitest', 'Vitest'],
  [/^@playwright\/test$/, 'playwright', 'Playwright'],
  [/^cypress$/, 'cypress', 'Cypress'],
  [/^@wdio\/cli$|^wdio-ui5-service$/, 'wdio', 'WebdriverIO'],
  [/^typescript$/, 'typescript', 'TypeScript'],
  [/^(winston|pino|bunyan)$/, 'logging', 'Structured logging'],
  [/^(cf-nodejs-logging-support|@sap\/logging)$/, 'sap-logging', 'SAP BTP logging'],
  [/^@sap\/audit-logging$/, 'sap-audit', 'SAP audit logging'],
  [/^@opentelemetry\/api$/, 'otel', 'OpenTelemetry'],
  [/^axios$/, 'axios', 'axios (HTTP client)'],
  [/^(passport|jsonwebtoken|jose)$/, 'auth-lib', 'Authentication library'],
];

const PY_STACK: readonly (readonly [RegExp, string, string])[] = [
  [/^fastapi\b/i, 'fastapi', 'FastAPI'], [/^flask\b/i, 'flask', 'Flask'], [/^django\b/i, 'django', 'Django'],
  [/^pytest\b/i, 'pytest', 'pytest'], [/^sqlalchemy\b/i, 'sqlalchemy', 'SQLAlchemy'], [/^celery\b/i, 'celery', 'Celery'],
  [/^pandas\b/i, 'pandas', 'pandas'], [/^hdbcli\b/i, 'hana', 'SAP HANA client'], [/^psycopg/i, 'postgres', 'PostgreSQL client'],
];

function addStack(map: Map<string, StackItem>, id: string, label: string, ev: Evidence, version?: string): void {
  const found = map.get(id);
  if (found) {
    if (found.evidence.length < 3) map.set(id, { ...found, evidence: [...found.evidence, ev] });
    return;
  }
  map.set(id, { id, label, ...(version ? { version } : {}), evidence: [ev] });
}

export function detectStack(inv: Inventory): StackItem[] {
  const stack = new Map<string, StackItem>();
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'package.json' && f.kind === 'manifest').sort(byDepth).slice(0, 40)) {
    const text = textOf(inv, f.path);
    const json = text ? parseJson(text) : null;
    if (!text || !json) continue;
    addStack(stack, 'node', 'Node.js', evidenceFor(f.path, text, '"name"'), typeof rec(json.engines).node === 'string' ? String(rec(json.engines).node) : undefined);
    const deps = { ...rec(json.dependencies), ...rec(json.devDependencies), ...rec(json.peerDependencies) };
    for (const [dep, version] of Object.entries(deps)) {
      const hit = NPM_STACK.find(([re]) => re.test(dep));
      if (hit) addStack(stack, hit[1], hit[2], evidenceFor(f.path, text, `"${dep}"`), typeof version === 'string' ? version : undefined);
    }
    if (json.cds !== undefined) addStack(stack, 'sap-cap', 'SAP CAP (Node.js)', evidenceFor(f.path, text, '"cds"'));
  }
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'pom.xml').slice(0, 20)) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    addStack(stack, 'java-maven', 'Java (Maven)', evidenceFor(f.path, text, '<artifactId>'));
    const javaVersion = /<(?:java\.version|maven\.compiler\.(?:source|release))>([^<]+)</.exec(text)?.[1];
    if (javaVersion) addStack(stack, 'java', 'Java', evidenceFor(f.path, text, javaVersion), javaVersion);
    if (/spring-boot/.test(text)) addStack(stack, 'spring-boot', 'Spring Boot', evidenceFor(f.path, text, 'spring-boot'));
    if (/<groupId>com\.sap\.cds<\/groupId>/.test(text)) addStack(stack, 'sap-cap-java', 'SAP CAP (Java)', evidenceFor(f.path, text, 'com.sap.cds'));
    if (/sap-cloud-sdk|com\.sap\.cloud\.sdk/.test(text)) addStack(stack, 'sap-cloud-sdk', 'SAP Cloud SDK', evidenceFor(f.path, text, /sap-cloud-sdk|com\.sap\.cloud\.sdk/));
    if (/junit/i.test(text)) addStack(stack, 'junit', 'JUnit', evidenceFor(f.path, text, /junit/i));
  }
  for (const f of filesOf(inv, (f) => /^build\.gradle(\.kts)?$/.test(posix.basename(f.path))).slice(0, 20)) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    addStack(stack, 'java-gradle', 'Java/Kotlin (Gradle)', evidenceFor(f.path, text, /plugins|dependencies/));
    if (/org\.springframework\.boot/.test(text)) addStack(stack, 'spring-boot', 'Spring Boot', evidenceFor(f.path, text, 'org.springframework.boot'));
  }
  const first = (re: RegExp) => inv.files.find((f) => re.test(f.path));
  const mark = (re: RegExp, id: string, label: string, needle?: string | RegExp) => {
    const f = first(re);
    if (!f) return;
    const text = textOf(inv, f.path) ?? '';
    addStack(stack, id, label, needle ? evidenceFor(f.path, text, needle) : { file: f.path, line: 1, text: firstLine(text) });
  };
  mark(/(^|\/)mta\.ya?ml$/i, 'sap-mta', 'SAP MTA (multi-target application)', 'ID:');
  mark(/(^|\/)xs-app\.json$/i, 'sap-approuter', 'SAP Application Router', '"routes"');
  mark(/(^|\/)xs-security\.json$/i, 'sap-xsuaa', 'SAP XSUAA security', 'xsappname');
  mark(/(^|\/)ui5(-[\w-]+)?\.ya?ml$/i, 'ui5', 'SAPUI5 / Fiori', 'type:');
  if (!stack.has('ui5')) {
    const manifest = inv.files.find((f) => /(^|\/)webapp\/manifest\.json$/i.test(f.path) && /"sap\.app"/.test(textOf(inv, f.path) ?? ''));
    if (manifest) addStack(stack, 'ui5', 'SAPUI5 / Fiori', evidenceFor(manifest.path, textOf(inv, manifest.path)!, '"sap.app"'));
  }
  mark(/(^|\/)\.abapgit\.xml$/i, 'abap', 'ABAP (abapGit)', /<asx|<DATA>/);
  if (!stack.has('abap')) mark(/\.abap$/i, 'abap', 'ABAP');
  mark(/\.srvd(\.srvdsrv|\.asddls)?$|\.bdef(\.asbdef)?$/i, 'abap-rap', 'ABAP RESTful Application Programming (RAP)');
  if (!stack.has('sap-cap') && !stack.has('sap-cap-java')) mark(/\.cds$/i, 'cds', 'CDS models');
  mark(/(^|\/)dockerfile(\.[\w-]+)?$/i, 'docker', 'Docker', /^FROM/m);
  mark(/(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i, 'docker-compose', 'Docker Compose', 'services:');
  mark(/(^|\/)chart\.yaml$/i, 'helm', 'Helm', 'name:');
  const k8s = inv.files.find((f) => /\.ya?ml$/i.test(f.path) && /^kind:\s*(Deployment|Service|Ingress|StatefulSet|CronJob)\b/m.test(textOf(inv, f.path) ?? ''));
  if (k8s) addStack(stack, 'kubernetes', 'Kubernetes', evidenceFor(k8s.path, textOf(inv, k8s.path)!, /^kind:/m));
  const cf = inv.files.find((f) => /(^|\/)manifest(-[\w-]+)?\.ya?ml$/i.test(f.path) && /^applications:/m.test(textOf(inv, f.path) ?? ''));
  if (cf) addStack(stack, 'cloud-foundry', 'Cloud Foundry', evidenceFor(cf.path, textOf(inv, cf.path)!, 'applications:'));
  mark(/\.tf$/i, 'terraform', 'Terraform', /resource|module/);
  for (const f of filesOf(inv, (f) => /(^|\/)(requirements(-[\w-]+)?\.txt|pyproject\.toml|setup\.py|Pipfile)$/i.test(f.path)).slice(0, 10)) {
    const text = textOf(inv, f.path) ?? '';
    addStack(stack, 'python', 'Python', { file: f.path, line: 1, text: firstLine(text) });
    for (const [i, line] of text.split('\n').entries()) {
      const name = line.trim().replace(/^["']|["'],?$/g, '');
      const hit = PY_STACK.find(([re]) => re.test(name));
      if (hit) addStack(stack, hit[1], hit[2], { file: f.path, line: i + 1, text: line.trim() });
    }
  }
  const gomod = first(/(^|\/)go\.mod$/);
  if (gomod) {
    const text = textOf(inv, gomod.path) ?? '';
    addStack(stack, 'go', 'Go', evidenceFor(gomod.path, text, 'module'), /^go\s+([\d.]+)/m.exec(text)?.[1]);
    for (const [re, id, label] of [[/gin-gonic\/gin/, 'gin', 'Gin'], [/labstack\/echo/, 'echo', 'Echo'], [/gofiber\/fiber/, 'fiber', 'Fiber'], [/google\.golang\.org\/grpc/, 'grpc', 'gRPC']] as const) {
      if (re.test(text)) addStack(stack, id, label, evidenceFor(gomod.path, text, re));
    }
  }
  const csproj = first(/\.csproj$/i);
  if (csproj) {
    const text = textOf(inv, csproj.path) ?? '';
    addStack(stack, 'dotnet', '.NET', evidenceFor(csproj.path, text, /TargetFramework/), /<TargetFramework>([^<]+)</.exec(text)?.[1]);
    if (/Microsoft\.AspNetCore|Sdk="Microsoft\.NET\.Sdk\.Web"/.test(text)) addStack(stack, 'aspnet', 'ASP.NET Core', evidenceFor(csproj.path, text, /AspNetCore|Sdk\.Web/));
  }
  // Frameworks and platforms first, runtimes and tooling after.
  return [...stack.values()].sort((a, b) => stackRank(a.id) - stackRank(b.id));
}

const STACK_ORDER = ['sap-cap', 'sap-cap-java', 'spring-boot', 'nestjs', 'express', 'fastify', 'koa', 'hapi', 'nextjs', 'django', 'fastapi', 'flask', 'aspnet', 'gin', 'echo', 'fiber', 'abap-rap', 'abap',
  'ui5', 'fiori-tools', 'react', 'angular', 'vue', 'svelte', 'graphql', 'grpc', 'sap-mta', 'sap-approuter', 'sap-xsuaa', 'sap-cloud-sdk', 'hana', 'postgres', 'mysql', 'mongodb', 'redis', 'sqlite', 'kafka', 'amqp',
  'sap-cap-mtx', 'cloud-foundry', 'kubernetes', 'helm', 'docker', 'docker-compose', 'terraform', 'typeorm', 'prisma', 'sequelize', 'sqlalchemy', 'celery', 'pandas',
  'node', 'typescript', 'java', 'java-maven', 'java-gradle', 'python', 'go', 'dotnet', 'cds',
  'jest', 'mocha', 'vitest', 'junit', 'pytest', 'playwright', 'cypress', 'wdio', 'sap-cap-dk', 'ui5-tooling', 'logging', 'sap-logging', 'sap-audit', 'otel', 'axios', 'auth-lib'];

function stackRank(id: string): number {
  const i = STACK_ORDER.indexOf(id);
  return i === -1 ? STACK_ORDER.length : i;
}

function byDepth(a: InventoryFile, b: InventoryFile): number {
  return a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path);
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 200);
}

/* --------------------------------------------------------------- commands */

function scriptKind(name: string, command: string): CommandKind {
  const n = name.toLowerCase();
  if (/^(start|serve|start:prod)$/.test(n)) return 'start';
  if (/(^|:)(dev|watch|serve|start:(dev|local|hybrid))/.test(n) || /\bcds (watch|serve)\b/.test(command)) return 'dev';
  if (/(^|:)(build|bundle|compile|package)/.test(n)) return 'build';
  if (/(^|:)(test|spec|e2e|coverage|it)\b/.test(n)) return 'test';
  if (/(^|:)(lint|format|prettier|eslint|check)/.test(n)) return 'lint';
  if (/(^|:)(deploy|release|publish|undeploy)/.test(n) || /\b(cf (deploy|push)|mbt build|kubectl apply|helm (install|upgrade))\b/.test(command)) return 'deploy';
  if (/^(install|setup|bootstrap|prepare|postinstall)$/.test(n)) return 'install';
  return 'other';
}

function commandKind(command: string): CommandKind {
  const c = command.toLowerCase();
  if (/\b(npm (i|install|ci)|yarn( install)?$|pnpm (i|install)|pip install|poetry install|mvn (clean )?install|bundle install|go mod download|dotnet restore|git clone)\b/.test(c)) return 'install';
  if (/\b(npm (run )?test|yarn test|pnpm test|mvn test|pytest|go test|dotnet test|gradle test|jest|vitest)\b/.test(c)) return 'test';
  if (/\b(cf (deploy|push)|kubectl apply|helm (install|upgrade)|terraform apply|mbt deploy|npm run deploy)\b/.test(c)) return 'deploy';
  if (/\b(mbt build|npm run build|mvn (clean )?package|gradle build|go build|dotnet build|docker build)\b/.test(c)) return 'build';
  if (/\b(cds (watch|serve)|npm run (dev|watch)|nodemon|ui5 serve|npm run start:)/.test(c)) return 'dev';
  if (/\b(npm start|npm run start|yarn start|mvn spring-boot:run|docker compose up|docker-compose up|python manage\.py runserver|uvicorn|flask run|go run|dotnet run|node [\w./-]+\.m?js)\b/.test(c)) return 'start';
  if (/\b(eslint|prettier|npm run lint)\b/.test(c)) return 'lint';
  return 'other';
}

const SHELL_START = /^(?:\$\s+)?((?:npm|npx|yarn|pnpm|cds|mvn|\.\/mvnw|gradle|\.\/gradlew|make|docker|docker-compose|cf|mbt|pip|pip3|python3?|poetry|uvicorn|flask|go|dotnet|kubectl|helm|terraform|ui5|node|git clone|cd|export|source|cp)\b[^\n]*)$/;

export function detectCommands(inv: Inventory): Command[] {
  const out: Command[] = [];
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'package.json' && f.kind === 'manifest').sort(byDepth).slice(0, 40)) {
    const text = textOf(inv, f.path);
    const json = text ? parseJson(text) : null;
    if (!text || !json) continue;
    const dir = posix.dirname(f.path);
    const prefix = dir === '.' ? '' : `cd ${dir} && `;
    for (const [name, script] of Object.entries(rec(json.scripts))) {
      if (typeof script !== 'string') continue;
      const run = name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`;
      out.push({ name, run: `${prefix}${run}`, script, kind: scriptKind(name, script), from: 'package.json', cwd: dir, evidence: evidenceFor(f.path, text, `"${name}"`) });
    }
  }
  for (const f of filesOf(inv, (f) => /^makefile$/i.test(posix.basename(f.path))).slice(0, 5)) {
    const text = textOf(inv, f.path) ?? '';
    const dir = posix.dirname(f.path);
    for (const m of text.matchAll(/^([A-Za-z][\w.-]*):(?!=)/gm)) {
      const name = m[1]!;
      if (name.startsWith('.')) continue;
      out.push({ name, run: `${dir === '.' ? '' : `cd ${dir} && `}make ${name}`, kind: scriptKind(name, ''), from: 'makefile', cwd: dir, evidence: evidenceAt(f.path, text, m.index) });
    }
  }
  for (const f of filesOf(inv, (f) => f.kind === 'readme' || (f.kind === 'doc' && /\.(md|mdx)$/i.test(f.path))).slice(0, 60)) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    const lines = text.split('\n');
    let fence: string | null = null;
    for (const [i, raw] of lines.entries()) {
      const fenceMatch = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(raw);
      if (fenceMatch) {
        if (fence === null) fence = fenceMatch[2]!.toLowerCase() || 'plain';
        else fence = null;
        continue;
      }
      if (fence === null || !['plain', 'bash', 'sh', 'shell', 'console', 'zsh', 'shell-session', 'cmd', 'powershell', 'ps'].includes(fence)) continue;
      const m = SHELL_START.exec(raw.trim());
      if (!m) continue;
      const run = m[1]!.trim();
      if (/^(cd|export|source|cp)\b/.test(run)) continue;
      out.push({ name: run.split(/\s+/).slice(0, 3).join(' '), run, kind: commandKind(run), from: f.kind === 'readme' ? 'readme' : 'docs', cwd: posix.dirname(f.path), evidence: { file: f.path, line: i + 1, text: raw.trim().slice(0, 200) } });
    }
  }
  return out;
}

/* ------------------------------------------------------------------- docs */

export function detectDocs(inv: Inventory): DocFile[] {
  return filesOf(inv, (f) => f.kind === 'readme' || f.kind === 'doc' || f.kind === 'adr')
    .map((f) => {
      const text = textOf(inv, f.path) ?? '';
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? /^(.+)\n=+\s*$/m.exec(text)?.[1]?.trim() ?? null;
      const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 20);
      return { path: f.path, kind: f.kind, title, lines: f.lines, headings };
    })
    .sort((a, b) => docRank(a) - docRank(b) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
}

function docRank(d: DocFile): number {
  if (d.kind === 'readme' && !d.path.includes('/')) return 0;
  if (d.kind === 'readme') return 1;
  if (/contributing/i.test(d.path)) return 2;
  if (d.kind === 'adr') return 3;
  return 4;
}

/* --------------------------------------------------------------------- CI */

export function detectCi(inv: Inventory): CiPipeline[] {
  const out: CiPipeline[] = [];
  for (const f of filesOf(inv, (f) => f.kind === 'ci')) {
    const text = textOf(inv, f.path) ?? '';
    const lower = f.path.toLowerCase();
    if (lower.includes('.github/workflows/')) {
      const jobsAt = text.search(/^jobs:\s*$/m);
      const jobs = jobsAt >= 0 ? [...text.slice(jobsAt).matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]!) : [];
      const on = /^on:\s*(.*)$/m.exec(text);
      const triggers = on?.[1]?.trim() ? on[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
        : on ? [...text.slice(on.index + on[0].length).matchAll(/^ {2}([\w_]+):/gm)].map((m) => m[1]!).slice(0, 6) : [];
      out.push({ path: f.path, system: 'GitHub Actions', stages: jobs.slice(0, 12), triggers });
    } else if (/jenkinsfile$/i.test(lower)) {
      const stages = [...text.matchAll(/stage\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      out.push({ path: f.path, system: /piperPipeline|piper-lib/i.test(text) ? 'Jenkins (SAP Project Piper)' : 'Jenkins', stages: stages.slice(0, 12), triggers: [] });
    } else if (lower.endsWith('.pipeline/config.yml') || lower.endsWith('.pipeline/config.yaml')) {
      const stagesAt = text.search(/^stages:\s*$/m);
      const stages = stagesAt >= 0 ? [...text.slice(stagesAt).matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]!) : [];
      out.push({ path: f.path, system: 'SAP Project Piper', stages: stages.slice(0, 12), triggers: [] });
    } else if (lower.endsWith('.gitlab-ci.yml') || lower.endsWith('.gitlab-ci.yaml')) {
      const block = /^stages:\s*\n((?:\s+-\s*.+\n?)+)/m.exec(text)?.[1] ?? '';
      out.push({ path: f.path, system: 'GitLab CI', stages: [...block.matchAll(/-\s*([\w-]+)/g)].map((m) => m[1]!), triggers: [] });
    } else if (lower.includes('azure-pipelines')) {
      out.push({ path: f.path, system: 'Azure Pipelines', stages: [...text.matchAll(/-\s*stage:\s*([\w-]+)/g)].map((m) => m[1]!), triggers: [] });
    } else {
      out.push({ path: f.path, system: posix.basename(f.path), stages: [], triggers: [] });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ tests */

const TEST_STACK = new Set(['jest', 'mocha', 'vitest', 'playwright', 'cypress', 'wdio', 'junit', 'pytest']);

export function detectTests(inv: Inventory, stack: readonly StackItem[]): { frameworks: string[]; files: number; dirs: string[] } {
  const tests = filesOf(inv, (f) => f.kind === 'test');
  const dirs = [...new Set(tests.map((t) => posix.dirname(t.path).split('/').slice(0, 2).join('/')))].slice(0, 12);
  const frameworks = stack.filter((s) => TEST_STACK.has(s.id)).map((s) => s.label);
  if (!frameworks.length && tests.some((t) => /\.(java|kt)$/.test(t.path))) frameworks.push('JUnit');
  if (!frameworks.length && tests.some((t) => /_test\.go$/.test(t.path))) frameworks.push('go test');
  return { frameworks, files: tests.length, dirs };
}

/* -------------------------------------------------------------- published */

/** What this repository publishes under a name others can depend on. */
export function detectPublished(inv: Inventory): { kind: 'npm' | 'maven' | 'go' | 'python'; name: string; evidence: Evidence }[] {
  const out: { kind: 'npm' | 'maven' | 'go' | 'python'; name: string; evidence: Evidence }[] = [];
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'package.json' && f.kind === 'manifest').slice(0, 40)) {
    const text = textOf(inv, f.path);
    const json = text ? parseJson(text) : null;
    if (text && typeof json?.name === 'string') out.push({ kind: 'npm', name: json.name, evidence: evidenceFor(f.path, text, '"name"') });
  }
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'pom.xml').slice(0, 20)) {
    const text = textOf(inv, f.path) ?? '';
    const withoutParent = text.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencies>[\s\S]*<\/dependencies>/, '');
    const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(withoutParent)?.[1];
    if (artifact) out.push({ kind: 'maven', name: artifact, evidence: evidenceFor(f.path, text, `<artifactId>${artifact}<`) });
  }
  const gomod = inv.files.find((f) => /(^|\/)go\.mod$/.test(f.path));
  const goText = gomod ? textOf(inv, gomod.path) : null;
  const mod = goText ? /^module\s+(\S+)/m.exec(goText) : null;
  if (gomod && goText && mod) out.push({ kind: 'go', name: mod[1]!, evidence: evidenceAt(gomod.path, goText, mod.index) });
  const py = inv.files.find((f) => /(^|\/)pyproject\.toml$/.test(f.path));
  const pyText = py ? textOf(inv, py.path) : null;
  const pyName = pyText ? /^name\s*=\s*["']([^"']+)["']/m.exec(pyText) : null;
  if (py && pyText && pyName) out.push({ kind: 'python', name: pyName[1]!, evidence: evidenceAt(py.path, pyText, pyName.index) });
  return out;
}
