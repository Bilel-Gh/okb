import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb, type Db } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { safeUrl } from '../work/safe-url.js';

/**
 * Fields of a repository or a product that keep where each value came from
 * (F2.4-19, D73), with the rules of a ticket's sheet (D70): a value the person
 * wrote is never replaced by an agent or a source — the other value is kept as
 * a conflict the person settles; nothing is invented, so an empty, « unknown »
 * or « TBD » value is refused and the field stays undefined.
 */
export const ORIGINS = ['person', 'agent', 'jira', 'servicenow', 'wiki', 'github', 'other'] as const;
export type Origin = (typeof ORIGINS)[number];
export const SUBJECT_KINDS = ['repo', 'product'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const SUBJECT_FIELDS = ['team'] as const;
export type SubjectField = (typeof SUBJECT_FIELDS)[number];

export type SourcedValue = { readonly field: SubjectField; readonly value: string; readonly origin: Origin; readonly url: string | null; readonly at: string; readonly manual: boolean };
export type SourcedConflict = { readonly field: SubjectField; readonly value: string; readonly origin: Origin; readonly url: string | null; readonly at: string };

const LIMITS: Record<SubjectField, number> = { team: 120 };
const EMPTY = new Set(['inconnu', 'inconnue', 'unknown', 'tbd', 'a definir', 'n/a', 'todo']);
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** A placeholder is not a value: empty, « unknown », « TBD », « à définir »… (shared with the ticket sheet). */
export function isPlaceholder(value: string): boolean {
  const v = fold(value);
  return !v || EMPTY.has(v);
}

const input = z.object({ field: z.enum(SUBJECT_FIELDS), value: z.string(), origin: z.enum(ORIGINS), url: safeUrl.optional(), at: z.string().datetime().optional() }).strict();
type Row = { field: SubjectField; value: string; origin: Origin; url: string | null; at: string; manual: number; na_reason: string | null };
const invalid = (message: string) => new OkbError('E_INVALID', message, { key: 'subjectFieldInvalid' });
const COLS = 'field, value, origin, url, at, manual, na_reason';

export async function setSubjectField(config: OkbConfig, kind: SubjectKind, subject: string, raw: z.input<typeof input>): Promise<{ changed: boolean; conflict: SourcedConflict | null }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'invalid field');
  const { field, origin } = parsed.data;
  const value = parsed.data.value.trim();
  const url = parsed.data.url ?? null;
  if (isPlaceholder(value)) throw invalid(`${field} needs a real value; it stays undefined`);
  if (value.length > LIMITS[field]) throw invalid(`${field} is limited to ${LIMITS[field]} characters`);
  assertNoSecrets({ value, url }, 'field');
  const db = openDb(config);
  const at = parsed.data.at ?? new Date().toISOString();
  return db.tx(() => {
    const before = db.get<Row>(`SELECT ${COLS} FROM subject_fields WHERE kind = ? AND subject = ? AND field = ?`, kind, subject, field);
    if (before && before.na_reason === null && before.value === value && (before.origin === origin || (origin !== 'person' && before.manual))) return { changed: false, conflict: null };
    if (before?.manual && origin !== 'person') {
      db.run('INSERT INTO subject_field_conflicts (kind, subject, field, value, origin, url, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(kind, subject, field, origin) DO UPDATE SET value = excluded.value, url = excluded.url, at = excluded.at', kind, subject, field, value, origin, url, at);
      return { changed: false, conflict: { field, value, origin, url, at } };
    }
    db.run(`INSERT INTO subject_fields (kind, subject, field, value, origin, url, at, manual, na_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(kind, subject, field) DO UPDATE SET value = excluded.value, origin = excluded.origin, url = excluded.url, at = excluded.at, manual = excluded.manual, na_reason = NULL`,
      kind, subject, field, value, origin, url, at, origin === 'person' ? 1 : 0);
    if (origin === 'person') db.run('DELETE FROM subject_field_conflicts WHERE kind = ? AND subject = ? AND field = ?', kind, subject, field);
    return { changed: true, conflict: null };
  });
}

export function clearSubjectField(config: OkbConfig, kind: SubjectKind, subject: string, field: SubjectField): void {
  const db = openDb(config);
  db.tx(() => {
    db.run('DELETE FROM subject_fields WHERE kind = ? AND subject = ? AND field = ?', kind, subject, field);
    db.run('DELETE FROM subject_field_conflicts WHERE kind = ? AND subject = ? AND field = ?', kind, subject, field);
  });
}

export function markSubjectNotApplicable(config: OkbConfig, kind: SubjectKind, subject: string, field: SubjectField, reason: string): void {
  const why = reason.trim();
  if (!why || why.length > 300) throw invalid('not applicable needs a reason');
  assertNoSecrets({ why }, 'field');
  const db = openDb(config);
  db.tx(() => {
    db.run("INSERT INTO subject_fields (kind, subject, field, value, origin, url, at, manual, na_reason) VALUES (?, ?, ?, '', 'person', NULL, ?, 1, ?) ON CONFLICT(kind, subject, field) DO UPDATE SET value = '', origin = 'person', url = NULL, at = excluded.at, manual = 1, na_reason = excluded.na_reason", kind, subject, field, new Date().toISOString(), why);
    db.run('DELETE FROM subject_field_conflicts WHERE kind = ? AND subject = ? AND field = ?', kind, subject, field);
  });
}

/** The person settles a conflict: keep their value, or take the one a source gave. */
export function resolveSubjectConflict(config: OkbConfig, kind: SubjectKind, subject: string, field: SubjectField, keep: 'mine' | Origin): void {
  const db = openDb(config);
  db.tx(() => {
    if (keep !== 'mine') {
      const other = db.get<SourcedConflict>('SELECT field, value, origin, url, at FROM subject_field_conflicts WHERE kind = ? AND subject = ? AND field = ? AND origin = ?', kind, subject, field, keep);
      if (!other) throw new OkbError('E_NOT_FOUND', 'no such conflict', { key: 'subjectConflictUnknown' });
      db.run('UPDATE subject_fields SET value = ?, origin = ?, url = ?, at = ?, manual = 0, na_reason = NULL WHERE kind = ? AND subject = ? AND field = ?', other.value, other.origin, other.url, new Date().toISOString(), kind, subject, field);
    }
    db.run('DELETE FROM subject_field_conflicts WHERE kind = ? AND subject = ? AND field = ?', kind, subject, field);
  });
}

export function readSubjectFields(config: OkbConfig, kind: SubjectKind, subject: string, db: Db = openDb(config)): { fields: Partial<Record<SubjectField, SourcedValue>>; conflicts: SourcedConflict[]; notApplicable: Partial<Record<SubjectField, string>> } {
  const fields: Partial<Record<SubjectField, SourcedValue>> = {};
  const notApplicable: Partial<Record<SubjectField, string>> = {};
  for (const r of db.all<Row>(`SELECT ${COLS} FROM subject_fields WHERE kind = ? AND subject = ?`, kind, subject)) {
    if (r.na_reason !== null) notApplicable[r.field] = r.na_reason;
    else fields[r.field] = { field: r.field, value: r.value, origin: r.origin, url: r.url, at: r.at, manual: Boolean(r.manual) };
  }
  const conflicts = db.all<SourcedConflict>('SELECT field, value, origin, url, at FROM subject_field_conflicts WHERE kind = ? AND subject = ? ORDER BY field, at', kind, subject);
  return { fields, conflicts, notApplicable };
}

/** A suggestion the person turned down does not come back. */
export function dismissSuggestion(config: OkbConfig, kind: SubjectKind, subject: string, field: SubjectField, value: string): void {
  openDb(config).run('INSERT OR IGNORE INTO subject_dismissed (kind, subject, field, value, at) VALUES (?, ?, ?, ?, ?)', kind, subject, field, value, new Date().toISOString());
}
export function isDismissed(config: OkbConfig, kind: SubjectKind, subject: string, field: SubjectField, value: string): boolean {
  return Boolean(openDb(config).get('SELECT 1 x FROM subject_dismissed WHERE kind = ? AND subject = ? AND field = ? AND value = ?', kind, subject, field, value));
}
