import { ArrowRight, Compass, FolderGit2, Ticket } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useShareWords } from '../app/sharing';
import { hrefFor } from '../app/router';
import type { Project } from '../pages/Projects';
import type { TicketRecord } from '../app/tickets';
import '../styles/work.css';

export function workHref(project: Pick<Project, 'kind' | 'ref' | 'id'>) {
  return project.kind === 'ticket' && project.ref ? hrefFor({ name: 'tickets', ref: project.ref }) : project.kind === 'repo' && project.ref ? hrefFor({ name: 'repos', id: project.ref }) : hrefFor({ name: 'projects', id: project.id });
}
export function shortAction(text: string, limit = 140) {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= limit) return line;
  const prefix = line.slice(0, limit - 1);
  const boundary = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, boundary > limit * 0.6 ? boundary : prefix.length)}…`;
}
export function ProjectPreview({ project, ticket }: { project: Project; ticket?: TicketRecord }) {
  const waiting = ticket?.waiting;
  const blocked = waiting?.status === 'blocked' || waiting?.status === 'waiting';
  return <WorkPreview kind={project.kind} refId={project.ref} title={project.title} status={blocked ? waiting.status : project.status} next={project.next || ticket?.next || project.leftOff?.resume || ''} blocker={blocked ? waiting.detail : project.status === 'waiting' ? project.leftOff?.waiting : ''} href={workHref(project)} />;
}
export function TicketPreview({ ticket }: { ticket: Pick<TicketRecord, 'ref' | 'title' | 'status' | 'next' | 'waiting'> }) {
  const blocked = ticket.waiting?.status === 'blocked' || ticket.waiting?.status === 'waiting';
  return <WorkPreview kind="ticket" refId={ticket.ref} title={ticket.title} status={blocked ? ticket.waiting!.status : ticket.status} next={ticket.next ?? ''} blocker={blocked ? ticket.waiting!.detail : ''} href={hrefFor({ name: 'tickets', ref: ticket.ref })} />;
}
function WorkPreview({ kind, refId, title, status, next, blocker, href }: { kind: string; refId?: string | null; title: string; status: string; next: string; blocker?: string; href: string }) {
  const w = useShareWords();
  const Icon = kind === 'ticket' ? Ticket : kind === 'repo' ? FolderGit2 : Compass;
  const statusText = status === 'done' ? w('Travail terminé', 'Work done') : status === 'blocked' ? w('Bloqué', 'Blocked') : status === 'waiting' ? w('En attente', 'Waiting') : w('À reprendre', 'To resume');
  const full = blocker?.trim() || next.trim();
  return <li className="link-row work-preview"><a href={href}>
    <span className="cat" style={{ '--c': kind === 'ticket' ? 'var(--c-p1)' : 'var(--c-p2)' } as CSSProperties} aria-hidden="true"><Icon size={17} /></span>
    <span className="grow work-preview-body"><span className="title">{refId && refId !== title ? `${refId} · ` : ''}{title}</span><span className={`pill sm work-state${status === 'blocked' ? ' warn' : ''}`}>{statusText}</span><span className="meta work-next">{blocker?.trim() ? w('Blocage / attente : ', 'Blocker / waiting: ') : w('Suite : ', 'Next: ')}{full ? shortAction(full) : w('À préciser dans la fiche', 'To clarify in the detail')}</span><span className="work-detail-link xs">{w('Ouvrir les détails', 'Open details')}<ArrowRight size={12} aria-hidden="true" /></span></span>
  </a></li>;
}
