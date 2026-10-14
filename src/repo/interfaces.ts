import { baseVariable, envConstants, normalizePath } from '../arch/paths.js';
import { posix } from 'node:path';
import YAML from 'yaml';
import type { Inventory, InventoryFile } from './inventory.js';
import { evidenceAt, evidenceFor, filesOf, parseJson, textOf } from './detect.js';
import type { Entity, EnvVar, Environment, Evidence, Iface, IfaceKind } from './types.js';

/**
 * Who the repository talks to, and who can talk to it. Each finding is a
 * declaration in a file (a route, a destination, a binding, a URL), not proof
 * that the call happens at run time: a note says "the code declares", never
 * "the service calls".
 */
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const CODE = /\.(m?[jt]sx?|cjs|java|kt|py|go|cs|rb|php|scala|groovy|abap)$/i;
const isCode = (f: InventoryFile) => (f.kind === 'source' || f.kind === 'entry' || f.kind === 'script') && CODE.test(f.path);

class IfaceSet {
  private readonly items = new Map<string, Iface>();
  add(kind: IfaceKind, name: string, evidence: Evidence, detail?: string): void {
    // An HTTP call is also told apart by its base: GET /health on two services is two calls (F2.0-34).
    const key = `${kind}\u0000${name}${kind === 'http-call' ? `\u0000${detail ?? ''}` : ''}`;
    const found = this.items.get(key);
    if (found) { this.items.set(key, { ...found, count: (found.count ?? 1) + 1 }); return; }
    this.items.set(key, { kind, name, evidence, ...(detail ? { detail } : {}) });
  }
  list(): Iface[] { return [...this.items.values()]; }
}

/* ---------------------------------------------------------------- provides */

export function detectProvides(inv: Inventory): Iface[] {
  const out = new IfaceSet();
  for (const f of filesOf(inv, (f) => /\.cds$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/(@\(\s*path\s*:\s*['"]([^'"]+)['"][^)]*\)\s*|@path\s*:\s*['"]([^'"]+)['"]\s*)?\bservice\s+([\w.]+)\s*(@\(\s*path\s*:\s*['"]([^'"]+)['"][^)]*\))?/g)) {
      const path = m[2] ?? m[3] ?? m[6];
      out.add('cds-service', m[4]!, evidenceAt(f.path, text, m.index + (m[1]?.length ?? 0)), path ? `path ${path}` : undefined);
    }
    for (const m of text.matchAll(/^\s*(action|function)\s+(\w+)\s*\(/gm)) out.add('cds-service', `${m[1]} ${m[2]}`, evidenceAt(f.path, text, m.index), 'operation');
    for (const m of text.matchAll(/^\s*event\s+(\w+)\b/gm)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'declared event (CDS)');
  }
  for (const f of filesOf(inv, isCode)) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    if (/\.(m?[jt]sx?|cjs)$/.test(f.path)) {
      for (const m of text.matchAll(/\b(app|router|server|api|routes?|r)\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/g)) {
        out.add('http-route', `${m[2]!.toUpperCase()} ${m[3]}`, evidenceAt(f.path, text, m.index));
      }
      const controller = /@Controller\(\s*['"]([^'"]*)['"]/.exec(text)?.[1];
      if (controller !== undefined) {
        for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g)) {
          out.add('http-route', `${m[1]!.toUpperCase()} /${[controller, m[2] ?? ''].filter(Boolean).join('/').replace(/^\/+/, '')}`, evidenceAt(f.path, text, m.index));
        }
      }
      for (const m of text.matchAll(/\b(?:srv|this|service|messaging|cds\.services?\.\w+)\.emit\(\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'emitted');
      // Published to a broker: Kafka producers, RabbitMQ channels.
      for (const m of text.matchAll(/\.send\(\s*\{\s*topic\s*:\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'published');
      for (const m of text.matchAll(/\.publish\(\s*['"][^'"]*['"]\s*,\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'published');
      for (const m of text.matchAll(/\.sendToQueue\(\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'published');
    }
    if (/\.(java|kt)$/.test(f.path)) {
      const base = /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/.exec(text)?.[1] ?? '';
      for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?(?:"([^"]*)")?/g)) {
        out.add('http-route', `${m[1]!.toUpperCase()} ${`/${base}/${m[2] ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')}`, evidenceAt(f.path, text, m.index));
      }
      for (const m of text.matchAll(/@KafkaListener\([^)]*topics\s*=\s*\{?\s*"([^"]+)"/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'consumed topic');
    }
    if (/\.py$/.test(f.path)) {
      for (const m of text.matchAll(/@(?:app|router|bp|blueprint|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/g)) {
        out.add('http-route', `${m[1] === 'route' ? 'ANY' : m[1]!.toUpperCase()} ${m[2]}`, evidenceAt(f.path, text, m.index));
      }
    }
  }
  for (const f of filesOf(inv, (f) => f.kind === 'api')) {
    const text = textOf(inv, f.path) ?? '';
    if (/\.(ya?ml|json)$/i.test(f.path) && /\b(openapi|swagger)\b/i.test(text.slice(0, 400))) {
      const title = /^\s*["']?title["']?\s*:\s*["']?([^"'\n,]+)/m.exec(text)?.[1]?.trim();
      const paths = (text.match(/^\s{2}["']?\/[^:\s"']*["']?\s*:/gm) ?? []).length;
      out.add('openapi', title ?? posix.basename(f.path), evidenceFor(f.path, text, /openapi|swagger/i), `${paths} path(s)`);
    }
    if (/\.(graphql|gql)$/i.test(f.path)) for (const m of text.matchAll(/type\s+(Query|Mutation|Subscription)\b/g)) out.add('graphql', m[1]!, evidenceAt(f.path, text, m.index));
    if (/\.proto$/i.test(f.path)) for (const m of text.matchAll(/^service\s+(\w+)/gm)) out.add('grpc', m[1]!, evidenceAt(f.path, text, m.index));
    if (/\.srvd/i.test(f.path)) for (const m of text.matchAll(/define\s+service\s+(\w+)/gi)) out.add('odata', m[1]!, evidenceAt(f.path, text, m.index), 'ABAP RAP service definition');
  }
  for (const f of filesOf(inv, (f) => /(^|\/)mta\.ya?ml$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const doc = safeYaml(text);
    for (const module of Array.isArray(doc.modules) ? doc.modules : []) {
      for (const p of Array.isArray(rec(module).provides) ? (rec(module).provides as unknown[]) : []) {
        const name = rec(p).name;
        if (typeof name === 'string') out.add('service-binding', name, evidenceFor(f.path, text, new RegExp(`name:\\s*${escapeRe(name)}\\b`)), `provided by module ${String(rec(module).name ?? '')}`);
      }
    }
  }
  for (const f of filesOf(inv, (f) => /(^|\/)webapp\/manifest\.json$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const json = parseJson(text);
    const id = rec(rec(json)['sap.app']).id;
    if (typeof id === 'string') out.add('ui-app', id, evidenceFor(f.path, text, '"id"'), 'SAPUI5 / Fiori application');
  }
  return out.list();
}

/* ---------------------------------------------------------------- consumes */

/** Read top-level Fetch options without evaluating source code. Unreadable input stays unknown. */
function fetchMethod(text: string): string {
  const tail = text.trimStart();
  if (!tail.startsWith(',')) return 'GET';
  const object = tail.slice(1).trimStart();
  if (!object.startsWith('{')) return 'ANY';
  const properties: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let start = 1;
  let closed = false;
  for (let i = 0; i < Math.min(object.length, 8192); i++) {
    const c = object[i]!;
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    // Comments or computed syntax can carry a method we cannot establish here.
    if (c === '/' && (object[i + 1] === '/' || object[i + 1] === '*')) return 'ANY';
    if (c === '{' || c === '(' || c === '[') depth += 1;
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      if (depth === 0) { properties.push(object.slice(start, i).trim()); closed = c === '}'; break; }
    }
    if (c === ',' && depth === 1) { properties.push(object.slice(start, i).trim()); start = i + 1; }
  }
  if (!closed) return 'ANY';
  let method = 'GET';
  for (const property of properties) {
    if (property.startsWith('...') || property.startsWith('[') || /^get\s+method\b/.test(property)) return 'ANY';
    const field = /^(?:method|['"]method['"])\s*:(.*)$/s.exec(property);
    if (field) method = /^\s*['"`]([A-Za-z]+)['"`]\s*$/.exec(field[1]!)?.[1]?.toUpperCase() ?? 'ANY';
    else if (/^method\b/.test(property)) method = 'ANY';
  }
  return method;
}

/**
 * Outgoing HTTP calls in code: `fetch(url, { method })`, `axios.post(url)`,
 * Python `requests.get(url)`, Java `RestTemplate` and `WebClient`. A call to an
 * absolute outside host is left to the URL detection; the rest keeps its method,
 * its path and the variable its base comes from.
 */
function httpCalls(path: string, text: string): { name: string; base: string | null; index: number }[] {
  const out: { name: string; base: string | null; index: number }[] = [];
  const constants = envConstants(text);
  const add = (method: string, literal: string, index: number) => {
    const raw = literal.replace(/^f?['"`]|['"`]$/g, '');
    const origin = /^[a-z]+:\/\/([^/:]+)/i.exec(raw)?.[1];
    if (origin && origin !== 'localhost' && origin !== '127.0.0.1') return;
    const lead = /^\$\{([^}]*)\}/.exec(raw) ?? /^\{([A-Za-z_]\w*)\}/.exec(raw);
    const rest = lead ? raw.slice(lead[0].length) : raw.replace(/^[a-z]+:\/\/[^/]+/i, '');
    if (!rest.startsWith('/')) return;
    out.push({ name: `${method.toUpperCase()} ${normalizePath(rest)}`, base: lead ? baseVariable(lead[1]!, constants) : null, index });
  };
  if (/\.(m?[jt]sx?|cjs)$/.test(path)) {
    for (const m of text.matchAll(/\bfetch\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*/g)) {
      add(fetchMethod(text.slice(m.index + m[0].length)), m[1]!, m.index);
    }
    for (const m of text.matchAll(/\b(?:axios|got|ky|superagent|httpClient|this\.http|\$http)\.(get|post|put|patch|delete)\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) add(m[1]!, m[2]!, m.index);
  }
  if (/\.py$/.test(path)) {
    for (const m of text.matchAll(/\b(?:requests|httpx|session|client)\.(get|post|put|patch|delete)\(\s*(f?'[^']*'|f?"[^"]*")/g)) add(m[1]!, m[2]!, m.index);
  }
  if (/\.(java|kt)$/.test(path)) {
    const verbs: Record<string, string> = { getForObject: 'GET', getForEntity: 'GET', postForObject: 'POST', postForEntity: 'POST', put: 'PUT', delete: 'DELETE', patchForObject: 'PATCH' };
    for (const m of text.matchAll(/\b\w*[Rr]estTemplate\.(getForObject|getForEntity|postForObject|postForEntity|put|delete|patchForObject)\(\s*("[^"]*")/g)) add(verbs[m[1]!]!, m[2]!, m.index);
    for (const m of text.matchAll(/\.(get|post|put|patch|delete)\(\)\s*\.uri\(\s*("[^"]*")/g)) add(m[1]!, m[2]!, m.index);
  }
  return out;
}

const DOC_HOSTS = /(^|\.)(w3\.org|schemas?\.[\w.]+|json-schema\.org|xml\.org|xmlsoap\.org|example\.(com|org|net)|apache\.org|opensource\.org|mozilla\.org|spdx\.org|purl\.org|github\.com|githubusercontent\.com|npmjs\.(com|org)|nodejs\.org|sap\.com\/(protocols)?|openui5\.org|ui5\.sap\.com|maven\.apache\.org|gradle\.org|docker\.com|goo\.gl|bit\.ly|semver\.org|shields\.io|creativecommons\.org|eslint\.org|typescriptlang\.org|reactjs\.org|vuejs\.org|angular\.io|python\.org|pypi\.org|readthedocs\.io|stackoverflow\.com|wikipedia\.org|google\.com|microsoft\.com\/schemas|xmlns\.\w+)$/i;

export function detectConsumes(inv: Inventory): Iface[] {
  const out = new IfaceSet();
  // CAP: cds.requires in package.json or .cdsrc.json.
  for (const f of filesOf(inv, (f) => /(^|\/)(package\.json|\.cdsrc(-private)?\.json)$/.test(f.path) && f.kind === 'manifest')) {
    if (/\.cdsrc-private\.json$/.test(f.path)) continue; // private bindings: never read
    const text = textOf(inv, f.path);
    const json = text ? parseJson(text) : null;
    if (!text || !json) continue;
    const requires = rec(posix.basename(f.path) === 'package.json' ? rec(json.cds).requires : json.requires);
    for (const [name, value] of Object.entries(requires)) {
      const cfg = rec(value);
      const kind = String(cfg.kind ?? (typeof value === 'string' ? value : '') ?? '');
      const destination = rec(cfg.credentials).destination;
      const url = rec(cfg.credentials).url;
      const ev = evidenceFor(f.path, text, `"${name}"`);
      if (/^(hana|sql|sqlite|postgres|db|better-sqlite|legacy-sqlite)/i.test(kind) || name === 'db') out.add('database', name, ev, kind || undefined);
      else if (/xsuaa|jwt|ias|auth|mocked|basic|dummy/i.test(kind) || name === 'auth') out.add('auth', name, ev, kind || undefined);
      else if (/messag|kafka|redis|event|amqp/i.test(kind) || name === 'messaging') out.add('messaging', name, ev, kind || undefined);
      else if (/odata|rest|hcql/i.test(kind) || destination || url || cfg.model) {
        out.add('external-service', name, ev, [kind, destination ? `destination ${String(destination)}` : '', typeof url === 'string' ? `url ${hostOf(url) ?? url}` : ''].filter(Boolean).join(', ') || undefined);
        if (typeof destination === 'string') out.add('destination', destination, ev, `for ${name}`);
      } else if (!/^(\[|multitenancy|toggles|extensibility|cds\.xt)/.test(name)) out.add('service-binding', name, ev, kind || undefined);
    }
  }
  // MTA: what each module requires, and the BTP services it binds.
  for (const f of filesOf(inv, (f) => /(^|\/)mta\.ya?ml$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const doc = safeYaml(text);
    for (const r of Array.isArray(doc.resources) ? doc.resources : []) {
      const res = rec(r);
      const name = typeof res.name === 'string' ? res.name : null;
      if (!name) continue;
      const params = rec(res.parameters);
      const service = typeof params.service === 'string' ? params.service : null;
      const plan = typeof params['service-plan'] === 'string' ? params['service-plan'] : null;
      // The resource's own declaration, not a module's `requires` of it.
      const resourcesAt = Math.max(0, text.search(/^resources:/m));
      const declared = text.slice(resourcesAt).search(new RegExp(`-\\s*name:\\s*${escapeRe(name)}\\b`));
      out.add('service-binding', name, declared >= 0 ? evidenceAt(f.path, text, resourcesAt + declared) : evidenceFor(f.path, text, name), [service && `service ${service}`, plan && `plan ${plan}`, typeof res.type === 'string' ? res.type : ''].filter(Boolean).join(', '));
      const destinations = rec(rec(rec(params.config).init_data).instance).destinations ?? rec(rec(rec(params.config).init_data).subaccount).destinations;
      for (const d of Array.isArray(destinations) ? destinations : []) {
        const dn = rec(d).Name;
        if (typeof dn === 'string') out.add('destination', dn, evidenceFor(f.path, text, new RegExp(`Name:\\s*${escapeRe(dn)}\\b`)), typeof rec(d).URL === 'string' ? `url ${hostOf(String(rec(d).URL)) ?? ''}` : undefined);
      }
    }
  }
  // Approuter routes and UI5 data sources.
  for (const f of filesOf(inv, (f) => /(^|\/)xs-app\.json$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    for (const route of Array.isArray(parseJson(text)?.routes) ? (parseJson(text)!.routes as unknown[]) : []) {
      const d = rec(route).destination;
      if (typeof d === 'string') out.add('destination', d, evidenceFor(f.path, text, `"${d}"`), `route ${String(rec(route).source ?? '')}`);
    }
  }
  for (const f of filesOf(inv, (f) => /(^|\/)webapp\/manifest\.json$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const sources = rec(rec(rec(parseJson(text))['sap.app']).dataSources);
    for (const [name, ds] of Object.entries(sources)) {
      const uri = rec(ds).uri;
      if (typeof uri === 'string') out.add('odata', uri, evidenceFor(f.path, text, `"${name}"`), `data source ${name} (${String(rec(ds).type ?? 'OData')})`);
    }
  }
  // Calls declared in code.
  for (const f of filesOf(inv, isCode)) {
    const text = textOf(inv, f.path);
    if (!text) continue;
    for (const m of text.matchAll(/destinationName\s*:\s*['"]([^'"]+)['"]/g)) out.add('destination', m[1]!, evidenceAt(f.path, text, m.index), 'SAP Cloud SDK');
    for (const m of text.matchAll(/cds\.connect\.to\(\s*['"]([^'"]+)['"]/g)) if (m[1] !== 'db') out.add('external-service', m[1]!, evidenceAt(f.path, text, m.index), 'cds.connect.to');
    for (const m of text.matchAll(/@FeignClient\(\s*(?:name|value)\s*=\s*"([^"]+)"/g)) out.add('external-service', m[1]!, evidenceAt(f.path, text, m.index), 'Feign client');
    for (const m of text.matchAll(/(?:messaging|broker)\.on\(\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'subscribed');
    for (const m of text.matchAll(/\.subscribe\(\s*\{\s*topics?\s*:\s*\[?\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'subscribed');
    for (const m of text.matchAll(/\.consume\(\s*['"]([\w./:-]+)['"]/g)) out.add('event', m[1]!, evidenceAt(f.path, text, m.index), 'subscribed');
    for (const call of httpCalls(f.path, text)) out.add('http-call', call.name, evidenceAt(f.path, text, call.index), call.base ? `base ${call.base}` : undefined);
  }
  // Literal URLs in code and configuration: hosts only.
  for (const f of filesOf(inv, (f) => isCode(f) || f.kind === 'config' || f.kind === 'manifest')) {
    if (/\.env$|default-env\.json$/.test(f.path)) continue;
    const text = textOf(inv, f.path);
    if (!text) continue;
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|127\.0\.0\.1)(:\d+)?(\/[^\s'"`)<>]*)?/gi)) {
      const host = m[1]!.toLowerCase();
      if (DOC_HOSTS.test(host)) continue;
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (/xmlns[:=\w]*"?$/.test(before)) continue;
      out.add('url', host === 'localhost' || host === '127.0.0.1' ? `${host}${m[2] ?? ''}` : host, evidenceAt(f.path, text, m.index), host === 'localhost' || host === '127.0.0.1' ? 'local' : undefined);
    }
  }
  // Containers and services started next to the application.
  for (const f of filesOf(inv, (f) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    for (const [name, svc] of Object.entries(rec(safeYaml(text).services))) {
      const image = rec(svc).image;
      out.add('container', name, evidenceFor(f.path, text, new RegExp(`^\\s{2}${escapeRe(name)}:`, 'm')), typeof image === 'string' ? `image ${image}` : 'built locally');
    }
  }
  for (const f of filesOf(inv, (f) => /(^|\/)manifest(-[\w-]+)?\.ya?ml$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    for (const app of Array.isArray(safeYaml(text).applications) ? (safeYaml(text).applications as unknown[]) : []) {
      for (const s of Array.isArray(rec(app).services) ? (rec(app).services as unknown[]) : []) {
        if (typeof s === 'string') out.add('service-binding', s, evidenceFor(f.path, text, s), 'Cloud Foundry service');
      }
    }
  }
  // Scoped packages that are not well-known public scopes may be internal libraries.
  for (const f of filesOf(inv, (f) => posix.basename(f.path) === 'package.json' && f.kind === 'manifest')) {
    const text = textOf(inv, f.path);
    const json = text ? parseJson(text) : null;
    if (!text || !json) continue;
    for (const dep of Object.keys({ ...rec(json.dependencies), ...rec(json.devDependencies) })) {
      const scope = /^@([\w.-]+)\//.exec(dep)?.[1];
      if (scope && !PUBLIC_SCOPES.has(scope)) out.add('package', dep, evidenceFor(f.path, text, `"${dep}"`), 'scoped dependency (maybe an internal library)');
    }
  }
  return out.list();
}

const PUBLIC_SCOPES = new Set(['sap', 'sap-cloud-sdk', 'sap-ux', 'cap-js', 'cap-js-community', 'ui5', 'openui5', 'types', 'babel', 'angular', 'nestjs', 'testing-library', 'vitejs', 'vue', 'reduxjs', 'tanstack', 'mui', 'emotion', 'opentelemetry', 'aws-sdk', 'azure', 'google-cloud', 'typescript-eslint', 'eslint', 'jest', 'playwright', 'wdio', 'prisma', 'apollo', 'graphql-tools', 'fastify', 'hapi', 'sentry', 'storybook', 'swc', 'rollup', 'esbuild', 'commitlint', 'semantic-release', 'changesets', 'octokit', 'microsoft', 'fortawesome', 'headlessui', 'heroicons', 'radix-ui', 'tailwindcss', 'vitest', 'clack', 'sindresorhus', 'stylistic', 'nx', 'nrwl', 'docusaurus', 'mdx-js', 'popperjs', 'faker-js', 'anthropic-ai', 'modelcontextprotocol', 'grpc', 'nestjs-modules', 'aws-cdk', 'tsconfig', 'cspotcode', 'jridgewell', 'actions', 'vercel', 'next', 'remix-run', 'trpc', 'tiptap', 'lezer', 'codemirror', 'ngrx', 'ionic', 'capacitor', 'capacitor-community', 'react-native', 'expo', 'bufbuild', 'fontsource', 'iconify', 'unocss', 'nuxt', 'nuxtjs', 'svelte', 'sveltejs', 'astrojs', 'mdi', 'mantine', 'chakra-ui']);

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeYaml(text: string): Record<string, unknown> {
  try {
    const value = YAML.parse(text, { strict: false, uniqueKeys: false, logLevel: 'silent' }) as unknown;
    return rec(value);
  } catch {
    return {};
  }
}

/* --------------------------------------------------------- configuration */

const SENSITIVE = /(SECRET|PASSWORD|PASSWD|PWD|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|CLIENT_?SECRET|AUTH)/i;

export function detectEnv(inv: Inventory): EnvVar[] {
  const vars = new Map<string, { evidence: Evidence[]; defaulted: boolean }>();
  const add = (name: string, ev: Evidence, defaulted: boolean) => {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name) || /^(PATH|HOME|PWD|USER|SHELL|TERM|LANG|TZ|HOSTNAME)$/.test(name) || (!vars.has(name) && vars.size >= 400)) return;
    const found = vars.get(name) ?? { evidence: [], defaulted: false };
    if (found.evidence.length < 4) found.evidence.push(ev);
    found.defaulted ||= defaulted;
    vars.set(name, found);
  };
  // [files, pattern, name groups, group that signals a default value]
  const patterns: readonly (readonly [RegExp, RegExp, readonly number[], number | null])[] = [
    [/\.(m?[jt]sx?|cjs)$/, /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])(\s*(?:\|\||\?\?))?/g, [1, 2], 3],
    [/\.py$/, /os\.(?:environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]+)['"]\s*(,)?|os\.environ\[['"]([A-Z][A-Z0-9_]+)['"]\]/g, [1, 3], 2],
    [/\.(java|kt)$/, /System\.getenv\(\s*"([A-Z][A-Z0-9_]+)"\s*\)/g, [1], null],
    [/\.go$/, /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]+)"/g, [1], null],
    [/\.cs$/, /GetEnvironmentVariable\(\s*"([A-Z][A-Z0-9_]+)"/g, [1], null],
    [/\.(ya?ml|sh|bash|env|properties|toml)$|dockerfile|jenkinsfile/i, /\$\{([A-Z][A-Z0-9_]+)(:?-[^}]*)?\}/g, [1], 2],
  ];
  for (const f of inv.files) {
    if (f.kind === 'vendored' || f.kind === 'generated' || f.kind === 'test') continue;
    const text = textOf(inv, f.path);
    if (!text) continue;
    for (const [fileRe, re, groups, defaultGroup] of patterns) {
      if (!fileRe.test(f.path)) continue;
      for (const m of text.matchAll(re)) {
        const name = groups.map((g) => m[g]).find(Boolean);
        if (name) add(name, evidenceAt(f.path, text, m.index), defaultGroup !== null && Boolean(m[defaultGroup]));
      }
    }
    const base = posix.basename(f.path);
    if (/^\.env\.(example|sample|template|dist|defaults)$/i.test(base)) {
      for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=(.*)$/gm)) add(m[1]!, { file: f.path, line: lineAt(text, m.index), text: `${m[1]}=…` }, m[2]!.trim().length > 0);
    }
    if (/^dockerfile/i.test(base)) for (const m of text.matchAll(/^\s*ENV\s+([A-Z][A-Z0-9_]+)[\s=]/gm)) add(m[1]!, evidenceAt(f.path, text, m.index), true);
  }
  return [...vars].map(([name, v]) => ({ name, evidence: v.evidence, defaulted: v.defaulted, sensitive: SENSITIVE.test(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

const ENV_WORD = /^(dev|develop|development|test|testing|qa|int|integration|uat|acc|acceptance|preprod|pre-prod|staging|stage|prod|production|sandbox|demo|local|hybrid|perf|canary|eu10|us10)$/i;

export function detectEnvironments(inv: Inventory): Environment[] {
  const found = new Map<string, Evidence[]>();
  const add = (raw: string, ev: Evidence) => {
    const name = raw.toLowerCase();
    if (!ENV_WORD.test(name)) return;
    const list = found.get(name) ?? [];
    if (list.length < 3) list.push(ev);
    found.set(name, list);
  };
  for (const f of inv.files) {
    const base = posix.basename(f.path);
    const named = /^(.+)\.mtaext$/i.exec(base)?.[1] ?? /^application-([\w-]+)\.(ya?ml|properties)$/i.exec(base)?.[1] ?? /^values-([\w-]+)\.ya?ml$/i.exec(base)?.[1] ?? /^\.env\.([\w-]+)$/i.exec(base)?.[1] ?? /^manifest-([\w-]+)\.ya?ml$/i.exec(base)?.[1];
    if (named) add(named, { file: f.path, line: 1, text: base });
    if (f.kind !== 'ci' && f.kind !== 'manifest' && f.kind !== 'config') continue;
    const text = textOf(inv, f.path);
    if (!text) continue;
    for (const m of text.matchAll(/\b(?:environment|env|space|profile|stage|target)\s*[:=]\s*['"]?([\w-]+)/gi)) add(m[1]!, evidenceAt(f.path, text, m.index));
    for (const m of text.matchAll(/"\[([\w-]+)\]"\s*:/g)) add(m[1]!, evidenceAt(f.path, text, m.index));
    for (const m of text.matchAll(/cf target[^\n]*-s\s+([\w-]+)/g)) add(m[1]!, evidenceAt(f.path, text, m.index));
  }
  return [...found].map(([name, evidence]) => ({ name, evidence })).sort((a, b) => ENV_ORDER(a.name) - ENV_ORDER(b.name));
}

function ENV_ORDER(name: string): number {
  const order = ['local', 'hybrid', 'dev', 'develop', 'development', 'sandbox', 'int', 'integration', 'test', 'testing', 'qa', 'uat', 'acc', 'acceptance', 'perf', 'staging', 'stage', 'preprod', 'pre-prod', 'canary', 'prod', 'production'];
  const i = order.indexOf(name);
  return i === -1 ? 99 : i;
}

/* ------------------------------------------------------------- data model */

export function detectEntities(inv: Inventory): Entity[] {
  const out: Entity[] = [];
  for (const f of filesOf(inv, (f) => /\.cds$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const namespace = /^\s*namespace\s+([\w.]+)\s*;/m.exec(text)?.[1];
    for (const m of text.matchAll(/\bentity\s+(\w+)(?:\s*:\s*[\w.,\s]+?)?\s*\{/g)) {
      const body = braceBody(text, m.index + m[0].length - 1);
      const relations = [...body.matchAll(/\b(Association|Composition)\s+(?:to|of)\s+(?:many\s+|one\s+)?([\w.]+)/g)]
        .map((r) => ({ to: r[2]!.split('.').pop()!, kind: r[1] === 'Composition' ? 'composition' as const : 'association' as const }));
      out.push({ name: m[1]!, ...(namespace ? { namespace } : {}), kind: 'cds', evidence: evidenceAt(f.path, text, m.index), relations });
    }
  }
  for (const f of filesOf(inv, (f) => /\.(asddls|ddls)$/i.test(f.path) || /\.ddls\.asddls$/i.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/define\s+(?:root\s+)?(?:view\s+entity|view|table|entity)\s+(\w+)/gi)) {
      const relations = [...text.matchAll(/\b(association|composition)\b[^;]*?\b(?:to|of)\s+(?:parent\s+)?(\w+)/gi)].map((r) => ({ to: r[2]!, kind: /compo/i.test(r[1]!) ? 'composition' as const : 'association' as const }));
      out.push({ name: m[1]!, kind: 'abap', evidence: evidenceAt(f.path, text, m.index), relations });
    }
  }
  for (const f of filesOf(inv, (f) => /\.sql$/i.test(f.path) && f.kind !== 'test')) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/create\s+(?:column\s+)?table\s+(?:if\s+not\s+exists\s+)?["`[]?([\w.]+)/gi)) {
      out.push({ name: m[1]!.split('.').pop()!, kind: 'sql', evidence: evidenceAt(f.path, text, m.index), relations: [] });
    }
  }
  for (const f of filesOf(inv, (f) => /\.(java|kt)$/.test(f.path) && f.kind !== 'test')) {
    const text = textOf(inv, f.path) ?? '';
    if (!/@Entity\b/.test(text)) continue;
    const cls = /@Entity[\s\S]{0,400}?\bclass\s+(\w+)/.exec(text);
    if (!cls) continue;
    const relations = [...text.matchAll(/@(OneToMany|ManyToOne|OneToOne|ManyToMany)[\s\S]{0,200}?(?:private|protected|public)?\s*(?:List|Set|Collection)?<?(\w+)>?\s+\w+\s*[;=]/g)]
      .map((r) => ({ to: r[2]!, kind: 'association' as const }));
    out.push({ name: cls[1]!, kind: 'jpa', evidence: evidenceAt(f.path, text, cls.index), relations });
  }
  for (const f of filesOf(inv, (f) => /\.prisma$/.test(f.path))) {
    const text = textOf(inv, f.path) ?? '';
    const models = [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
    for (const m of text.matchAll(/^model\s+(\w+)\s*\{/gm)) {
      const body = braceBody(text, m.index + m[0].length - 1);
      const relations = [...body.matchAll(/^\s*\w+\s+(\w+)(\[\])?\??/gm)].filter((r) => models.includes(r[1]!)).map((r) => ({ to: r[1]!, kind: 'association' as const }));
      out.push({ name: m[1]!, kind: 'prisma', evidence: evidenceAt(f.path, text, m.index), relations });
    }
  }
  for (const f of filesOf(inv, (f) => /\.py$/.test(f.path) && f.kind !== 'test')) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/^class\s+(\w+)\((?:models\.Model|Base|db\.Model)\)/gm)) out.push({ name: m[1]!, kind: 'django', evidence: evidenceAt(f.path, text, m.index), relations: [] });
  }
  for (const f of filesOf(inv, (f) => /\.(m?[jt]s)$/.test(f.path) && f.kind !== 'test')) {
    const text = textOf(inv, f.path) ?? '';
    for (const m of text.matchAll(/mongoose\.model\(\s*['"](\w+)['"]/g)) out.push({ name: m[1]!, kind: 'mongoose', evidence: evidenceAt(f.path, text, m.index), relations: [] });
  }
  return out.slice(0, 400);
}

/** Text between the brace at `open` and its match (bounded). */
function braceBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length && i < open + 40_000; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1, open + 4000);
}
