import type { Origin } from './ticket-fields.js';
import type { OkbConfig } from '../config/schema.js';
import { repoPlace } from '../brain/products.js';
import { loadBundleFor, type Bundle, type KbEntry } from '../kb/bundle.js';
import { listRepos } from '../repo/registry.js';
import type { RepoPlace } from '../repo/pack.js';
import { isSecret } from '../security/confidential.js';
import { openDb } from '../state/db.js';
import { asBundlePath } from '../util/paths.js';
import { loadTicket, ticketId, ticketNoteIn } from './tickets.js';

/** A note tied to a ticket (F2.4-11): confirmed, suggested by a mention, or dismissed for good. */
export type TicketLink = {
  readonly path: string;
  readonly noteId: string | null;
  readonly title: string | null;
  readonly state: 'confirmed' | 'suggested' | 'dismissed';
  readonly origin: Origin;
  readonly at: string;
  readonly why: 'metadata' | 'folder' | 'mention' | 'manual';
  readonly missing: boolean;
};

type Row = { ref: string; path: string; note_id: string | null; state: TicketLink['state']; origin: Origin; at: string };
type Ext = { tickets?: unknown; origin?: unknown; brain?: { type?: unknown; ref?: unknown }; id?: unknown };

const norm = (s: unknown): string | null => { try { return typeof s === 'string' && s.trim() ? ticketId(s) : null; } catch { return null; } };
/** The references a note declares: `tickets: […]`, or the ticket OKB wrote it for. */
function declared(e: KbEntry): string[] {
  const ext = e.ext as Ext;
  const out = new Set<string>();
  if (Array.isArray(ext.tickets)) for (const t of ext.tickets) { const r = norm(t); if (r) out.add(r); }
  const origin = norm(ext.origin);
  if (origin && /^[A-Z][A-Z0-9]*-\d+$/.test(origin)) out.add(origin);
  if (ext.brain?.type === 'ticket') { const r = norm(ext.brain.ref); if (r) out.add(r); }
  return [...out];
}
/** The reference as a whole word, `-` or `_`: DEMO-42 is not DEMO-4211. */
const mentions = (e: KbEntry, ref: string) => {
  const m = ref.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) return false;
  const word = new RegExp(`(^|[^A-Za-z0-9])${m[1]}[-_]${m[2]}(?![0-9])`, 'i');
  return word.test(e.path) || word.test(e.title) || word.test(e.description);
};
const idOf = (e: KbEntry) => (typeof (e.ext as Ext).id === 'string' ? (e.ext as Ext).id as string : null);

async function places(config: OkbConfig): Promise<(repoId: string) => RepoPlace> {
  const map = new Map<string, RepoPlace>();
  for (const r of (await listRepos(process.env).catch(() => [])).filter((x) => x.kb === config.profile.id)) map.set(r.id, await repoPlace(config, r).catch(() => false as RepoPlace));
  return (id) => map.get(id) ?? false;
}

/**
 * The notes of a ticket (F2.4-11): declared in their metadata, the ticket's own
 * note under `tickets/`, tied by hand, or suggested by a mention for the person
 * to confirm. A dismissed link is never shown or suggested again.
 */
export async function linksFor(config: OkbConfig, ref: string, actor: 'person' | 'agent', given?: Bundle): Promise<TicketLink[]> {
  const id = ticketId(ref);
  const bundle = given ?? await loadBundleFor(config);
  const db = openDb(config);
  const rows = db.all<Row>('SELECT ref, path, note_id, state, origin, at FROM ticket_links WHERE ref = ?', id);
  const dismissed = new Set(rows.filter((r) => r.state === 'dismissed').map((r) => r.path));
  const out = new Map<string, TicketLink>();
  const add = (e: KbEntry, why: TicketLink['why'], state: TicketLink['state'], origin: Origin, at: string) => {
    if (dismissed.has(e.path) || out.has(e.path)) return;
    out.set(e.path, { path: e.path, noteId: idOf(e), title: e.title, state, origin, at, why, missing: false });
  };
  for (const e of bundle.entries) if (!e.reserved && declared(e).includes(id)) add(e, 'metadata', 'confirmed', 'person', '');
  const record = await loadTicket(config, id);
  if (record) {
    const own = ticketNoteIn(bundle, record, await places(config));
    const e = own ? bundle.byPath.get(asBundlePath(own)) : undefined;
    if (e) add(e, 'folder', 'confirmed', 'person', '');
  }
  for (const r of rows.filter((x) => x.state !== 'dismissed')) {
    let e = bundle.byPath.get(asBundlePath(r.path));
    if (!e && r.note_id) {
      e = bundle.entries.find((x) => idOf(x) === r.note_id);
      if (e) db.run('UPDATE ticket_links SET path = ? WHERE ref = ? AND path = ?', e.path, id, r.path);
    }
    if (e) add(e, r.state === 'suggested' ? 'mention' : 'manual', r.state, r.origin, r.at);
    else if (!out.has(r.path)) out.set(r.path, { path: r.path, noteId: r.note_id, title: null, state: r.state, origin: r.origin, at: r.at, why: r.state === 'suggested' ? 'mention' : 'manual', missing: true });
  }
  // A note that only mentions the reference is offered, never linked, until the person decides.
  for (const e of bundle.entries) if (!e.reserved && mentions(e, id)) add(e, 'mention', 'suggested', 'agent', '');
  return [...out.values()].filter((l) => actor === 'person' || l.missing || !isSecret(bundle.byPath.get(asBundlePath(l.path))?.ext));
}

/** Confirm, tie by hand, or dismiss for good. */
export function setLink(config: OkbConfig, ref: string, path: string, state: 'confirmed' | 'dismissed', origin: Origin, noteId: string | null = null): void {
  openDb(config).run('INSERT INTO ticket_links (ref, path, note_id, state, origin, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ref, path) DO UPDATE SET state = excluded.state, origin = excluded.origin, at = excluded.at, note_id = COALESCE(excluded.note_id, ticket_links.note_id)',
    ticketId(ref), asBundlePath(path), noteId, state, origin, new Date().toISOString());
}

/** Once, or when the person asks: notes that mention a followed ticket become suggestions. Nothing is written in the KB. */
export async function scanLinks(config: OkbConfig): Promise<{ suggested: number }> {
  const bundle = await loadBundleFor(config);
  const db = openDb(config);
  const refs = db.all<{ ref: string }>('SELECT ref FROM tickets').map((r) => r.ref);
  let suggested = 0;
  db.tx(() => {
    for (const ref of refs) {
      for (const e of bundle.entries) {
        if (e.reserved || declared(e).includes(ref) || !mentions(e, ref)) continue;
        if (db.get('SELECT 1 FROM ticket_links WHERE ref = ? AND path = ?', ref, e.path)) continue;
        db.run("INSERT INTO ticket_links (ref, path, note_id, state, origin, at) VALUES (?, ?, ?, 'suggested', 'agent', ?)", ref, e.path, idOf(e), new Date().toISOString());
        suggested++;
      }
    }
  });
  return { suggested };
}

/** References that notes declare but OKB does not follow: « documented, not followed ». */
export async function documentedRefs(config: OkbConfig, given?: Bundle): Promise<string[]> {
  const bundle = given ?? await loadBundleFor(config);
  const followed = new Set(openDb(config).all<{ ref: string }>('SELECT ref FROM tickets').map((r) => r.ref));
  return [...new Set(bundle.entries.filter((e) => !e.reserved).flatMap(declared))].filter((r) => !followed.has(r)).sort();
}
