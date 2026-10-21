import type { OkbConfig } from '../config/schema.js';
import { listActions, type Action } from '../projects/actions.js';
import { openDb } from '../state/db.js';
import { completeness, type Completeness } from './ticket-completeness.js';
import { readFields, type FieldConflict, type FieldName, type FieldValue, type NaTarget } from './ticket-fields.js';
import { linksFor, type TicketLink } from './ticket-links.js';
import { nextStep } from './ticket-next.js';
import { openRequests, type TicketRequest } from './ticket-requests.js';
import { ticketDetail, type TicketState } from './ticket-state.js';
import { isPinned, ticketId, type JournalEntry, type TicketRecord } from './tickets.js';

/**
 * One sheet per ticket (F2.4-08, D70): what Today, the ticket page, the CLI,
 * the assistant and the session brief read. Nothing here is stored twice.
 */
export type JourneyStep = { readonly id: 'understood' | 'work' | 'pr' | 'checks' | 'delivery'; readonly state: 'done' | 'now' | 'wait' | 'unknown'; readonly label: string; readonly source: string | null; readonly at: string | null };

export type TicketSheet = {
  readonly ref: string;
  readonly followed: true;
  readonly status: TicketRecord['status'];
  readonly title: FieldValue | null;
  readonly fields: Partial<Record<FieldName, FieldValue>>;
  readonly notApplicable: Partial<Record<NaTarget, string>>;
  readonly conflicts: readonly FieldConflict[];
  readonly next: Action | null;
  readonly todos: readonly Action[];
  readonly completeness: Completeness;
  readonly journey: readonly JourneyStep[];
  readonly links: readonly TicketLink[];
  readonly requests: readonly TicketRequest[];
  readonly criteria: Awaited<ReturnType<typeof ticketDetail>>['detail']['criteria'];
  readonly states: readonly TicketState[];
  readonly attempts: Awaited<ReturnType<typeof ticketDetail>>['detail']['attempts'];
  readonly external: Record<string, unknown> | null;
  readonly repos: TicketRecord['repos'];
  readonly pinned: boolean;
  readonly history: readonly JournalEntry[];
  readonly close: { readonly allowed: boolean; readonly missing: readonly string[] };
};

const PR: Record<string, JourneyStep['state']> = { merged: 'done', approved: 'done', open: 'now', review: 'now', draft: 'now', 'changes-requested': 'wait' };
const CHECKS: Record<string, JourneyStep['state']> = { passed: 'done', pending: 'now', failed: 'wait' };
const DELIVERY: Record<string, JourneyStep['state']> = { verified: 'done', deployed: 'done', pending: 'now', failed: 'wait' };
const DELIVERY_RANK = ['unknown', 'failed', 'pending', 'deployed', 'verified'];

/** The five steps of a ticket's journey. Unknown stays unknown: a merge is never a delivery. */
export function journey(percent: number, states: readonly TicketState[]): JourneyStep[] {
  const of = (d: TicketState['dimension']) => states.filter((s) => s.dimension === d);
  const work = of('work')[0], waiting = of('waiting')[0], pr = of('pr')[0], checks = of('checks')[0];
  const delivery = [...of('delivery')].sort((a, b) => DELIVERY_RANK.indexOf(b.status) - DELIVERY_RANK.indexOf(a.status))[0];
  const step = (id: JourneyStep['id'], state: JourneyStep['state'], s: TicketState | undefined, label?: string): JourneyStep =>
    ({ id, state, label: label ?? s?.status ?? 'unknown', source: s && s.status !== 'unknown' ? s.source : null, at: s?.at ?? null });
  const blocked = waiting && ['waiting', 'blocked'].includes(waiting.status);
  const workState: JourneyStep['state'] = blocked ? 'wait' : work?.status === 'done' ? 'done' : work?.status === 'in-progress' ? 'now' : 'unknown';
  return [
    { id: 'understood', state: percent >= 70 ? 'done' : 'wait', label: `${percent}`, source: null, at: null },
    step('work', workState, blocked ? waiting : work, blocked ? waiting!.status : undefined),
    step('pr', PR[pr?.status ?? ''] ?? 'unknown', pr),
    step('checks', CHECKS[checks?.status ?? ''] ?? 'unknown', checks),
    step('delivery', DELIVERY[delivery?.status ?? ''] ?? 'unknown', delivery, delivery && delivery.status !== 'unknown' ? `${delivery.status}${delivery.environment ? ` · ${delivery.environment}` : ''}` : undefined),
  ];
}

/** `links: false` skips reading the notes (Today's cards never show them): one KB walk less per ticket. */
export async function ticketSheet(config: OkbConfig, ref: string, actor: 'person' | 'agent', options: { links?: boolean } = {}): Promise<TicketSheet> {
  const id = ticketId(ref);
  const { ticket, detail } = await ticketDetail(config, id);
  const db = openDb(config);
  const { fields, conflicts, notApplicable } = readFields(config, id, db);
  const todos = (await listActions(config, process.env, { status: 'all' })).filter((a) => a.workRef === id);
  const next = nextStep(config, id);
  const done = completeness({ fields, notApplicable, criteria: detail.criteria.filter((c) => c.text !== c.kind), hasNext: Boolean(next), repos: ticket.repos.length });
  return {
    ref: id, followed: true, status: ticket.status, title: fields.title ?? null, fields, notApplicable, conflicts, next, todos,
    completeness: done, journey: journey(done.percent, detail.states), links: options.links === false ? [] : await linksFor(config, id, actor), requests: openRequests(config, { ref: id }),
    criteria: detail.criteria, states: detail.states, attempts: detail.attempts, external: detail.external, repos: ticket.repos,
    pinned: isPinned(config, id), history: [...ticket.journal].reverse().slice(0, 50), close: detail.close,
  };
}
