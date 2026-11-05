import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { get } from '../app/api';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { STATE_WORDS, type TicketRecord, type Tracker } from '../app/tickets';
import { Empty } from './States';
import '../styles/work.css';

/** Jira and ServiceNow each have their colour, everywhere a ticket is shown (chantier 4). */
export const TRACKER_COLOR: Record<Tracker, string> = { jira: 'var(--c-p1)', servicenow: 'var(--c-p3)', other: 'var(--c-p4)' };
export const TRACKER_NAME: Record<Tracker, string> = { jira: 'Jira', servicenow: 'ServiceNow', other: '' };
type Tab = 'all' | 'jira' | 'servicenow';

const trackerOf = (t: TicketRecord): Tracker => t.tracker ?? 'other';

function TicketLine({ ticket }: { ticket: TicketRecord }) {
  const w = useShareWords();
  const tracker = trackerOf(ticket);
  const blocked = ticket.waiting?.status === 'blocked' || ticket.waiting?.status === 'waiting';
  const status = ticket.status === 'done' ? w('Travail terminé', 'Work done') : blocked ? w(...(STATE_WORDS[ticket.waiting!.status] ?? ['En attente', 'Waiting'])) : ticket.pr && !['unknown', 'not-open'].includes(ticket.pr) ? `PR ${w(...(STATE_WORDS[ticket.pr] ?? [ticket.pr, ticket.pr])).toLowerCase()}` : w('En cours', 'In progress');
  const title = ticket.sheetTitle || ticket.title;
  return <li className="link-row tt-row" style={{ '--tt': TRACKER_COLOR[tracker] } as CSSProperties}><a href={hrefFor({ name: 'tickets', ref: ticket.ref })}>
    <span className="tt-bar" aria-hidden="true" />
    <span className="grow tt-body">
      <span className="title"><span className="tt-ref">{ticket.ref}</span>{title && title !== ticket.ref ? ` · ${title}` : ''}</span>
      <span className="tt-meta"><span className={`pill sm${blocked ? ' warn' : ''}`}>{status}</span>{TRACKER_NAME[tracker] ? <span className="tt-src">{TRACKER_NAME[tracker]}</span> : null}{ticket.repos.length ? <span className="meta">{ticket.repos.map((r) => r.id).join(', ')}</span> : null}</span>
      {ticket.mission ? <span className="meta tt-mission">{ticket.mission}</span> : null}
    </span>
    <ArrowRight size={14} aria-hidden="true" className="muted" />
  </a></li>;
}

/**
 * The tickets in three tabs, All, Jira and ServiceNow, newest first. On the
 * home page it shows the five latest of each tab; on the Tickets page it pages.
 */
export function TrackerTabs({ tickets, limit, pageSize, label }: { tickets: readonly TicketRecord[]; limit?: number; pageSize?: number; label: string }) {
  const w = useShareWords();
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(0);
  const sorted = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (t: Tab) => (t === 'all' ? sorted.length : sorted.filter((x) => trackerOf(x) === t).length);
  const shownAll = tab === 'all' ? sorted : sorted.filter((x) => trackerOf(x) === tab);
  const pages = pageSize ? Math.max(1, Math.ceil(shownAll.length / pageSize)) : 1;
  const at = Math.min(page, pages - 1);
  const shown = pageSize ? shownAll.slice(at * pageSize, (at + 1) * pageSize) : shownAll.slice(0, limit ?? shownAll.length);
  const tabs: { id: Tab; name: string; color: string }[] = [
    { id: 'all', name: w('Tous', 'All'), color: 'var(--ink-3, currentColor)' },
    { id: 'jira', name: 'Jira', color: TRACKER_COLOR.jira },
    { id: 'servicenow', name: 'ServiceNow', color: TRACKER_COLOR.servicenow },
  ];
  return <div className="tt">
    <div className="tt-tabs" role="tablist" aria-label={label}>{tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tt-tab" style={{ '--tt': t.color } as CSSProperties} onClick={() => { setTab(t.id); setPage(0); }}><span className="tt-dot" aria-hidden="true" />{t.name}<span className="tt-count">{count(t.id)}</span></button>)}</div>
    {shown.length ? <ul className="rows" role="tabpanel">{shown.map((t) => <TicketLine key={t.ref} ticket={t} />)}</ul> : <div className="panel-body"><Empty title={w('Aucun ticket ici', 'No ticket here')} /></div>}
    {pageSize && pages > 1 ? <nav className="tt-pages" aria-label={w('Pages', 'Pages')}>
      <button type="button" className="btn sm ghost" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label={w('Page précédente', 'Previous page')}><ChevronLeft size={15} aria-hidden="true" /></button>
      <span className="meta">{at + 1} / {pages}</span>
      <button type="button" className="btn sm ghost" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label={w('Page suivante', 'Next page')}><ChevronRight size={15} aria-hidden="true" /></button>
    </nav> : null}
  </div>;
}

/** The home page's view of the tickets: the five latest of each tab, or nothing when none is followed. */
export function HomeTickets() {
  const w = useShareWords();
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => get<{ tickets: TicketRecord[] }>('/api/tickets'), retry: false });
  if (!q.data?.tickets.length) return null;
  return <section className="panel" aria-labelledby="home-tickets-h">
    <div className="panel-head"><h2 id="home-tickets-h">{w('Mes tickets', 'My tickets')}</h2><a className="link" href={hrefFor({ name: 'tickets' })}>{w('Tous les tickets', 'All tickets')}</a></div>
    <TrackerTabs tickets={q.data.tickets} limit={5} label={w('Derniers tickets par source', 'Latest tickets by source')} />
  </section>;
}
