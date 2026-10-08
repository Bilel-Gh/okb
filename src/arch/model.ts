import type { Iface, RepoMap } from '../repo/types.js';
import { normalizePath } from './paths.js';

export { normalizePath } from './paths.js';

/**
 * The model of a system, computed from the repository scans without AI
 * (roadmap §4): what each repository exposes and calls, linked across
 * repositories by matching — a call `POST /orders` here and the route
 * `POST /orders` there, a topic published here and listened to there, a
 * package published here and used there. Every link carries its evidence on
 * both sides and a confidence; a call nobody serves becomes a question, never
 * an invented line. Diagrams (src/arch/views.ts) are drawn from this model.
 */
/** `system` stands for all the repositories at once, in the context view. */
export type NodeKind = 'repo' | 'datastore' | 'external' | 'system';
export type ArchNode = {
  readonly id: string;
  readonly kind: NodeKind;
  /** A name a person understands: « Service des commandes ». */
  readonly name: string;
  /** The technical id, shown small: `orders-api`. */
  readonly tech: string;
  readonly repo?: string;
};

export type LinkKind = 'http' | 'event' | 'package' | 'service' | 'data' | 'external';
export type Confidence = 'sure' | 'probable' | 'to-confirm';
export type Evidence = { readonly repo: string; readonly file: string; readonly line: number };
export type ArchLink = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: LinkKind;
  readonly confidence: Confidence;
  /** What travels on the link: `POST /orders`, `order.created`, `@acme/money`. */
  readonly calls: readonly { readonly what: string; readonly line: number }[];
  readonly evidence: readonly Evidence[];
  /** A verb for the arrow, in the call's direction: « crée orders ». */
  readonly verb: string;
};
/** A call OKB could not link; `named` is the repository its base variable names, when there is one. */
export type Question = { readonly repo: string; readonly what: string; readonly evidence: Evidence; readonly named?: string };
export type SystemModel = { readonly nodes: readonly ArchNode[]; readonly links: readonly ArchLink[]; readonly questions: readonly Question[] };

const DATASTORES = new Set(['postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlite', 'hana', 'oracle', 'mssql', 'elasticsearch', 'dynamodb']);
const DATASTORE_NAMES: Readonly<Record<string, string>> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongodb: 'MongoDB', redis: 'Redis', sqlite: 'SQLite', hana: 'SAP HANA', oracle: 'Oracle', mssql: 'SQL Server', elasticsearch: 'Elasticsearch', dynamodb: 'DynamoDB' };

/** The name people use for a repository: its README title, else the first words of its description, else its id. */
export function businessName(map: RepoMap): string {
  const readme = map.docs.find((d) => /(^|\/)readme(\.\w+)?$/i.test(d.path) && !d.path.includes('/'))?.title ?? map.docs.find((d) => /(^|\/)readme/i.test(d.path))?.title;
  const clean = (s: string) => s.replace(/[#*_`]/g, '').trim();
  if (readme && clean(readme) && clean(readme).toLowerCase() !== map.repo.name.toLowerCase()) return clean(readme);
  const desc = map.repo.description?.split(/[:.;(]/)[0]?.trim();
  if (desc && desc.length >= 3 && desc.length <= 60) return desc;
  return map.repo.name;
}

const ev = (map: RepoMap, i: Iface): Evidence => ({ repo: map.repo.name, file: i.evidence.file, line: i.evidence.line });

/** « crée orders », « reads orders »: the method as a verb, the last fixed segment as the thing. */
export function verbOf(method: string, path: string, lang: 'fr' | 'en'): string {
  const thing = normalizePath(path).split('/').filter((s) => s && s !== '{}').pop() ?? '';
  const fr: Record<string, string> = { GET: 'lit', POST: 'crée', PUT: 'remplace', PATCH: 'modifie', DELETE: 'supprime', ANY: 'appelle' };
  const en: Record<string, string> = { GET: 'reads', POST: 'creates', PUT: 'replaces', PATCH: 'updates', DELETE: 'deletes', ANY: 'calls' };
  const v = (lang === 'fr' ? fr : en)[method] ?? (lang === 'fr' ? 'appelle' : 'calls');
  return thing ? `${v} ${thing}` : v;
}

const splitCall = (name: string) => { const [method = 'ANY', ...rest] = name.split(' '); return { method, path: normalizePath(rest.join(' ')) }; };

/** Tokens of an env variable or a repo name: `VITE_ORDERS_URL` → orders; `orders-api` → orders, api. */
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !['vite', 'react', 'app', 'next', 'public', 'url', 'uri', 'base', 'host', 'endpoint', 'api', 'service', 'svc', 'http', 'https'].includes(t)));
}

export function buildModel(maps: readonly RepoMap[], options: { lang?: 'fr' | 'en' } = {}): SystemModel {
  const lang = options.lang ?? 'fr';
  const nodes: ArchNode[] = [];
  const links: ArchLink[] = [];
  const questions: Question[] = [];
  const repoId = (m: RepoMap) => `repo:${m.repo.name}`;
  for (const m of maps) nodes.push({ id: repoId(m), kind: 'repo', name: businessName(m), tech: m.repo.name, repo: m.repo.name });
  const addNode = (n: ArchNode) => { if (!nodes.some((x) => x.id === n.id)) nodes.push(n); };
  const addLink = (l: Omit<ArchLink, 'id'>) => {
    const same = links.find((x) => x.from === l.from && x.to === l.to && x.kind === l.kind);
    if (same) {
      const merged: ArchLink = {
        ...same,
        calls: [...same.calls, ...l.calls.filter((c) => !same.calls.some((s) => s.what === c.what))],
        evidence: [...same.evidence, ...l.evidence.filter((e) => !same.evidence.some((s) => s.repo === e.repo && s.file === e.file && s.line === e.line))],
        confidence: same.confidence === 'sure' || l.confidence === 'sure' ? 'sure' : same.confidence,
      };
      links[links.indexOf(same)] = merged;
    } else links.push({ ...l, id: `${l.kind}:${l.from}>${l.to}` });
  };

  const routes = new Map<string, { map: RepoMap; route: Iface }[]>();
  for (const m of maps) {
    for (const p of m.provides.filter((x) => x.kind === 'http-route')) {
      const { method, path } = splitCall(p.name);
      for (const key of [`${method} ${path}`, `ANY ${path}`]) routes.set(key, [...(routes.get(key) ?? []), { map: m, route: p }]);
    }
  }
  const hasRoutes = (m: RepoMap) => m.provides.some((p) => p.kind === 'http-route');

  for (const a of maps) {
    // HTTP: a call matched to a route of another repository, method and path; else by the base variable's name.
    for (const c of a.consumes.filter((x) => x.kind === 'http-call')) {
      const { method, path } = splitCall(c.name);
      const exact = (routes.get(`${method} ${path}`) ?? []).filter((r) => r.map !== a);
      const anyMethod = exact.length ? [] : (routes.get(`ANY ${path}`) ?? []).filter((r) => r.map !== a);
      const sameRoute = exact.length ? exact : anyMethod;
      const base = c.detail?.startsWith('base ') ? c.detail.slice(5) : null;
      if (sameRoute.length) {
        // Several repositories serve the same path: the base variable decides, else each is only probable.
        const named = base ? sameRoute.filter((r) => [...tokens(base)].some((t) => tokens(r.map.repo.name).has(t))) : [];
        const pick = named.length === 1 ? named : sameRoute;
        for (const r of pick) {
          addLink({ from: repoId(a), to: repoId(r.map), kind: 'http', confidence: pick.length === 1 && exact.length ? 'sure' : 'probable',
            calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), ev(r.map, r.route)], verb: verbOf(method, path, lang) });
        }
        continue;
      }
      // No route matches. A base variable naming a repository whose routes OKB cannot see: probable; otherwise a question.
      const target = base ? maps.find((b) => b !== a && !hasRoutes(b) && [...tokens(base)].some((t) => tokens(b.repo.name).has(t))) : undefined;
      if (target) {
        addLink({ from: repoId(a), to: repoId(target), kind: 'http', confidence: 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c)], verb: verbOf(method, path, lang) });
      } else {
        const named = base ? maps.find((b) => b !== a && [...tokens(base)].some((t) => tokens(b.repo.name).has(t))) : undefined;
        questions.push({ repo: a.repo.name, what: c.name, evidence: ev(a, c), ...(named ? { named: named.repo.name } : {}) });
      }
    }
    // Events: published here, listened to there (publisher → listener).
    for (const c of a.consumes.filter((x) => x.kind === 'event')) {
      for (const b of maps) {
        if (b === a) continue;
        const p = b.provides.find((x) => x.kind === 'event' && x.name === c.name);
        if (p) addLink({ from: repoId(b), to: repoId(a), kind: 'event', confidence: 'sure', calls: [{ what: c.name, line: p.evidence.line }], evidence: [ev(b, p), ev(a, c)], verb: `${lang === 'fr' ? 'publie' : 'publishes'} ${c.name}` });
      }
    }
    // Packages: used here, published there.
    for (const c of a.consumes.filter((x) => x.kind === 'package')) {
      const b = maps.find((x) => x !== a && (x.published ?? []).some((p) => p.name === c.name));
      if (b) {
        const pub = b.published.find((p) => p.name === c.name)!;
        addLink({ from: repoId(a), to: repoId(b), kind: 'package', confidence: 'sure', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), { repo: b.repo.name, file: pub.evidence.file, line: pub.evidence.line }], verb: `${lang === 'fr' ? 'utilise' : 'uses'} ${c.name}` });
      }
    }
    // Named services (destinations, external services, bindings) provided by another repository.
    for (const c of a.consumes.filter((x) => ['external-service', 'destination', 'service-binding', 'odata'].includes(x.kind))) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const b of maps) {
        if (b === a) continue;
        const p = b.provides.find((x) => ['cds-service', 'service-binding', 'odata', 'openapi', 'grpc', 'ui-app'].includes(x.kind) && norm(x.name) === norm(c.name));
        if (p) addLink({ from: repoId(a), to: repoId(b), kind: 'service', confidence: 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), ev(b, p)], verb: `${lang === 'fr' ? 'appelle' : 'calls'} ${c.name}` });
      }
    }
    // Datastores: from the stack and declared databases.
    const stores = new Set([...a.stack.map((s) => s.id).filter((id) => DATASTORES.has(id)), ...a.consumes.filter((c) => c.kind === 'database').map((c) => (/postgres|hana|sqlite|mysql/i.exec(c.detail ?? c.name)?.[0] ?? c.name).toLowerCase())]);
    for (const s of stores) {
      const id = `store:${a.repo.name}:${s}`;
      addNode({ id, kind: 'datastore', name: DATASTORE_NAMES[s] ?? s, tech: s, repo: a.repo.name });
      const stackItem = a.stack.find((x) => x.id === s);
      const e = stackItem?.evidence?.[0] ? { repo: a.repo.name, file: stackItem.evidence[0].file, line: stackItem.evidence[0].line } : null;
      addLink({ from: repoId(a), to: id, kind: 'data', confidence: 'sure', calls: [], evidence: e ? [e] : [], verb: lang === 'fr' ? 'stocke ses données' : 'stores its data' });
    }
    // Outside systems called by their host.
    for (const c of a.consumes.filter((x) => x.kind === 'url' && x.detail !== 'local')) {
      const id = `ext:${c.name}`;
      addNode({ id, kind: 'external', name: c.name, tech: c.name });
      addLink({ from: repoId(a), to: id, kind: 'external', confidence: 'sure', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c)], verb: lang === 'fr' ? 'appelle' : 'calls' });
    }
  }
  // Read by repository, then calls before events, libraries, data and outside systems.
  const rank: Record<LinkKind, number> = { http: 0, service: 1, event: 2, package: 3, data: 4, external: 5 };
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;
  links.sort((x, y) => name(x.from).localeCompare(name(y.from)) || rank[x.kind] - rank[y.kind] || name(x.to).localeCompare(name(y.to)));
  return { nodes, links, questions };
}
