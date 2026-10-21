import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb, type Db } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { safeUrl } from './safe-url.js';
import { mutateTicket, ticketId, type TicketRecord } from './tickets.js';

/**
 * The fields of a ticket's sheet (F2.4-08, D70): each value keeps where it came
 * from, when, and whether the person wrote it. A value the person wrote is never
 * replaced by the agent or a source: the other value is kept as a conflict the
 * person settles (F2.4-09). Nothing is invented: an empty, « unknown » or
 * reference-only value is refused and the field stays undefined.
 */
export const FIELDS = ['title', 'summary', 'description', 'sourceStatus', 'team', 'product', 'done', 'blocker'] as const;
export type FieldName = (typeof FIELDS)[number];
export const ORIGINS = ['person', 'agent', 'jira', 'servicenow', 'wiki', 'github', 'other'] as const;
export type Origin = (typeof ORIGINS)[number];
/** What can be declared not applicable: any field but the blocker (« no blocker » is a value), and the criteria. */
export type NaTarget = Exclude<FieldName, 'blocker'> | 'criteria';

export type FieldValue = { readonly field: FieldName; readonly value: string; readonly origin: Origin; readonly url: string | null; readonly at: string; readonly manual: boolean };
export type FieldConflict = { readonly field: FieldName; readonly value: string; readonly origin: Origin; readonly url: string | null; readonly at: string };

const LIMITS: Record<FieldName, number> = { title: 200, summary: 600, description: 8000, sourceStatus: 80, team: 120, product: 120, done: 1000, blocker: 600 };
const EMPTY = new Set(['inconnu', 'inconnue', 'unknown', 'tbd', 'a definir', 'n/a', 'todo']);
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** A value worth keeping: not empty, not a placeholder, not the reference itself. */
export function isMeaningful(value: string, ref: string): boolean {
  const v = fold(value);
  if (!v || EMPTY.has(v)) return false;
  return value.trim().toUpperCase().replace(/_/g, '-') !== ticketId(ref);
}

const input = z.object({ field: z.enum(FIELDS), value: z.string(), origin: z.enum(ORIGINS), url: safeUrl.optional(), at: z.string().datetime().optional() }).strict();
export type SetFieldInput = z.input<typeof input>;

type Row = { field: FieldName; value: string; origin: Origin; url: string | null; at: string; manual: number; na_reason: string | null };

function invalid(message: string): OkbError { return new OkbError('E_INVALID', message, { key: 'ticketFieldInvalid' }); }
const short = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s);
function note(record: TicketRecord, at: string, text: string): TicketRecord {
  return { ...record, journal: [...record.journal, { at, kind: 'field', text }] };
}

export async function setField(config: OkbConfig, ref: string, raw: SetFieldInput): Promise<{ changed: boolean; conflict: FieldConflict | null }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'invalid ticket field');
  const { field, origin } = parsed.data;
  const value = parsed.data.value.trim();
  const url = parsed.data.url ?? null;
  const id = ticketId(ref);
  if (!isMeaningful(value, id)) throw invalid(`${field} needs a real value; it stays undefined`);
  if (value.length > LIMITS[field]) throw invalid(`${field} is limited to ${LIMITS[field]} characters`);
  assertNoSecrets({ value, url }, 'ticket field');
  let result: { changed: boolean; conflict: FieldConflict | null } = { changed: false, conflict: null };
  await mutateTicket(config, id, (record, db) => {
    const at = parsed.data.at ?? new Date().toISOString();
    const before = db.get<Row>('SELECT field, value, origin, url, at, manual, na_reason FROM ticket_fields WHERE ref = ? AND field = ?', id, field);
    if (before && before.na_reason === null && before.value === value && (before.origin === origin || (origin !== 'person' && before.manual))) return record;
    if (before?.manual && origin !== 'person') {
      db.run('INSERT INTO ticket_field_conflicts (ref, field, value, origin, url, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ref, field, origin) DO UPDATE SET value = excluded.value, url = excluded.url, at = excluded.at', id, field, value, origin, url, at);
      result = { changed: false, conflict: { field, value, origin, url, at } };
      return record;
    }
    db.run('INSERT INTO ticket_fields (ref, field, value, origin, url, at, manual, na_reason) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(ref, field) DO UPDATE SET value = excluded.value, origin = excluded.origin, url = excluded.url, at = excluded.at, manual = excluded.manual, na_reason = NULL',
      id, field, value, origin, url, at, origin === 'person' ? 1 : 0);
    if (origin === 'person') db.run('DELETE FROM ticket_field_conflicts WHERE ref = ? AND field = ?', id, field);
    result = { changed: true, conflict: null };
    const was = before && before.na_reason === null && before.value ? `${short(before.value)} → ` : '';
    return note(record, at, `${field} : ${was}${short(value)} (${origin})`);
  });
  return result;
}

export async function clearField(config: OkbConfig, ref: string, field: FieldName): Promise<void> {
  if (!(FIELDS as readonly string[]).includes(field)) throw invalid('unknown ticket field');
  const id = ticketId(ref);
  await mutateTicket(config, id, (record, db) => {
    const before = db.get<Row>('SELECT value FROM ticket_fields WHERE ref = ? AND field = ?', id, field);
    db.run('DELETE FROM ticket_fields WHERE ref = ? AND field = ?', id, field);
    db.run('DELETE FROM ticket_field_conflicts WHERE ref = ? AND field = ?', id, field);
    return before ? note(record, new Date().toISOString(), `${field} : vidé`) : record;
  });
}

export async function markNotApplicable(config: OkbConfig, ref: string, field: NaTarget, reason: string): Promise<void> {
  const why = reason.trim();
  if (field === ('blocker' as string) || ![...FIELDS, 'criteria'].includes(field)) throw invalid('this field cannot be declared not applicable');
  if (!why || why.length > 300) throw invalid('not applicable needs a reason');
  assertNoSecrets({ why }, 'ticket field');
  const id = ticketId(ref);
  await mutateTicket(config, id, (record, db) => {
    const at = new Date().toISOString();
    db.run("INSERT INTO ticket_fields (ref, field, value, origin, url, at, manual, na_reason) VALUES (?, ?, '', 'person', NULL, ?, 1, ?) ON CONFLICT(ref, field) DO UPDATE SET value = '', origin = 'person', url = NULL, at = excluded.at, manual = 1, na_reason = excluded.na_reason", id, field, at, why);
    db.run('DELETE FROM ticket_field_conflicts WHERE ref = ? AND field = ?', id, field);
    return note(record, at, `${field} : non applicable (${short(why)})`);
  });
}

/** The person settles a conflict: keep their value, or take the one a source gave. */
export async function resolveConflict(config: OkbConfig, ref: string, field: FieldName, keep: 'mine' | Origin): Promise<void> {
  const id = ticketId(ref);
  await mutateTicket(config, id, (record, db) => {
    const at = new Date().toISOString();
    if (keep !== 'mine') {
      const other = db.get<FieldConflict>('SELECT field, value, origin, url, at FROM ticket_field_conflicts WHERE ref = ? AND field = ? AND origin = ?', id, field, keep);
      if (!other) throw new OkbError('E_NOT_FOUND', 'no such conflict on this ticket', { key: 'ticketConflictUnknown' });
      db.run('UPDATE ticket_fields SET value = ?, origin = ?, url = ?, at = ?, manual = 0 WHERE ref = ? AND field = ?', other.value, other.origin, other.url, at, id, field);
      db.run('DELETE FROM ticket_field_conflicts WHERE ref = ? AND field = ?', id, field);
      return note(record, at, `${field} : ${short(other.value)} (${other.origin}, choisi par la personne)`);
    }
    db.run('DELETE FROM ticket_field_conflicts WHERE ref = ? AND field = ?', id, field);
    return record;
  });
}

export function readFields(config: OkbConfig, ref: string, db: Db = openDb(config)): { fields: Partial<Record<FieldName, FieldValue>>; conflicts: FieldConflict[]; notApplicable: Partial<Record<NaTarget, string>> } {
  const id = ticketId(ref);
  const fields: Partial<Record<FieldName, FieldValue>> = {};
  const notApplicable: Partial<Record<NaTarget, string>> = {};
  for (const r of db.all<Row>('SELECT field, value, origin, url, at, manual, na_reason FROM ticket_fields WHERE ref = ?', id)) {
    if (r.na_reason !== null) notApplicable[r.field as NaTarget] = r.na_reason;
    else if ((FIELDS as readonly string[]).includes(r.field)) fields[r.field] = { field: r.field, value: r.value, origin: r.origin, url: r.url, at: r.at, manual: Boolean(r.manual) };
  }
  const conflicts = db.all<FieldConflict>('SELECT field, value, origin, url, at FROM ticket_field_conflicts WHERE ref = ? ORDER BY field, at', id);
  return { fields, conflicts, notApplicable };
}
