import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import type { UrlRole } from '../repo/url-kinds.js';
import type { ArchLink, ArchNode, LinkKind, SystemModel } from './model.js';

/**
 * The person's corrections of the system map (F2.4-17, D72). A correction is
 * tied to a link by its kind and its two ends — never by a line number, which
 * moves with every commit — so the next scan respects it. What the person
 * decides is never replaced: an agent may confirm, retarget or add, and what it
 * says differently is kept as a conflict the person settles. Stored in the
 * KB's state (SQLite), not in a note: no proposal.
 */
export type OverrideAction = 'confirm' | 'exclude' | 'retarget' | 'add';
export type OverrideOrigin = 'person' | 'agent';
export type Override = {
  readonly key: string;
  readonly action: OverrideAction;
  /** Retarget and add: the node the link goes to (`repo:<name>` or `ext:<host>`). */
  readonly target: string | null;
  /** Add: the kind of the link written by hand. */
  readonly kind: LinkKind | null;
  /** Add: what passes on it (`GET /rates`). */
  readonly what: string | null;
  readonly reason: string;
  readonly origin: OverrideOrigin;
  readonly at: string;
};
export type UrlRule = { readonly host: string; readonly role: UrlRole; readonly origin: OverrideOrigin; readonly at: string };

export const linkKey = (kind: string, from: string, to: string): string => `${kind}|${from}|${to}`;
export function parseKey(key: string): { kind: LinkKind; from: string; to: string } | null {
  const [kind, from, to, ...rest] = key.split('|');
  if (!kind || !from || !to || rest.length) return null;
  return { kind: kind as LinkKind, from, to };
}

const day = (iso: string) => iso.slice(0, 10);

/** The model as the person corrected it. Pure: the same scans and corrections give the same map. */
export function applyOverrides(model: SystemModel, overrides: readonly Override[], lang: 'fr' | 'en' = 'fr', conflicts: readonly Override[] = []): SystemModel {
  const fr = lang === 'fr';
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const used = new Set<string>();
  const nodes: ArchNode[] = [...model.nodes];
  const links: ArchLink[] = [];
  const excluded: NonNullable<SystemModel['excluded']>[number][] = [...(model.excluded ?? [])];
  const who = (o: Override) => (o.origin === 'person' ? (fr ? 'toi' : 'you') : (fr ? 'l’agent' : 'the agent'));
  const ensure = (id: string) => {
    if (nodes.some((n) => n.id === id)) return;
    const host = id.replace(/^ext:/, '');
    nodes.push({ id, kind: id.startsWith('ext:') ? 'external' : 'repo', name: host, tech: host });
  };
  const confirmed = (l: ArchLink, o: Override, to = l.to): ArchLink => ({
    ...l, to, id: `${l.kind}:${l.from}>${to}`, confidence: 'sure', certainty: 'confirmed', origin: o.origin,
    basis: `${fr ? 'confirmée par' : 'confirmed by'} ${who(o)} · ${day(o.at)}${o.reason ? ` — ${o.reason}` : ''}`,
  });
  for (const l of model.links) {
    const key = linkKey(l.kind, l.from, l.to);
    const o = byKey.get(key);
    if (!o) { links.push(l); continue; }
    used.add(key);
    if (o.action === 'exclude') { excluded.push({ ...l, reason: o.reason, at: o.at }); continue; }
    if (o.action === 'retarget' && o.target) { ensure(o.target); links.push(confirmed(l, o, o.target)); continue; }
    links.push(confirmed(l, o));
  }
  for (const o of overrides.filter((x) => x.action === 'add' && !used.has(x.key))) {
    const k = parseKey(o.key);
    if (!k || !o.target) continue;
    used.add(o.key);
    if (!nodes.some((n) => n.id === k.from)) continue;
    ensure(o.target);
    links.push({ id: `${k.kind}:${k.from}>${o.target}`, from: k.from, to: o.target, kind: o.kind ?? k.kind, confidence: 'sure', certainty: 'confirmed', origin: o.origin,
      calls: o.what ? [{ what: o.what, line: 0 }] : [], evidence: [], verb: o.what ? `${fr ? 'appelle' : 'calls'} ${o.what}` : (fr ? 'appelle' : 'calls'),
      basis: `${fr ? 'écrite par' : 'written by'} ${who(o)} · ${day(o.at)}${o.reason ? ` — ${o.reason}` : ''}` });
  }
  // Two corrections can bring two links onto the same ends: keep one line, every call and proof.
  const merged = new Map<string, ArchLink>();
  for (const l of links) {
    const prev = merged.get(l.id);
    merged.set(l.id, prev ? { ...prev, calls: [...prev.calls, ...l.calls.filter((c) => !prev.calls.some((p) => p.what === c.what))], evidence: [...prev.evidence, ...l.evidence] } : l);
  }
  const kept = [...merged.values()];
  // An outside resource nobody reaches any more leaves the map.
  const reached = new Set(kept.flatMap((l) => [l.from, l.to]));
  const shown = nodes.filter((n) => n.kind !== 'external' || reached.has(n.id));
  const stale = overrides.filter((o) => !used.has(o.key)).map((o) => ({ key: o.key, action: o.action, at: o.at }));
  return { ...model, nodes: shown, links: kept, excluded, stale, conflicts: conflicts.map((c) => ({ key: c.key, action: c.action, target: c.target, reason: c.reason, origin: c.origin, at: c.at })) };
}

/* ------------------------------------------------------------- storage */

type Row = { key: string; action: OverrideAction; target: string | null; kind: LinkKind | null; what: string | null; reason: string; origin: OverrideOrigin; at: string };

export function readOverrides(config: OkbConfig): { overrides: Override[]; conflicts: Override[]; rules: UrlRule[] } {
  const db = openDb(config);
  return {
    overrides: db.all<Row>('SELECT key, action, target, kind, what, reason, origin, at FROM arch_overrides ORDER BY at'),
    conflicts: db.all<Row>('SELECT key, action, target, kind, what, reason, origin, at FROM arch_conflicts ORDER BY at'),
    rules: db.all<UrlRule>('SELECT host, role, origin, at FROM arch_url_rules ORDER BY host'),
  };
}

/** A stamp that changes with every correction, for caches built from the map. */
export function overridesStamp(config: OkbConfig): string {
  const db = openDb(config);
  const one = (t: string) => db.get<{ n: number; at: string | null }>(`SELECT COUNT(*) n, MAX(at) at FROM ${t}`)!;
  return ['arch_overrides', 'arch_conflicts', 'arch_url_rules'].map((t) => { const r = one(t); return `${r.n}:${r.at ?? ''}`; }).join('/');
}

/**
 * Write a correction. The person's replaces anything and clears the conflict;
 * the agent's replaces only an agent's: facing the person's, a different
 * answer is kept as a conflict and the same one changes nothing.
 */
export function writeOverride(config: OkbConfig, o: Omit<Override, 'at'> & { at?: string }): { changed: boolean; conflict: boolean } {
  assertNoSecrets({ reason: o.reason, what: o.what }, 'map correction');
  const db = openDb(config);
  const row: Override = { ...o, at: o.at ?? new Date().toISOString() };
  return db.tx(() => {
    const before = db.get<Row>('SELECT key, action, target, kind, what, reason, origin, at FROM arch_overrides WHERE key = ?', o.key);
    if (before?.origin === 'person' && o.origin !== 'person') {
      if (before.action === o.action && before.target === o.target) return { changed: false, conflict: false };
      db.run('INSERT INTO arch_conflicts (key, action, target, kind, what, reason, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET action = excluded.action, target = excluded.target, kind = excluded.kind, what = excluded.what, reason = excluded.reason, origin = excluded.origin, at = excluded.at',
        row.key, row.action, row.target, row.kind, row.what, row.reason, row.origin, row.at);
      return { changed: false, conflict: true };
    }
    db.run('INSERT INTO arch_overrides (key, action, target, kind, what, reason, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET action = excluded.action, target = excluded.target, kind = excluded.kind, what = excluded.what, reason = excluded.reason, origin = excluded.origin, at = excluded.at',
      row.key, row.action, row.target, row.kind, row.what, row.reason, row.origin, row.at);
    if (o.origin === 'person') db.run('DELETE FROM arch_conflicts WHERE key = ?', o.key);
    return { changed: true, conflict: false };
  });
}

export function resetOverride(config: OkbConfig, key: string): void {
  const db = openDb(config);
  db.tx(() => { db.run('DELETE FROM arch_overrides WHERE key = ?', key); db.run('DELETE FROM arch_conflicts WHERE key = ?', key); });
}

/** The person settles a conflict: keep their correction, or take the agent's. */
export function resolveArchConflict(config: OkbConfig, key: string, keep: 'mine' | 'agent'): boolean {
  const db = openDb(config);
  return db.tx(() => {
    const other = db.get<Row>('SELECT key, action, target, kind, what, reason, origin, at FROM arch_conflicts WHERE key = ?', key);
    if (!other) return false;
    if (keep === 'agent') {
      db.run('INSERT INTO arch_overrides (key, action, target, kind, what, reason, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET action = excluded.action, target = excluded.target, kind = excluded.kind, what = excluded.what, reason = excluded.reason, origin = excluded.origin, at = excluded.at',
        other.key, other.action, other.target, other.kind, other.what, other.reason, other.origin, new Date().toISOString());
    }
    db.run('DELETE FROM arch_conflicts WHERE key = ?', key);
    return true;
  });
}

export function classifyHost(config: OkbConfig, host: string, role: UrlRole | null, origin: OverrideOrigin = 'person'): void {
  const db = openDb(config);
  const h = host.trim().toLowerCase();
  if (role === null) db.run('DELETE FROM arch_url_rules WHERE host = ?', h);
  else db.run('INSERT INTO arch_url_rules (host, role, origin, at) VALUES (?, ?, ?, ?) ON CONFLICT(host) DO UPDATE SET role = excluded.role, origin = excluded.origin, at = excluded.at', h, role, origin, new Date().toISOString());
}
