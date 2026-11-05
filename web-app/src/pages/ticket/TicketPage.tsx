import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, CircleCheck, CircleHelp, Copy, Ellipsis, FolderGit2, Hourglass, Link2, Pencil, Pin, PinOff, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get } from '../../app/api';
import { useT } from '../../app/i18n';
import { go, hrefFor } from '../../app/router';
import { useShareWords } from '../../app/sharing';
import { DIMENSION_WORDS, RUBRIC_WORDS, STATE_WORDS, type DocumentedSheet, type JourneyStep, type TicketSheet, type TicketView } from '../../app/tickets';
import { toast } from '../../app/toast';
import { ConfirmDialog } from '../../ui/Confirm';
import { ErrorState, SkeletonRows } from '../../ui/States';
import { WorkAssistant } from '../../ui/WorkAssistant';
import '../../styles/ticket.css';
import { Attempts, Criteria, External, Reuses, StartTicket, StateEditor, TicketDocuments } from '../Tickets';
import { Brief30, Details, History, LinkedNotes, Pending, Todos, useAsk } from './panels';
import { Editable, TkRing, useSheetWrite } from './parts';
import { Story } from './Story';
import '../../styles/work.css';

const STEP_NAME: Record<JourneyStep['id'], readonly [string, string]> = { understood: ['Compris', 'Understood'], work: DIMENSION_WORDS.work, pr: DIMENSION_WORDS.pr, checks: DIMENSION_WORDS.checks, delivery: DIMENSION_WORDS.delivery };
const DIMENSION_OF: Partial<Record<JourneyStep['id'], string>> = { work: 'work', pr: 'pr', checks: 'checks', delivery: 'delivery' };

/** The journey in one line: done, in progress, waiting, or unknown — never a merge taken for a delivery. */
function Journey({ sheet, onDeclare }: { sheet: TicketSheet; onDeclare: (dimension: string) => void }) {
  const w = useShareWords();
  return <nav className="tk-journey" aria-label={w('Parcours du ticket', 'Ticket journey')}>{sheet.journey.map((s) => {
    const name = w(...STEP_NAME[s.id]);
    const value = s.id === 'understood' ? `${w('Contexte', 'Context')} ${s.label} %` : s.state === 'unknown' ? w('Inconnu', 'Unknown') : w(...(STATE_WORDS[s.label.split(' · ')[0]!] ?? [s.label, s.label])) + (s.label.includes(' · ') ? ` · ${s.label.split(' · ')[1]}` : '');
    const icon = s.state === 'done' ? <CircleCheck size={16} aria-hidden="true" /> : s.state === 'now' ? <span className="tk-pulse" aria-hidden="true" /> : s.state === 'wait' ? <Hourglass size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />;
    const src = s.id === 'understood' ? (s.state === 'done' ? w('assez pour reprendre', 'enough to resume') : w('à compléter', 'to complete')) : s.state === 'unknown' ? `+ ${w('Déclarer', 'Declare')}` : s.source ? `${s.source === 'person' ? w('toi', 'you') : s.source}${s.at ? ` · ${new Date(s.at).toLocaleDateString()}` : ''}` : '';
    const act = () => (s.id === 'understood' ? document.getElementById('tk-brief-h')?.scrollIntoView({ behavior: 'smooth' }) : onDeclare(DIMENSION_OF[s.id]!));
    return <button type="button" key={s.id} className={`tk-step ${s.state}`} onClick={act} aria-label={`${name} : ${value}. ${s.id === 'understood' ? '' : w('Déclarer cet état', 'Declare this state')}`}><span className="seg" aria-hidden="true" /><span className="name">{name}</span><span className="val">{icon}{value}</span><span className="src">{src}</span></button>;
  })}</nav>;
}

function Menu({ sheet, onRename, onClose }: { sheet: TicketSheet; onRename: () => void; onClose: () => void }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const { lang } = useT();
  const [unfollow, setUnfollow] = useState(false); const [source, setSource] = useState(false); const [url, setUrl] = useState(sheet.external?.url ?? '');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector('button')?.focus(); const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', esc); return () => removeEventListener('keydown', esc); }, [onClose]);
  const copy = async () => { const open = sheet.requests[0] ?? await write.mutateAsync({ path: '/api/ticket/requests', body: { fields: [] } }) as { id: string }; const { prompt } = await get<{ prompt: string }>('/api/ticket/requests/prompt', { id: open.id, lang: lang === 'en' ? 'en' : 'fr' }); await navigator.clipboard?.writeText(prompt).catch(() => undefined); toast(w('Prompt copié.', 'Prompt copied.')); onClose(); };
  return <div className="tk-pop" ref={box} role="menu" aria-label={w('Actions du ticket', 'Ticket actions')}>
    <button type="button" role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={16} aria-hidden="true" />{w('Renommer', 'Rename')}</button>
    <button type="button" role="menuitem" aria-expanded={source} onClick={() => setSource(!source)}><Link2 size={16} aria-hidden="true" />{w('Changer le lien source', 'Change the source link')}</button>
    {source ? <form className="tk-add" style={{ margin: '4px 6px 8px' }} onSubmit={(e) => { e.preventDefault(); write.mutate({ path: '/api/ticket/source', body: { provider: /servicenow|service-now/i.test(url) ? 'servicenow' : /jira|atlassian|browse\//i.test(url) ? 'jira' : 'other', url } }, { onSuccess: onClose }); }}><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/browse/ABC-42" aria-label={w('Lien du ticket dans sa source', 'Ticket link in its source')} required /><button className="btn sm" type="submit">{w('Garder', 'Keep')}</button></form> : null}
    <button type="button" role="menuitem" onClick={() => void copy()}><Copy size={16} aria-hidden="true" />{w('Copier le prompt « compléter ce ticket »', 'Copy the « complete this ticket » prompt')}</button>
    <button type="button" role="menuitem" onClick={() => { write.mutate({ path: '/api/ticket/pin', body: { pinned: !sheet.pinned } }); onClose(); }}>{sheet.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}{sheet.pinned ? w('Ne plus épingler sur l’accueil', 'Unpin from Today') : w('Épingler sur l’accueil', 'Pin on Today')}</button>
    <button type="button" role="menuitem" onClick={() => { document.getElementById('tk-more')?.setAttribute('open', ''); document.getElementById('tk-more')?.scrollIntoView({ behavior: 'smooth' }); onClose(); }}><FolderGit2 size={16} aria-hidden="true" />{w('Critères, essais et sources', 'Criteria, attempts and sources')}</button>
    <hr />
    <button type="button" role="menuitem" className="danger" onClick={() => setUnfollow(true)}><Trash2 size={16} aria-hidden="true" /><span className="grow">{w('Arrêter de suivre', 'Stop following')}</span><span className="meta">{w('les notes restent', 'notes stay')}</span></button>
    <ConfirmDialog open={unfollow} onOpenChange={setUnfollow} danger title={w('Arrêter de suivre ce ticket ?', 'Stop following this ticket?')} confirm={w('Arrêter de suivre', 'Stop following')} onConfirm={async () => {
      await write.mutateAsync({ path: '/api/ticket/unfollow' });
      toast(w('Ticket retiré du suivi. Tu peux l’annuler pendant 30 jours : okb ticket restore ', 'Ticket no longer followed. You can undo it for 30 days: okb ticket restore ') + sheet.ref);
      go({ name: 'tickets' });
    }}><p>{w('Sa fiche, ses todos, ses demandes et ses liaisons disparaissent du suivi. Ses notes restent dans ta mémoire. Une copie est gardée 30 jours pour annuler.', 'Its sheet, todos, requests and links leave the follow-up. Its notes stay in your memory. A copy is kept 30 days to undo.')}</p></ConfirmDialog>
  </div>;
}

function Documented({ sheet }: { sheet: DocumentedSheet }) {
  const w = useShareWords();
  return <div className="page tk">
    <a className="link" href={hrefFor({ name: 'tickets' })}><ArrowLeft size={15} aria-hidden="true" />{w('Tous mes tickets', 'All my tickets')}</a>
    <h1 className="tk-title unset">{sheet.ref}</h1>
    <div className="tk-banner" role="status"><Hourglass size={18} aria-hidden="true" /><span className="grow">{w('Documenté dans tes notes, pas encore suivi. Suis-le pour avoir sa fiche, ses todos et sa reprise.', 'Documented in your notes, not followed yet. Follow it to get its sheet, todos and resumption.')}</span></div>
    <section className="tk-card"><div className="tk-card-h"><h2>{w('Suivre ce ticket', 'Follow this ticket')}</h2></div><div className="tk-card-b"><StartTicket initialRef={sheet.ref} /></div></section>
    <section className="tk-card"><div className="tk-card-h"><h2>{w('Notes liées', 'Linked notes')}</h2></div><ul className="tk-notes">{sheet.links.map((l) => <li key={l.path}><span className="mark" aria-hidden="true" /><a className="nt" href={hrefFor({ name: 'brain', path: l.path })}>{l.title ?? l.path}</a></li>)}</ul><div style={{ height: 14 }} /></section>
  </div>;
}

export function TicketPage({ refId, setTitle }: { refId: string; setTitle?: (s: string) => void }) {
  const w = useShareWords();
  const q = useQuery({ queryKey: ['sheet', refId], queryFn: () => get<TicketSheet | DocumentedSheet>('/api/ticket/sheet', { ref: refId }) });
  const followed = q.data?.followed === true;
  const view = useQuery({ queryKey: ['ticket', refId], queryFn: () => get<TicketView>('/api/ticket', { ref: refId }), enabled: followed });
  const write = useSheetWrite(refId); const ask = useAsk(refId);
  const [menu, setMenu] = useState(false); const [tab, setTab] = useState<'sheet' | 'story'>('sheet'); const [renaming, setRenaming] = useState(false); const [declaring, setDeclaring] = useState<string | null>(null);
  const sheet = followed ? q.data as TicketSheet : null;
  const title = sheet?.title?.value ?? null;
  useEffect(() => { if (q.data) setTitle?.(`${q.data.ref}${title ? ` · ${title}` : ''}`); }, [q.data?.ref, title, setTitle]);
  if (q.isLoading) return <div className="page"><SkeletonRows /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (!sheet) return <Documented sheet={q.data as DocumentedSheet} />;
  const missing = sheet.completeness.missing.filter((m) => !['next', 'repo'].includes(m));
  const branch = sheet.repos.find((r) => r.branch)?.branch;
  const declared = declaring ? sheet.states.find((s) => s.dimension === declaring && (declaring !== 'delivery' || s.environment === 'production')) : undefined;
  return <div className="page tk">
    <a className="link" href={hrefFor({ name: 'tickets' })}><ArrowLeft size={15} aria-hidden="true" />{w('Tous mes tickets', 'All my tickets')}</a>
    <div className="tk-top">
      <div className="grow">
        <div className="tk-ref"><span>{sheet.ref}</span>{sheet.external?.url ? <><span aria-hidden="true">·</span><a href={sheet.external.url} target="_blank" rel="noreferrer">{w('ouvrir dans ', 'open in ')}{sheet.external.provider === 'servicenow' ? 'ServiceNow' : sheet.external.provider === 'jira' ? 'Jira' : w('la source', 'the source')}<ArrowUpRight size={14} aria-hidden="true" /></a></> : null}{sheet.repos.map((r) => <span key={r.id}><span aria-hidden="true">· </span>{r.id}</span>)}{branch ? <span><span aria-hidden="true">· </span>{w('branche ', 'branch ')}{branch}</span> : null}</div>
        {title && !renaming ? <h1 className="tk-title" style={{ marginLeft: 0, padding: 0 }}><Editable value={title} label={w('Titre du ticket', 'Ticket title')} maxLength={200} onSave={async (v) => { await write.mutateAsync({ path: '/api/ticket/rename', body: { title: v } }); }}>{title}</Editable></h1>
          : <h1 className={`tk-title${renaming ? '' : ' unset'}`} style={{ marginLeft: 0, padding: 0 }}><Editable value={title ?? ''} label={w('Titre du ticket', 'Ticket title')} maxLength={200} startOpen={renaming} onClose={() => setRenaming(false)} onSave={async (v) => { await write.mutateAsync({ path: '/api/ticket/rename', body: { title: v } }); }}>{w('Titre non défini', 'Title not set')}</Editable></h1>}
      </div>
      <div className="tk-actions">
        <button type="button" className="tk-ring-btn" onClick={() => document.getElementById('tk-details-h')?.scrollIntoView({ behavior: 'smooth' })} aria-label={`${w('Contexte renseigné', 'Context filled')} ${sheet.completeness.percent} %. ${missing.length ? `${w('Manque', 'Missing')} : ${missing.map((m) => w(...(RUBRIC_WORDS[m] ?? [m, m]))).join(', ')}` : ''}`}>
          <TkRing percent={sheet.completeness.percent} /><span className="lab"><b>{sheet.completeness.percent} % {w('renseigné', 'filled')}</b><small>{missing.length ? `${missing.length} ${w(missing.length > 1 ? 'rubriques manquent' : 'rubrique manque', missing.length > 1 ? 'items missing' : 'item missing')}` : w('rien ne manque', 'nothing missing')}</small></span>
        </button>
        {missing.length ? <button type="button" className="btn sm" onClick={() => void ask([])}><Sparkles size={16} aria-hidden="true" />{w('Compléter avec l’agent', 'Complete with the agent')}</button> : null}
        <button type="button" className="btn sm icon" aria-haspopup="menu" aria-expanded={menu} aria-label={w('Plus d’actions', 'More actions')} onClick={() => setMenu(!menu)}><Ellipsis size={16} aria-hidden="true" /></button>
        {menu ? <Menu sheet={sheet} onRename={() => setRenaming(true)} onClose={() => setMenu(false)} /> : null}
      </div>
    </div>
    <Journey sheet={sheet} onDeclare={setDeclaring} />
    {declaring ? <section className="tk-card"><div className="tk-card-h"><h2>{w('Déclarer : ', 'Declare: ')}{w(...(DIMENSION_WORDS as Record<string, readonly [string, string]>)[declaring]!)}</h2><button type="button" className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setDeclaring(null)}>{w('Fermer', 'Close')}</button></div><div className="tk-card-b"><StateEditor key={declaring} refId={sheet.ref} {...(declared ? { state: declared } : {})} done={() => setDeclaring(null)} /></div></section> : null}
    <WorkAssistant kind="ticket" refId={sheet.ref} title={`${sheet.ref}${title ? ` · ${title}` : ''}`} />
    <div className="segmented" role="tablist" aria-label={w('Vues du ticket', 'Ticket views')}>
      <button type="button" role="tab" aria-selected={tab === 'sheet'} aria-pressed={tab === 'sheet'} onClick={() => setTab('sheet')}>{w('Fiche', 'Sheet')}</button>
      <button type="button" role="tab" aria-selected={tab === 'story'} aria-pressed={tab === 'story'} onClick={() => setTab('story')}>{w('Comment je l’ai résolu', 'How I solved it')}</button>
    </div>
    {tab === 'story' ? <Story sheet={sheet} /> : <div className="tk-cols">
      <div className="tk-col"><Brief30 sheet={sheet} /><Todos sheet={sheet} /><LinkedNotes sheet={sheet} /></div>
      <aside className="tk-col"><Details sheet={sheet} declare={setDeclaring} /><Pending sheet={sheet} /><History sheet={sheet} /></aside>
    </div>}
    <details className="panel repo-secondary" id="tk-more"><summary>{w('Plus de détails : critères de fin, essais, sources externes, réutilisations', 'More details: exit criteria, attempts, external sources, reuse')}</summary>
      {view.data ? <div className="grid-2"><div className="stack lg"><Criteria view={view.data} /><Reuses view={view.data} /></div><div className="stack lg"><Attempts view={view.data} /><External view={view.data} /><TicketDocuments refId={sheet.ref} /></div></div> : view.error ? <ErrorState error={view.error} /> : <SkeletonRows />}
    </details>
  </div>;
}
