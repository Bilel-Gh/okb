import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleDashed, Hourglass, OctagonAlert, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { STATE_WORDS, type Importance } from '../app/tickets';
import { toast } from '../app/toast';
import { Empty } from '../ui/States';
import { workHref } from '../ui/WorkPreview';
import '../styles/ticket.css';
import type { Action } from './day-parts';
import type { Project } from './Projects';
import { Editable, ImportanceBars, TkRing } from './ticket/parts';

/** What Today shows of a ticket (F2.4-13, D70): read from its sheet by the developer module. */
export type WorkCard = {
  ref: string; title: string | null; next: string | null; waitingFor: string | null;
  status: { kind: 'source' | 'waiting' | 'blocked' | 'work'; value: string };
  percent: number | null; steps: number; current: number | null; pinned: boolean; unblockedAt: string | null; filter: 'progress' | 'waiting' | 'blocked'; updatedAt: string;
};
export type ResumeCard = Project & { card: WorkCard | null };
export type ResumeCards = { first: ResumeCard[]; more: ResumeCard[]; pool: ResumeCard[]; total: number; counts: { progress: number; waiting: number; blocked: number } };
export type PendingRequest = { id: string; ref: string; fields: string[]; since: string };
export type TodoAction = Action & { workRef?: string | null; importance?: Importance; pinned?: boolean; work?: { ref: string; title: string } | null };

type Filter = 'all' | 'progress' | 'waiting' | 'blocked';

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const key of ['today', 'sheet', 'tickets', 'projects', 'actions']) void qc.invalidateQueries({ queryKey: [key] }); };
}

function Mini({ steps, current }: { steps: number; current: number | null }) {
  return <span className="tk-mini" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < steps ? 'ok' : i === current ? 'now' : ''} />)}</span>;
}

function Status({ card }: { card: WorkCard }) {
  const w = useShareWords();
  const tone = card.status.kind === 'blocked' ? 'err' : card.status.kind === 'waiting' ? 'warn' : card.status.kind === 'source' ? 'info' : '';
  const text = card.status.kind === 'source' ? card.status.value : card.status.kind === 'blocked' ? w('Bloqué', 'Blocked') : card.status.kind === 'waiting' ? w('En attente', 'Waiting') : card.status.value === 'unknown' ? w('statut inconnu', 'status unknown') : w(...(STATE_WORDS[card.status.value] ?? [card.status.value, card.status.value]));
  return <span className={`pill sm ${tone}`}>{text}</span>;
}

/** A preview stays a preview: 140 characters, the whole text on the sheet and on hover. */
const brief = (s: string) => (s.length > 140 ? `${s.slice(0, 139).trimEnd()}…` : s);

function NextLine({ card }: { card: WorkCard }) {
  const w = useShareWords();
  if (card.filter === 'blocked' && card.waitingFor) return <span className="tk-nx block" title={card.waitingFor}><OctagonAlert size={14} aria-hidden="true" />{w('Bloqué : ', 'Blocked: ')}{brief(card.waitingFor)}</span>;
  if (card.filter === 'waiting' && card.waitingFor) return <span className="tk-nx wait" title={card.waitingFor}><Hourglass size={14} aria-hidden="true" />{w('En attente : ', 'Waiting: ')}{brief(card.waitingFor)}</span>;
  if (card.next) return <span className="tk-nx" title={card.next}><ArrowRight size={14} aria-hidden="true" />{brief(card.next)}</span>;
  return <span className="tk-nx none"><CircleDashed size={14} aria-hidden="true" />{w('Prochaine étape non définie', 'Next step not set')}</span>;
}

const when = (iso: string, lang: string) => { if (!iso) return ''; const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000); return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day'); };

function Card({ item }: { item: ResumeCard }) {
  const w = useShareWords(); const { lang } = useT(); const c = item.card;
  if (!c) return <a className="tk-tcard" href={workHref(item)}><span className="t12 muted">{w('Projet', 'Project')}</span><span className="ttl">{item.title}</span><span className="tk-nx">{item.next ? <><ArrowRight size={14} aria-hidden="true" />{item.next}</> : <span className="muted">{item.where}</span>}</span></a>;
  return <a className="tk-tcard" href={hrefFor({ name: 'tickets', ref: c.ref })}>
    <span className="row between"><span className="t12 muted">{c.ref}</span>{c.percent !== null ? <TkRing percent={c.percent} size={30} stroke={3} /> : null}</span>
    <span className={`ttl${c.title ? '' : ' unset'}`}>{c.title ?? w('Titre non défini', 'Title not set')}</span>
    <Mini steps={c.steps} current={c.current} />
    <NextLine card={c} />
    <span className="foot"><Status card={c} /><span>{when(c.updatedAt || item.updatedAt, lang)}</span></span>
  </a>;
}

function Row({ item }: { item: ResumeCard }) {
  const w = useShareWords(); const { lang } = useT(); const c = item.card;
  if (!c) return <li><a href={workHref(item)}><span className="rf">{w('Projet', 'Project')}</span><span className="grow"><span className="rt">{item.title}</span><span className="rn">{item.next || item.where}</span></span></a></li>;
  return <li><a href={hrefFor({ name: 'tickets', ref: c.ref })}>
    <span className="rf">{c.ref}</span>
    <span className="grow"><span className={`rt${c.title ? '' : ' unset'}`}>{c.title ?? w('Titre non défini', 'Title not set')}</span><NextLine card={c} /></span>
    <Mini steps={c.steps} current={c.current} /><Status card={c} />{c.percent !== null ? <TkRing percent={c.percent} size={26} stroke={3} /> : <span />}<span className="rw">{when(c.updatedAt || item.updatedAt, lang)}</span>
  </a></li>;
}

/** Pick up (F2.4-13): up to three cards, the rule written; beyond, five lines and the way to all of them. */
export function ResumeWork({ cards }: { cards: ResumeCards }) {
  const w = useShareWords(); const [filter, setFilter] = useState<Filter>('all');
  const work = cards.pool.filter((p) => p.kind !== 'repo');
  if (!work.length) return <Empty title={w('Rien à reprendre', 'Nothing to pick up')} action={<a className="btn sm" href={hrefFor({ name: 'projects' })}>{w('Ouvrir les projets', 'Open projects')}<ArrowRight size={14} aria-hidden="true" /></a>}>{w('Suis un ticket ou crée un projet : il apparaîtra ici.', 'Follow a ticket or create a project: it shows up here.')}</Empty>;
  const shown = filter === 'all' ? work : work.filter((p) => (p.card?.filter ?? 'progress') === filter);
  const first = shown.slice(0, 3), more = shown.slice(3, 8);
  const rest = (filter === 'all' ? cards.total : shown.length) - first.length - more.length;
  const counts = { all: cards.total, ...cards.counts };
  return <div className="tk-resume">
    {cards.total > 3 ? <div className="tk-resume-head">
      <div className="segmented" role="group" aria-label={w('Filtrer le travail à reprendre', 'Filter the work to pick up')}>{(['all', 'progress', 'waiting', 'blocked'] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{({ all: w('Tous', 'All'), progress: w('En cours', 'In progress'), waiting: w('En attente', 'Waiting'), blocked: w('Bloqués', 'Blocked') })[f]} <b>{counts[f]}</b></button>)}</div>
      <span className="meta"><Sparkles size={14} aria-hidden="true" />{w('En premier : tes tickets épinglés, puis ceux qui viennent d’être débloqués, puis les plus récents.', 'First: your pinned tickets, then the ones just unblocked, then the most recent.')}</span>
    </div> : null}
    {first.length ? <div className="tk-cards">{first.map((p) => <Card key={p.id} item={p} />)}</div> : <p className="muted small">{w('Rien dans ce filtre.', 'Nothing in this filter.')}</p>}
    {more.length ? <ul className="tk-rlist" aria-label={w('Les autres', 'The others')}>{more.map((p) => <Row key={p.id} item={p} />)}</ul> : null}
    {rest > 0 ? <a className="link" href={hrefFor({ name: 'tickets' })}>{rest === 1 ? w('Voir l’autre dans Tickets suivis', 'See the other one in Followed tickets') : w(`Voir les ${rest} autres dans Tickets suivis`, `See the ${rest} others in Followed tickets`)}<ArrowRight size={14} aria-hidden="true" /></a> : null}
  </div>;
}

const RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** To do (F2.4-13): each todo says what it belongs to and how much it matters; edit, delete, tie it with #REF. */
export function TodoBoard({ todos }: { todos: TodoAction[] }) {
  const w = useShareWords(); const { lang } = useT(); const refresh = useRefresh();
  const [group, setGroup] = useState(false); const [text, setText] = useState(''); const [editing, setEditing] = useState<string | null>(null);
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => post('/api/action/update', body), onSuccess: refresh, onError: (e) => toast((e as Error).message, 'err') });
  const remove = useMutation({ mutationFn: (id: string) => post('/api/action/delete', { id }), onSuccess: refresh, onError: (e) => toast((e as Error).message, 'err') });
  const add = useMutation({
    mutationFn: async () => {
      let raw = text.trim(); const high = raw.startsWith('!'); if (high) raw = raw.slice(1).trim();
      const ref = raw.match(/(?:^|\s)#([A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7})\b/)?.[1];
      if (ref) raw = raw.replace(`#${ref}`, '').replace(/\s+/g, ' ').trim();
      const spotted = (await get<{ action: { text: string; kind: string; due?: string; who?: string } | null }>('/api/actions/detect', { text: raw }).catch(() => ({ action: null }))).action;
      const body = spotted && spotted.kind === 'todo' ? { text: spotted.text, kind: 'todo', ...(spotted.due ? { due: spotted.due } : {}) } : { text: raw, kind: 'todo' };
      return post('/api/actions', { ...body, ...(ref ? { workRef: ref } : {}), importance: high ? 'high' : 'medium' });
    },
    onSuccess: () => { setText(''); refresh(); }, onError: (e) => toast((e as Error).message, 'err'),
  });
  const sorted = [...todos].sort((a, b) => RANK[a.importance ?? 'medium'] - RANK[b.importance ?? 'medium']);
  const groups = group ? [...new Map(sorted.map((a) => [a.work?.ref ?? '', a.work ? `${a.work.ref} · ${a.work.title}` : w('Personnelles', 'Personal')])).entries()] : [['', '']];
  return <div>
    <div className="tk-board-head"><div className="segmented" role="group" aria-label={w('Ordre des todos', 'Todo order')}><button type="button" aria-pressed={!group} onClick={() => setGroup(false)}>{w('Par importance', 'By importance')}</button><button type="button" aria-pressed={group} onClick={() => setGroup(true)}>{w('Par ticket', 'By ticket')}</button></div></div>
    {todos.length ? groups.map(([key, label]) => <div key={key || 'all'}>
      {group ? <p className="tk-grp">{key ? <a href={hrefFor({ name: 'tickets', ref: key })}>{label}</a> : label}</p> : null}
      <ul className="tk-todos">{sorted.filter((a) => !group || (a.work?.ref ?? '') === key).map((a) => <li key={a.id}>
        <input type="checkbox" onChange={() => update.mutate({ id: a.id, status: 'done' })} aria-label={`${w('Terminer', 'Finish')} : ${a.text}`} />
        <ImportanceBars value={a.importance ?? 'medium'} onChange={(v) => update.mutate({ id: a.id, importance: v })} />
        <div>{editing === a.id ? <Editable value={a.text} label={w('Texte de la todo', 'Todo text')} maxLength={300} startOpen onClose={() => setEditing(null)} onSave={(v) => { update.mutate({ id: a.id, text: v }); }} /> : <><div className="t">{a.text}</div><div className="c">{a.work ? <a className="link" href={hrefFor({ name: 'tickets', ref: a.work.ref })}>{a.work.ref}</a> : a.project ? a.project.title : w('personnelle', 'personal')}{a.due ? ` · ${new Date(a.due).toLocaleDateString(lang, { weekday: 'long' })}` : ''}{a.source === 'ai' ? ` · ${w('par l’agent', 'by the agent')}` : ''}</div></>}</div>
        <div className="tk-tools"><button type="button" className="tk-ib" onClick={() => setEditing(a.id)} aria-label={`${w('Modifier', 'Edit')} : ${a.text}`}><Pencil size={16} aria-hidden="true" /></button><button type="button" className="tk-ib" onClick={() => remove.mutate(a.id)} aria-label={`${w('Supprimer', 'Delete')} : ${a.text}`}><Trash2 size={16} aria-hidden="true" /></button></div>
      </li>)}</ul>
    </div>) : <p className="muted small" style={{ margin: '4px 18px' }}>{w('Rien à faire pour l’instant.', 'Nothing to do for now.')}</p>}
    <form className="tk-add" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !add.isPending) add.mutate(); }}><Plus size={16} aria-hidden="true" className="muted" /><input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={w('Une chose à faire · #DEMO-42 pour la rattacher · ! pour importance haute', 'Something to do · #DEMO-42 to tie it · ! for high importance')} aria-label={w('Ajouter une chose à faire', 'Add something to do')} /><kbd aria-hidden="true">↵</kbd></form>
  </div>;
}

/** What the person asked their agent and is still open (F2.4-10). */
export function Requests({ requests }: { requests: PendingRequest[] }) {
  const w = useShareWords(); const { lang } = useT();
  const copy = async (id: string) => { const { prompt } = await get<{ prompt: string }>('/api/ticket/requests/prompt', { id, lang: lang === 'en' ? 'en' : 'fr' }); await navigator.clipboard?.writeText(prompt).catch(() => undefined); toast(w('Prompt copié.', 'Prompt copied.')); };
  if (!requests.length) return null;
  return <section className="tk-card" aria-labelledby="tk-req-h"><div className="tk-card-h"><h2 id="tk-req-h">{w('Demandes à l’agent', 'Requests to the agent')}</h2><span className="aside">{w('traitées à ta prochaine session', 'handled at your next session')}</span></div>
    <div className="tk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{requests.map((r) => <div className="tk-pending" key={r.id}><Hourglass size={16} aria-hidden="true" /><div className="grow"><a className="link" href={hrefFor({ name: 'tickets', ref: r.ref })}><b>{r.ref}</b></a> · {r.fields.length} {w(r.fields.length > 1 ? 'champs' : 'champ', r.fields.length > 1 ? 'fields' : 'field')}<br /><span className="meta">{new Date(r.since).toLocaleDateString(lang)}</span></div><button type="button" className="tk-link-btn" onClick={() => void copy(r.id)}>{w('Copier le prompt', 'Copy the prompt')}</button></div>)}</div>
  </section>;
}
