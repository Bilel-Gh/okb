import type { Iface, RepoMap } from '../repo/types.js';
import { classifyUrl, ON_MAP, type UrlRole } from '../repo/url-kinds.js';
import { normalizePath } from './paths.js';

/** Methods that stand for any method: a route declared this way answers every call to its path. */
const GENERIC_METHODS = new Set(['ANY', 'ALL', 'USE']);

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
/**
 * How OKB knows a link (F2.4-16, D72): both sides declare it and agree
 * (`proved`), one side calls explicitly (`declared`), a name, an address or a
 * variable looks alike (`supposed`), or the person said so (`confirmed`).
 * `confidence` stays for the views and the diagram check.
 */
export type Certainty = 'proved' | 'declared' | 'supposed' | 'confirmed';
export type LinkOrigin = 'scan' | 'agent' | 'person';
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
  readonly certainty?: Certainty;
  /** Why OKB draws it, in one sentence: « same path POST /orders on both sides ». */
  readonly basis?: string;
  readonly origin?: LinkOrigin;
};
/** An address found in a repository that is not a relation (F2.4-15): a registry, the Git host, a wiki link… */
export type OffMap = { readonly repo: string; readonly host: string; readonly role: UrlRole; readonly evidence: Evidence };
/** A call OKB could not link; `named` is the repository its base variable names, when there is one. */
export type Question = { readonly repo: string; readonly what: string; readonly evidence: Evidence; readonly named?: string };
export type SystemModel = {
  readonly nodes: readonly ArchNode[];
  readonly links: readonly ArchLink[];
  readonly questions: readonly Question[];
  /** What the repositories write that is not on the map, by role (F2.4-15). */
  readonly offMap?: readonly OffMap[];
  /** Links the person excluded, kept to be put back (F2.4-17). */
  readonly excluded?: readonly (ArchLink & { readonly reason: string; readonly at: string })[];
  /** Corrections that no longer match anything since the last scans (F2.4-17). */
  readonly stale?: readonly { readonly key: string; readonly action: string; readonly at: string }[];
  /** What an agent said differently from the person's correction, for the person to settle (F2.4-17). */
  readonly conflicts?: readonly { readonly key: string; readonly action: string; readonly target: string | null; readonly reason: string; readonly origin: string; readonly at: string }[];
};

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
  return new Set(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !['vite', 'react', 'app', 'next', 'public', 'url', 'uri', 'base', 'host', 'endpoint', 'api', 'service', 'svc', 'http', 'https'].includes(t)));
}

/** The role of an address: the scan's, else read from its evidence line (a map from before lot D), unless a rule says otherwise. */
function roleOf(i: Iface, rules: ReadonlyMap<string, UrlRole> | undefined): UrlRole {
  const ruled = rules?.get(i.name.toLowerCase());
  if (ruled) return ruled;
  if (i.role) return i.role;
  const text = i.evidence.text ?? '';
  const at = text.toLowerCase().indexOf(`://${i.name.toLowerCase()}`);
  return classifyUrl({ file: i.evidence.file, text, index: Math.max(0, at - 5), host: i.name });
}

const GENERIC = new Set(['www', 'apps', 'app', 'cfapps', 'prod', 'dev', 'test', 'qa', 'int', 'internal', 'corp', 'srv', 'dest', 'destination', 'odata', 'v1', 'v2', 'v3', 'eu10', 'us10', 'hana', 'ondemand', 'cloud']);
/** The one other repository whose name a service, destination or address resembles, if exactly one does. */
function resembles(maps: readonly RepoMap[], self: RepoMap, name: string): RepoMap | null {
  const want = [...tokens(name)].filter((t) => !GENERIC.has(t) && t.length > 2);
  if (!want.length) return null;
  const hits = maps.filter((b) => b !== self && [...tokens(b.repo.name)].some((t) => want.includes(t)));
  return hits.length === 1 ? hits[0]! : null;
}
const RANK: Record<Certainty, number> = { supposed: 0, declared: 1, proved: 2, confirmed: 3 };
const firstLabel = (host: string) => host.split('.')[0] ?? host;

export function buildModel(maps: readonly RepoMap[], options: { lang?: 'fr' | 'en'; urlRules?: ReadonlyMap<string, UrlRole> } = {}): SystemModel {
  const lang = options.lang ?? 'fr';
  const nodes: ArchNode[] = [];
  const links: ArchLink[] = [];
  const questions: Question[] = [];
  const offMap: OffMap[] = [];
  const fr = lang === 'fr';
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
        // Aggregation must preserve the weakest evidence, including a call with unknown method.
        confidence: same.confidence === 'to-confirm' || l.confidence === 'to-confirm' ? 'to-confirm' : same.confidence === 'probable' || l.confidence === 'probable' ? 'probable' : 'sure',
      };
      // Like confidence, a line between two repositories is as sure as its weakest call; towards an
      // outside resource, a call in the code outweighs an address in a configuration (F2.4-16).
      if (l.certainty && same.certainty) {
        const stronger = RANK[l.certainty] > RANK[same.certainty];
        if (l.kind === 'external' ? stronger : !stronger && l.certainty !== same.certainty) Object.assign(merged, { certainty: l.certainty, basis: l.basis, ...(l.kind === 'external' ? { confidence: l.confidence } : {}) });
      }
      links[links.indexOf(same)] = merged;
    } else links.push({ origin: 'scan', ...l, id: `${l.kind}:${l.from}>${l.to}` });
  };

  // A route answers its own method; only a route that takes every method (route(), all, use) answers any call (F2.0-34).
  // `* path` lists every route of a path, for a call whose method the code does not say.
  const routes = new Map<string, { map: RepoMap; route: Iface }[]>();
  for (const m of maps) {
    for (const p of m.provides.filter((x) => x.kind === 'http-route')) {
      const { method, path } = splitCall(p.name);
      for (const key of [GENERIC_METHODS.has(method) ? `ANY ${path}` : `${method} ${path}`, `* ${path}`]) routes.set(key, [...(routes.get(key) ?? []), { map: m, route: p }]);
    }
  }
  const hasRoutes = (m: RepoMap) => m.provides.some((p) => p.kind === 'http-route');

  for (const a of maps) {
    // HTTP: a call matched to a route of another repository, method and path; else by the base variable's name.
    for (const c of a.consumes.filter((x) => x.kind === 'http-call')) {
      const { method, path } = splitCall(c.name);
      const exact = (routes.get(GENERIC_METHODS.has(method) ? `* ${path}` : `${method} ${path}`) ?? []).filter((r) => r.map !== a);
      const anyMethod = exact.length ? [] : (routes.get(`ANY ${path}`) ?? []).filter((r) => r.map !== a);
      let sameRoute = exact.length ? exact : anyMethod;
      const base = c.detail?.startsWith('base ') ? c.detail.slice(5) : null;
      // An explicitly named scanned target narrows scope before path matching. A route
      // in an unrelated repository must not override a method mismatch there.
      const namedTargets = base ? maps.filter((b) => b !== a && [...tokens(base)].some((t) => tokens(b.repo.name).has(t))) : [];
      if (namedTargets.length) sameRoute = sameRoute.filter((r) => namedTargets.includes(r.map));
      if (sameRoute.length) {
        // Several repositories serve the same path: the base variable decides, else each is only probable.
        const named = base ? sameRoute.filter((r) => [...tokens(base)].some((t) => tokens(r.map.repo.name).has(t))) : [];
        const pick = named.length === 1 ? named : sameRoute;
        for (const r of pick) {
          const sure = pick.length === 1 && !GENERIC_METHODS.has(method);
          addLink({ from: repoId(a), to: repoId(r.map), kind: 'http', confidence: sure ? 'sure' : 'probable',
            calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), ev(r.map, r.route)], verb: verbOf(method, path, lang),
            certainty: sure ? 'proved' : 'supposed',
            basis: sure ? (fr ? `même chemin ${c.name} des deux côtés` : `same path ${c.name} on both sides`) : (fr ? `plusieurs repos servent ${path}, ou la méthode n’est pas dite` : `several repositories serve ${path}, or the method is not stated`) });
        }
        continue;
      }
      // No route matches. A base variable naming a repository whose routes OKB cannot see: probable; otherwise a question.
      const target = namedTargets.length === 1 && !hasRoutes(namedTargets[0]!) ? namedTargets[0] : undefined;
      if (target) {
        addLink({ from: repoId(a), to: repoId(target), kind: 'http', confidence: 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c)], verb: verbOf(method, path, lang),
          certainty: 'supposed', basis: fr ? `la variable ${base} nomme ${target.repo.name}, dont les routes ne sont pas lues` : `the variable ${base} names ${target.repo.name}, whose routes are not read` });
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
        if (p) addLink({ from: repoId(b), to: repoId(a), kind: 'event', confidence: 'sure', calls: [{ what: c.name, line: p.evidence.line }], evidence: [ev(b, p), ev(a, c)], verb: `${lang === 'fr' ? 'publie' : 'publishes'} ${c.name}`,
          certainty: 'proved', basis: fr ? `${c.name} est publié d’un côté et écouté de l’autre` : `${c.name} is published on one side and listened to on the other` });
      }
    }
    // Packages: used here, published there.
    for (const c of a.consumes.filter((x) => x.kind === 'package')) {
      const b = maps.find((x) => x !== a && (x.published ?? []).some((p) => p.name === c.name));
      if (b) {
        const pub = b.published.find((p) => p.name === c.name)!;
        addLink({ from: repoId(a), to: repoId(b), kind: 'package', confidence: 'sure', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), { repo: b.repo.name, file: pub.evidence.file, line: pub.evidence.line }], verb: `${lang === 'fr' ? 'utilise' : 'uses'} ${c.name}`,
          certainty: 'proved', basis: fr ? `${c.name} est publié par ${b.repo.name} et déclaré en dépendance` : `${c.name} is published by ${b.repo.name} and declared as a dependency` });
      }
    }
    // Named services (destinations, external services, bindings) provided by another repository.
    const named: Iface[] = [];
    for (const c of a.consumes.filter((x) => ['external-service', 'destination', 'service-binding', 'odata'].includes(x.kind))) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      let found = false;
      for (const b of maps) {
        if (b === a) continue;
        const p = b.provides.find((x) => ['cds-service', 'service-binding', 'odata', 'openapi', 'grpc', 'ui-app'].includes(x.kind) && norm(x.name) === norm(c.name));
        if (p) {
          found = true;
          addLink({ from: repoId(a), to: repoId(b), kind: 'service', confidence: 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c), ev(b, p)], verb: `${lang === 'fr' ? 'appelle' : 'calls'} ${c.name}`,
            certainty: 'proved', basis: fr ? `${c.name} est déclaré par ${b.repo.name} et requis ici` : `${c.name} is declared by ${b.repo.name} and required here` });
        }
      }
      if (!found && c.kind !== 'service-binding') named.push(c);
    }
    // Datastores: from the stack and declared databases.
    const stores = new Set([...a.stack.map((s) => s.id).filter((id) => DATASTORES.has(id)), ...a.consumes.filter((c) => c.kind === 'database').map((c) => (/postgres|hana|sqlite|mysql/i.exec(c.detail ?? c.name)?.[0] ?? c.name).toLowerCase())]);
    for (const s of stores) {
      const id = `store:${a.repo.name}:${s}`;
      addNode({ id, kind: 'datastore', name: DATASTORE_NAMES[s] ?? s, tech: s, repo: a.repo.name });
      const stackItem = a.stack.find((x) => x.id === s);
      const e = stackItem?.evidence?.[0] ? { repo: a.repo.name, file: stackItem.evidence[0].file, line: stackItem.evidence[0].line } : null;
      addLink({ from: repoId(a), to: id, kind: 'data', confidence: e ? 'probable' : 'to-confirm', calls: [], evidence: e ? [e] : [], verb: lang === 'fr' ? 'utilise cette technologie de données' : 'uses this data technology',
        certainty: e ? 'declared' : 'supposed', basis: e ? (fr ? 'la technologie est déclarée dans le repo' : 'the technology is declared in the repository') : (fr ? 'déduit de la configuration, sans fichier précis' : 'inferred from the configuration, no precise file') });
    }
    // Addresses (F2.4-15): only a call or an address a key names is an outside resource; the rest is kept off the map.
    // An address whose first label names another repository is that repository, supposed.
    for (const c of a.consumes.filter((x) => x.kind === 'url' && x.detail !== 'local')) {
      const role = roleOf(c, options.urlRules);
      if (!ON_MAP.has(role)) {
        if (!offMap.some((o) => o.repo === a.repo.name && o.host === c.name && o.role === role)) offMap.push({ repo: a.repo.name, host: c.name, role, evidence: ev(a, c) });
        continue;
      }
      const twin = resembles(maps, a, firstLabel(c.name));
      if (twin) { named.push({ ...c, kind: 'destination', detail: `url ${c.name}` }); continue; }
      const id = `ext:${c.name}`;
      addNode({ id, kind: 'external', name: c.name, tech: c.name });
      addLink({ from: repoId(a), to: id, kind: 'external', confidence: role === 'call' || options.urlRules?.has(c.name.toLowerCase()) ? 'sure' : 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c)], verb: lang === 'fr' ? 'appelle' : 'calls',
        ...(options.urlRules?.has(c.name.toLowerCase()) ? { certainty: 'confirmed' as const, origin: 'person' as const, basis: fr ? 'rangée à la main comme ressource externe' : 'filed by hand as an outside resource' } : {
        certainty: role === 'call' ? 'declared' as const : 'supposed' as const,
        basis: role === 'call' ? (fr ? `appelé dans le code (${c.evidence.file})` : `called in the code (${c.evidence.file})`) : (fr ? `adresse sous une clé de configuration (${c.evidence.file}), sans appel lu` : `address under a configuration key (${c.evidence.file}), no call read`) }) });
    }
    // A named client, destination or address that resembles another repository that declares nothing of it: supposed.
    // Never a second line towards a repository already linked.
    for (const c of named) {
      const b = resembles(maps, a, c.kind === 'destination' && c.detail?.startsWith('url ') ? firstLabel(c.name) : c.name);
      if (!b || links.some((l) => l.from === repoId(a) && l.to === repoId(b) && l.kind !== 'service')) continue;
      addLink({ from: repoId(a), to: repoId(b), kind: 'service', confidence: 'probable', calls: [{ what: c.name, line: c.evidence.line }], evidence: [ev(a, c)], verb: `${lang === 'fr' ? 'appelle' : 'calls'} ${c.name}`,
        certainty: 'supposed', basis: fr ? `le nom ${c.name} ressemble à ${b.repo.name}, qui ne le déclare pas` : `the name ${c.name} looks like ${b.repo.name}, which does not declare it` });
    }
  }
  // Read by repository, then calls before events, libraries, data and outside systems.
  const rank: Record<LinkKind, number> = { http: 0, service: 1, event: 2, package: 3, data: 4, external: 5 };
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;
  links.sort((x, y) => name(x.from).localeCompare(name(y.from)) || rank[x.kind] - rank[y.kind] || name(x.to).localeCompare(name(y.to)));
  return { nodes, links, questions, offMap };
}
