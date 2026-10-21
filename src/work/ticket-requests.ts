import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { newId } from '../projects/projects.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { completeness } from './ticket-completeness.js';
import { readFields, type FieldName } from './ticket-fields.js';
import { loadTicket, ticketId } from './tickets.js';

/** What the person asked the agent to find for a ticket (F2.4-10). */
export type TicketRequest = {
  readonly id: string;
  readonly ref: string;
  readonly fields: readonly (FieldName | 'criteria')[];
  readonly state: 'pending' | 'done' | 'partial' | 'failed' | 'cancelled';
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly report: { readonly found: string[]; readonly missing: string[]; readonly read: string[]; readonly unavailable: string[]; readonly note: string } | null;
};

const ASKABLE = ['title', 'summary', 'description', 'criteria', 'sourceStatus', 'team', 'product', 'done', 'blocker'] as const;
type Askable = (typeof ASKABLE)[number];
type Row = { id: string; ref: string; fields: string; state: TicketRequest['state']; created_at: string; closed_at: string | null; report: string | null };
const fromRow = (r: Row): TicketRequest => ({ id: r.id, ref: r.ref, fields: JSON.parse(r.fields) as Askable[], state: r.state, createdAt: r.created_at, closedAt: r.closed_at, report: r.report ? JSON.parse(r.report) as TicketRequest['report'] : null });
const reportSchema = z.object({ found: z.array(z.string().max(60)).max(20), missing: z.array(z.string().max(60)).max(20), read: z.array(z.string().max(60)).max(20), unavailable: z.array(z.string().max(60)).max(20), note: z.string().max(1000) }).strict();

/** What is still missing on a ticket, as fields the agent can look for. */
function missingFields(config: OkbConfig, ref: string): Askable[] {
  const db = openDb(config);
  const { fields, notApplicable } = readFields(config, ref, db);
  const criteria = db.all<{ text: string; kind: string }>('SELECT text, kind FROM ticket_criteria WHERE ref = ?', ref).filter((c) => c.text !== c.kind);
  const record = db.get<{ payload: string }>('SELECT payload FROM tickets WHERE ref = ?', ref);
  const repos = record ? (JSON.parse(record.payload) as { repos: unknown[] }).repos.length : 0;
  const { missing } = completeness({ fields, notApplicable, criteria, hasNext: true, repos });
  return missing.flatMap((r): Askable[] => (r === 'teamProduct' ? ['team', 'product'] : (ASKABLE as readonly string[]).includes(r) ? [r as Askable] : []));
}

/**
 * Ask the agent to find fields (F2.4-10): one open request per ticket, added to
 * rather than repeated. No field named means everything still missing. OKB
 * never contacts a source: the agent reads what its own tools allow.
 */
export async function requestFields(config: OkbConfig, ref: string, fields: readonly string[]): Promise<TicketRequest> {
  const id = ticketId(ref);
  if (!(await loadTicket(config, id))) throw new OkbError('E_NOT_FOUND', `no ticket ${ref}`, { key: 'ticketUnknown', params: { ref } });
  const bad = fields.find((f) => !(ASKABLE as readonly string[]).includes(f));
  if (bad) throw new OkbError('E_INVALID', `cannot ask for ${bad}`, { key: 'ticketRequestField' });
  const wanted = (fields.length ? fields : missingFields(config, id)) as Askable[];
  const db = openDb(config);
  return db.tx(() => {
    const open = db.get<Row>("SELECT * FROM ticket_requests WHERE ref = ? AND state = 'pending'", id);
    if (open) {
      const merged = [...new Set([...(JSON.parse(open.fields) as Askable[]), ...wanted])];
      db.run('UPDATE ticket_requests SET fields = ? WHERE id = ?', JSON.stringify(merged), open.id);
      return fromRow({ ...open, fields: JSON.stringify(merged) });
    }
    const row: Row = { id: newId('R'), ref: id, fields: JSON.stringify(wanted), state: 'pending', created_at: new Date().toISOString(), closed_at: null, report: null };
    db.run('INSERT INTO ticket_requests (id, ref, fields, state, created_at) VALUES (?, ?, ?, ?, ?)', row.id, row.ref, row.fields, row.state, row.created_at);
    return fromRow(row);
  });
}

export function openRequests(config: OkbConfig, filter: { ref?: string; repo?: string } = {}): TicketRequest[] {
  const db = openDb(config);
  return db.all<Row & { payload: string }>("SELECT r.*, t.payload FROM ticket_requests r JOIN tickets t ON t.ref = r.ref WHERE r.state = 'pending' ORDER BY r.created_at")
    .filter((r) => (!filter.ref || r.ref === ticketId(filter.ref)) && (!filter.repo || (JSON.parse(r.payload) as { repos: { id: string }[] }).repos.some((x) => x.id === filter.repo)))
    .map(fromRow);
}

/** The agent reports: found everything, part of it, or nothing because a source could not be read. */
export function closeRequest(config: OkbConfig, id: string, report: z.input<typeof reportSchema>): TicketRequest {
  const p = reportSchema.safeParse(report);
  if (!p.success) throw new OkbError('E_INVALID', p.error.issues[0]?.message ?? 'invalid report', { key: 'ticketRequestReport' });
  assertNoSecrets(p.data, 'request report');
  const db = openDb(config);
  const row = db.get<Row>('SELECT * FROM ticket_requests WHERE id = ?', id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no request ${id}`, { key: 'ticketRequestUnknown' });
  if (row.state !== 'pending') throw new OkbError('E_CONFLICT', `request ${id} is already ${row.state}`, { key: 'ticketRequestClosed' });
  const state: TicketRequest['state'] = !p.data.missing.length ? 'done' : !p.data.found.length && p.data.unavailable.length ? 'failed' : 'partial';
  const closed = { ...row, state, closed_at: new Date().toISOString(), report: JSON.stringify(p.data) };
  db.run('UPDATE ticket_requests SET state = ?, closed_at = ?, report = ? WHERE id = ?', closed.state, closed.closed_at, closed.report, id);
  return fromRow(closed);
}

export function cancelRequest(config: OkbConfig, id: string): void {
  openDb(config).run("UPDATE ticket_requests SET state = 'cancelled', closed_at = ? WHERE id = ? AND state = 'pending'", new Date().toISOString(), id);
}

const NAMES: Record<'fr' | 'en', Record<Askable, string>> = {
  fr: { title: 'titre', summary: 'résumé', description: 'description', criteria: 'critères', sourceStatus: 'statut source', team: 'équipe', product: 'produit', done: 'ce qui est fait', blocker: 'blocage' },
  en: { title: 'title', summary: 'summary', description: 'description', criteria: 'criteria', sourceStatus: 'source status', team: 'team', product: 'product', done: 'what is done', blocker: 'blocker' },
};

/** A prompt to paste in an agent session that is already open. */
export function requestPrompt(req: TicketRequest, lang: 'fr' | 'en'): string {
  const list = req.fields.map((f) => NAMES[lang][f as Askable] ?? f).join(', ');
  return lang === 'fr'
    ? `Complète le ticket ${req.ref} dans OKB : ${list}. Lis seulement les sources que tes outils permettent (Jira, ServiceNow, wiki), note l’origine et le lien de chaque valeur avec \`okb ticket set ${req.ref} --field <champ> --value <valeur> --origin <source> --url <lien>\`, puis rends compte avec \`okb ticket requests close ${req.id} --found … --missing … --read … --unavailable …\`. N’invente rien ; dis ce que tu n’as pas pu lire.`
    : `Complete ticket ${req.ref} in OKB: ${list}. Read only the sources your tools allow (Jira, ServiceNow, wiki), record each value's origin and link with \`okb ticket set ${req.ref} --field <field> --value <value> --origin <source> --url <link>\`, then report with \`okb ticket requests close ${req.id} --found … --missing … --read … --unavailable …\`. Do not invent anything; say what you could not read.`;
}
