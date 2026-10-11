import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { newId } from '../projects/projects.js';
import { assertNoSecrets } from '../security/guard.js';
import { isSecret } from '../security/confidential.js';
import { openDb, type Db } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath } from '../util/paths.js';
import { assertTicketCriteria, loadTicket, mutateTicket, type TicketRecord } from './tickets.js';

/** Local observations, never a promise that a merge was delivered. */
export const TICKET_STATES = {
  work: ['unknown', 'in-progress', 'done'],
  pr: ['unknown', 'not-open', 'draft', 'open', 'review', 'approved', 'changes-requested', 'merged', 'closed'],
  checks: ['unknown', 'pending', 'passed', 'failed'],
  waiting: ['unknown', 'none', 'waiting', 'blocked'],
  delivery: ['unknown', 'pending', 'deployed', 'verified', 'failed'],
} as const;
export type Dimension = keyof typeof TICKET_STATES;
export type ObservationSource = 'person' | 'agent' | 'github' | 'jira';
export type TicketState = { dimension: Dimension; environment: string | null; status: string; source: ObservationSource; at: string | null; detail: string; url: string | null };
export const safeUrl = z.string().url().max(1500).refine((s) => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'Use an HTTPS address without credentials or query parameters.');
const line = (n: number) => z.string().trim().max(n);
export const briefSchema = z.object({ goal: line(1000).optional(), lastAction: line(1000).optional(), next: line(600).optional() }).strict();
export const stateSchema = z.object({ dimension: z.enum(['work', 'pr', 'checks', 'waiting', 'delivery']), environment: z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} _.-]+$/u).optional(), status: line(40).min(1), detail: line(1000).optional(), url: safeUrl.optional() }).strict().superRefine((v, c) => {
  if (!(TICKET_STATES[v.dimension] as readonly string[]).includes(v.status)) c.addIssue({ code: 'custom', path: ['status'], message: `Expected one of ${TICKET_STATES[v.dimension].join(', ')}` });
  if ((v.dimension === 'delivery') !== Boolean(v.environment)) c.addIssue({ code: 'custom', path: ['environment'], message: 'Only delivery requires an environment.' });
});
export const criterionSchema = z.object({ kind: z.enum(['tests', 'documentation', 'acceptance', 'confirmation', 'other']), text: line(500).min(1), required: z.boolean().default(false) }).strict();
export const criterionStatus = z.enum(['unknown', 'pending', 'met', 'waived']);
export const attemptSchema = z.object({ approach: line(1000).min(1), conditions: line(2000).min(1), result: line(2000).min(1), next: line(600).optional() }).strict();
export type Criterion = { id: string; kind: z.infer<typeof criterionSchema>['kind']; text: string; required: boolean; status: z.infer<typeof criterionStatus>; at: string };
export type Attempt = { id: string; approach: string; conditions: string; result: string; next: string; at: string };
export type Reuse = { id: string; path: string; title: string; sha256: string; why: string; at: string };
type DetailRow = { goal: string; last_action: string; next_step: string; external: string | null };
type StateRow = { dimension: Dimension; environment: string; status: string; source: ObservationSource; at: string; detail: string; url: string | null };
type CriterionRow = Omit<Criterion, 'required'> & { required: number };
type AttemptRow = Omit<Attempt, 'next'> & { next_step: string };

function checked<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new OkbError('E_INVALID', result.error.issues[0]?.message ?? 'invalid ticket detail', { key: 'ticketDetailInvalid' });
  assertNoSecrets(result.data, 'ticket detail');
  return result.data;
}
async function known(config: OkbConfig, ref: string): Promise<TicketRecord> {
  const r = await loadTicket(config, ref);
  if (!r) throw new OkbError('E_NOT_FOUND', `no ticket ${ref}`, { key: 'ticketUnknown', params: { ref } });
  return r;
}
function touch(db: Db, ref: string, at: string): void {
  const row = db.get<{ payload: string }>('SELECT payload FROM tickets WHERE ref = ?', ref)!;
  const record = JSON.parse(row.payload) as TicketRecord;
  db.run('UPDATE tickets SET payload = ?, updated_at = ? WHERE ref = ?', JSON.stringify({ ...record, updatedAt: at }), at, ref);
}
function init(db: Db, r: TicketRecord): void {
  db.run('INSERT OR IGNORE INTO ticket_details (ref) VALUES (?)', r.ref);
  // Unknown, optional until the person makes a criterion required; old tickets still close as before.
  for (const kind of ['tests', 'documentation', 'acceptance', 'confirmation']) db.run(
    'INSERT OR IGNORE INTO ticket_criteria (id, ref, kind, text, required, status, at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    `${r.ref}:${kind}`, r.ref, kind, kind, 'unknown', r.startedAt,
  );
}
function limit(db: Db, table: 'ticket_criteria' | 'ticket_attempts' | 'ticket_reuses', ref: string, max: number): void {
  if (db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE ref = ?`, ref)!.n >= max) throw new OkbError('E_INVALID', `ticket ${table} limit reached (${max})`, { key: 'ticketDetailLimit' });
}

export async function ticketDetail(config: OkbConfig, ref: string) {
  const ticket = await known(config, ref);
  const db = openDb(config);
  return db.tx(() => {
    init(db, ticket);
    const saved = db.get<DetailRow>('SELECT goal, last_action, next_step, external FROM ticket_details WHERE ref = ?', ticket.ref)!;
    const rows = db.all<StateRow>('SELECT dimension, environment, status, source, at, detail, url FROM ticket_states WHERE ref = ? ORDER BY dimension, environment', ticket.ref);
    const states: TicketState[] = rows.map((r) => ({ ...r, environment: r.environment || null }));
    for (const dimension of ['work', 'pr', 'checks', 'waiting', 'delivery'] as const) {
      const environment = dimension === 'delivery' ? 'production' : null;
      if (!states.some((s) => s.dimension === dimension && s.environment === environment)) states.push({ dimension, environment, status: dimension === 'work' && ticket.status === 'done' ? 'done' : 'unknown', source: 'person', at: dimension === 'work' ? ticket.doneAt : null, detail: '', url: null });
    }
    const criteria = db.all<CriterionRow>('SELECT id, kind, text, required, status, at FROM ticket_criteria WHERE ref = ? ORDER BY at, id', ticket.ref).map((r) => ({ ...r, required: Boolean(r.required) }));
    const attempts = db.all<AttemptRow>('SELECT id, approach, conditions, result, next_step, at FROM ticket_attempts WHERE ref = ? ORDER BY at DESC, id', ticket.ref).map(({ next_step, ...r }) => ({ ...r, next: next_step }));
    const reuses = db.all<Reuse>('SELECT id, path, title, sha256, why, at FROM ticket_reuses WHERE ref = ? ORDER BY at DESC, id', ticket.ref);
    const missing = criteria.filter((c) => c.required && !['met', 'waived'].includes(c.status)).map((c) => c.text);
    const brief = { goal: saved.goal || ticket.title, lastAction: saved.last_action || ticket.journal.filter((j) => j.text).at(-1)?.text || '', next: saved.next_step, failed: attempts.slice(0, 5) };
    return { ticket, detail: { goal: saved.goal, lastAction: saved.last_action, next: saved.next_step, states, criteria, attempts, reuses, external: saved.external ? JSON.parse(saved.external) as Record<string, unknown> : null, close: { allowed: missing.length === 0, missing } }, brief };
  });
}

export async function updateTicketBrief(config: OkbConfig, ref: string, patch: z.infer<typeof briefSchema>): Promise<void> {
  const p = checked(briefSchema, patch);
  const r = await known(config, ref);
  const db = openDb(config);
  db.tx(() => {
    init(db, r);
    const before = db.get<DetailRow>('SELECT goal, last_action, next_step FROM ticket_details WHERE ref = ?', r.ref)!;
    db.run('UPDATE ticket_details SET goal = ?, last_action = ?, next_step = ? WHERE ref = ?', p.goal ?? before.goal, p.lastAction ?? before.last_action, p.next ?? before.next_step, r.ref);
    touch(db, r.ref, new Date().toISOString());
  });
}

export async function setTicketState(config: OkbConfig, ref: string, input: z.infer<typeof stateSchema>, source: ObservationSource): Promise<void> {
  const p = checked(stateSchema, input);
  const r = await known(config, ref);
  if (p.dimension === 'work') {
    return mutateTicket(config, r.ref, (record, db) => {
      const at = new Date().toISOString();
      if (p.status === 'done') assertTicketCriteria(db, record.ref);
      db.run('INSERT INTO ticket_states (ref, dimension, environment, status, source, at, detail, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ref, dimension, environment) DO UPDATE SET status = excluded.status, source = excluded.source, at = excluded.at, detail = excluded.detail, url = excluded.url', r.ref, 'work', '', p.status, source, at, p.detail ?? '', p.url ?? null);
      const status = p.status === 'done' ? 'done' : 'active';
      const journal = status !== record.status ? [...record.journal, { kind: status === 'done' ? 'done' as const : 'reopen' as const, text: '', at }] : record.journal;
      return { ...record, status, doneAt: status === 'done' ? record.doneAt ?? at : null, journal };
    });
  }
  const db = openDb(config);
  db.tx(() => {
    const at = new Date().toISOString();
    db.run('INSERT INTO ticket_states (ref, dimension, environment, status, source, at, detail, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ref, dimension, environment) DO UPDATE SET status = excluded.status, source = excluded.source, at = excluded.at, detail = excluded.detail, url = excluded.url', r.ref, p.dimension, p.environment ?? '', p.status, source, at, p.detail ?? '', p.url ?? null);
    touch(db, r.ref, at);
  });
}

export async function addCriterion(config: OkbConfig, ref: string, input: z.input<typeof criterionSchema>): Promise<Criterion> {
  const p = checked(criterionSchema, input);
  const r = await known(config, ref);
  const db = openDb(config);
  return db.tx(() => {
    init(db, r); limit(db, 'ticket_criteria', r.ref, 100);
    const c: Criterion = { ...p, id: newId('C'), status: 'unknown', at: new Date().toISOString() };
    db.run('INSERT INTO ticket_criteria (id, ref, kind, text, required, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, r.ref, c.kind, c.text, c.required ? 1 : 0, c.status, c.at);
    touch(db, r.ref, c.at); return c;
  });
}
export async function setCriterion(config: OkbConfig, ref: string, id: string, status: Criterion['status']): Promise<void> {
  return updateCriterion(config, ref, id, { status });
}
export const criterionPatch = z.object({ text: line(500).min(1).optional(), required: z.boolean().optional(), status: criterionStatus.optional() }).strict();
export async function updateCriterion(config: OkbConfig, ref: string, id: string, input: z.infer<typeof criterionPatch>): Promise<void> {
  const parsed = checked(criterionPatch, input);
  const r = await known(config, ref);
  const db = openDb(config);
  db.tx(() => {
    init(db, r);
    const before = db.get<CriterionRow>('SELECT id, kind, text, required, status, at FROM ticket_criteria WHERE ref = ? AND id = ?', r.ref, id);
    if (!before) throw new OkbError('E_NOT_FOUND', 'no criterion on this ticket', { key: 'ticketCriterionUnknown' });
    const at = new Date().toISOString();
    db.run('UPDATE ticket_criteria SET status = ?, text = ?, required = ?, at = ? WHERE ref = ? AND id = ?', parsed.status ?? before.status, parsed.text ?? before.text, parsed.required === undefined ? before.required : parsed.required ? 1 : 0, at, r.ref, id); touch(db, r.ref, at);
  });
}
export async function addAttempt(config: OkbConfig, ref: string, input: z.infer<typeof attemptSchema>): Promise<Attempt> {
  const p = checked(attemptSchema, input);
  const r = await known(config, ref);
  const db = openDb(config);
  return db.tx(() => {
    limit(db, 'ticket_attempts', r.ref, 200);
    const a: Attempt = { id: newId('T'), approach: p.approach, conditions: p.conditions, result: p.result, next: p.next ?? '', at: new Date().toISOString() };
    db.run('INSERT INTO ticket_attempts (id, ref, approach, conditions, result, next_step, at) VALUES (?, ?, ?, ?, ?, ?, ?)', a.id, r.ref, a.approach, a.conditions, a.result, a.next, a.at); touch(db, r.ref, a.at); return a;
  });
}
export async function recordReuse(config: OkbConfig, ref: string, bundle: Bundle, input: { path: string; why?: string }, actor: 'person' | 'agent' = 'person'): Promise<Reuse> {
  const path = asBundlePath(input.path);
  const why = checked(line(600), input.why ?? '');
  const entry = bundle.byPath.get(path);
  if (!entry || entry.reserved) throw new OkbError('E_NOT_FOUND', 'the reused note does not exist', { key: 'noteNotFound', params: { path } });
  if (actor === 'agent' && isSecret(entry.ext)) throw new OkbError('E_NOT_APPROVED', 'a locked note is private to the person');
  const r = await known(config, ref);
  const db = openDb(config);
  return db.tx(() => {
    limit(db, 'ticket_reuses', r.ref, 500);
    const reuse: Reuse = { id: newId('U'), path, title: entry.title, sha256: entry.sha256, why, at: new Date().toISOString() };
    db.run('INSERT INTO ticket_reuses (id, ref, path, title, sha256, why, at) VALUES (?, ?, ?, ?, ?, ?, ?)', reuse.id, r.ref, path, reuse.title, reuse.sha256, why, reuse.at); touch(db, r.ref, reuse.at); return reuse;
  });
}

/** Store a checked external snapshot together with its observations, so a partial reply changes nothing. */
export async function recordExternal(config: OkbConfig, ref: string, snapshot: Record<string, unknown>, observations: readonly z.infer<typeof stateSchema>[] = []): Promise<void> {
  assertNoSecrets(snapshot, 'ticket external snapshot');
  const parsed = observations.map((s) => checked(stateSchema, s));
  const r = await known(config, ref);
  const db = openDb(config);
  db.tx(() => {
    init(db, r);
    db.run('UPDATE ticket_details SET external = ? WHERE ref = ?', JSON.stringify(snapshot), r.ref);
    const at = new Date().toISOString();
    for (const p of parsed) db.run('INSERT INTO ticket_states (ref, dimension, environment, status, source, at, detail, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ref, dimension, environment) DO UPDATE SET status = excluded.status, source = excluded.source, at = excluded.at, detail = excluded.detail, url = excluded.url', r.ref, p.dimension, p.environment ?? '', p.status, String(snapshot.provider), at, p.detail ?? '', p.url ?? null);
    touch(db, r.ref, at);
  });
}
