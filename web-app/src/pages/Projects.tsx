import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleHelp, Compass, Flag, FolderGit2, FolderKanban, Hourglass, ListTodo, LogOut, NotebookPen, Paperclip, Plus, Share2, Ticket, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { currentKb, currentSession, get, post } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { useShareWords } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { ActionList, JournalList, useRefreshDay, type Action, type Entry, type LeftOff } from './day-parts';
import { KeepFileButton } from '../ui/KeepFile';
import { DocumentRows, type Doc } from './Documents';

export type Project = {
  id: string; module: string; kind: string; title: string; status: 'active' | 'waiting' | 'done';
  where: string; next: string; ref: string | null; folder: string | null; leftOff: LeftOff | null; createdAt: string; updatedAt: string;
};
type Status = Project['status'];

/** A project's kind, as an icon in a tinted square: a subject of the person, or what a module brings. */
const KINDS: Record<string, { icon: LucideIcon; color: string }> = {
  subject: { icon: Compass, color: 'var(--c-p2)' },
  ticket: { icon: Ticket, color: 'var(--c-p1)' },
  repo: { icon: FolderGit2, color: 'var(--c-p3)' },
};
export function KindMark({ kind, size = '' }: { kind: string; size?: '' | 'sm' | 'lg' }) {
  const k = KINDS[kind] ?? KINDS.subject!;
  const Icon = k.icon;
  return <span className={`cat ${size}`} style={{ '--c': k.color } as CSSProperties} aria-hidden="true"><Icon size={size === 'sm' ? 14 : 17} /></span>;
}

const ago = (iso: string, lang: string): string => {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
};

function NewProject({ onDone }: { onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () => post<Project>('/api/projects', { title }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['projects'] }); go({ name: 'projects', id: p.id }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  return (
    <form className="panel project-new" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
      <label className="field"><span className="label">{t('app.projects.newTitle')}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('app.projects.newPlaceholder')} autoFocus maxLength={200} />
      </label>
      <div className="row"><button type="submit" className="btn primary" disabled={!title.trim() || create.isPending}>{t('app.projects.create')}</button><button type="button" className="btn ghost" onClick={onDone}>{t('app.cancel')}</button></div>
    </form>
  );
}

function List() {
  const t = useT();
  const [status, setStatus] = useState<'open' | 'waiting' | 'done'>('open');
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['projects', 'all'], queryFn: () => get<{ projects: Project[] }>('/api/projects', { status: 'all' }) });
  if (q.isLoading) return <div className="page"><SkeletonRows rows={5} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const all = q.data.projects;
  const count = (s: typeof status) => all.filter((p) => (s === 'open' ? p.status === 'active' : p.status === s)).length;
  const shown = all.filter((p) => (status === 'open' ? p.status === 'active' : p.status === status));
  return (
    <div className="page">
      <div className="page-head">
        <div className="segmented" role="group" aria-label={t('app.projects.filter')}>
          {(['open', 'waiting', 'done'] as const).map((s) => <button type="button" key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{t(`app.projects.filter.${s}`)}<span className="n">{count(s)}</span></button>)}
        </div>
        <span className="spacer" />
        {adding ? null : <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{t('app.projects.new')}</button>}
      </div>
      {adding ? <NewProject onDone={() => setAdding(false)} /> : null}
      {shown.length ? (
        <section className="panel">
          <ul className="rows project-rows">
            {shown.map((p) => (
              <li key={p.id} className="link-row">
                <a href={hrefFor({ name: 'projects', id: p.id })}>
                  <KindMark kind={p.kind} />
                  <span className="grow"><span className="title">{p.title}</span><span className="meta">{t(`app.projects.kind.${KINDS[p.kind] ? p.kind : 'subject'}`)}{p.ref && p.ref !== p.title ? ` · ${p.ref}` : ''}</span></span>
                  <span className="project-now">{p.where ? <span>{p.where}</span> : <span className="muted">{t('app.projects.noWhere')}</span>}{p.next ? <span className="meta"><ArrowRight size={13} aria-hidden="true" />{p.next}</span> : null}</span>
                  <span className="meta project-when">{ago(p.updatedAt, t.lang)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : all.length ? (
        <section className="panel"><Empty icon={<FolderKanban size={22} />} title={t(`app.projects.none.${status}`)} /></section>
      ) : (
        <section className="panel"><Empty icon={<FolderKanban size={22} />} title={t('app.projects.emptyTitle')} action={adding ? undefined : <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{t('app.projects.new')}</button>}>{t('app.projects.emptyText')}</Empty></section>
      )}
    </div>
  );
}

/** A line the person edits in place: saved when they leave it or press Enter. */
function EditLine({ value, placeholder, label, onSave, multiline = false }: { value: string; placeholder: string; label: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text.trim() !== value) onSave(text.trim()); };
  const common = { className: 'input project-line', value: text, placeholder, 'aria-label': label, onBlur: commit, maxLength: multiline ? 400 : 300 };
  return multiline
    ? <textarea {...common} rows={2} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
    : <input {...common} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** « Où j'en étais »: prepared when the person leaves the project, corrected by them, found again when they come back. */
function LeftOffCard({ project }: { project: Project }) {
  const t = useT();
  const refresh = useRefreshDay();
  const leave = useMutation({
    mutationFn: (edit: Partial<Pick<LeftOff, 'done' | 'tried' | 'waiting' | 'resume'>>) => post<Project>('/api/project/leave', { id: project.id, ...edit }),
    onSuccess: refresh, onError: (e) => toast((e as Error).message, 'err'),
  });
  const left = project.leftOff;
  if (!left) return null;
  const when = new Date(left.at).toLocaleString(t.lang, { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  const fields = ['done', 'tried', 'waiting', 'resume'] as const;
  return (
    <section className="panel" aria-labelledby="left-off">
      <div className="panel-head"><h2 id="left-off"><Flag size={17} aria-hidden="true" />{t('app.leftOff.title')}</h2><span className="muted small">{t(left.edited ? 'app.leftOff.whenEdited' : 'app.leftOff.when', { when })}</span></div>
      <div className="left-off">
        {fields.map((f) => (
          <div className="field" key={f}><span className="label">{t(`app.leftOff.${f}`)}</span>
            <EditLine multiline value={left[f]} label={t(`app.leftOff.${f}`)} placeholder={t('app.leftOff.nothing')} onSave={(v) => leave.mutate({ [f]: v })} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Detail({ id, setTitle }: { id: string; setTitle?: (s: string) => void }) {
  const t = useT();
  const w = useShareWords();
  const qc = useQueryClient();
  const refresh = useRefreshDay();
  const q = useQuery({ queryKey: ['project', id], queryFn: () => get<{ project: Project }>('/api/project', { id }) });
  const actions = useQuery({ queryKey: ['actions', id], queryFn: () => get<{ actions: Action[] }>('/api/actions', { project: id }) });
  const entries = useQuery({ queryKey: ['entries', id], queryFn: () => get<{ entries: Entry[] }>('/api/entries', { project: id, limit: 80 }) });
  const docs = useQuery({ queryKey: ['documents', 'project', id], queryFn: () => get<{ documents: Doc[] }>('/api/documents', { project: id }) });
  const p = q.data?.project;
  useEffect(() => { if (p) setTitle?.(p.title); }, [p, setTitle]);
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<Project, 'title' | 'status' | 'where' | 'next'>>) => post<Project>('/api/project/update', { id, ...patch }),
    onSuccess: (next) => { qc.setQueryData(['project', id], { project: next }); void qc.invalidateQueries({ queryKey: ['projects'] }); void qc.invalidateQueries({ queryKey: ['today'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const leave = useMutation({
    mutationFn: () => post<Project>('/api/project/leave', { id }),
    onSuccess: () => { refresh(); toast(t('app.leftOff.prepared')); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  if (q.isLoading) return <div className="page"><SkeletonRows rows={5} /></div>;
  if (q.error || !p) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const statuses: Status[] = ['active', 'waiting', 'done'];
  const open = actions.data?.actions ?? [];
  return (
    <div className="page">
      <section className="panel">
        <div className="project-head">
          <KindMark kind={p.kind} size="lg" />
          <div className="grow">
            <h2>{p.title}</h2>
            <p className="meta">{t(`app.projects.kind.${KINDS[p.kind] ? p.kind : 'subject'}`)}{p.ref && p.ref !== p.title ? ` · ${p.ref}` : ''} · {ago(p.updatedAt, t.lang)}</p>
          </div>
          <div className="segmented" role="group" aria-label={t('app.projects.status')}>
            {statuses.map((s) => <button type="button" key={s} aria-pressed={p.status === s} onClick={() => { if (p.status !== s) update.mutate({ status: s }); }}>{t(`app.projects.status.${s}`)}</button>)}
          </div>
          <button type="button" className="btn" onClick={() => leave.mutate()} disabled={leave.isPending} title={t('app.leftOff.leaveWhy')}><LogOut size={15} aria-hidden="true" />{t('app.leftOff.leave')}</button>
          {p.folder && currentSession()?.kbs.find((k) => k.id === currentKb())?.space === 'work' ? <a className="btn sm" href={hrefFor({ name: 'sharing', path: p.folder })}><Share2 size={15} aria-hidden="true" />{w('Partager les notes', 'Share the notes')}</a> : null}
        </div>
        <div className="project-lines">
          <div className="field"><span className="label">{t('app.projects.where')}</span><EditLine multiline value={p.where} label={t('app.projects.where')} placeholder={t('app.projects.wherePlaceholder')} onSave={(where) => update.mutate({ where })} /></div>
          <div className="field"><span className="label">{t('app.projects.next')}</span><EditLine value={p.next} label={t('app.projects.next')} placeholder={t('app.projects.nextPlaceholder')} onSave={(next) => update.mutate({ next })} /></div>
        </div>
        {p.kind === 'repo' && p.ref ? <div className="panel-foot"><a className="btn sm" href={hrefFor({ name: 'repos', id: p.ref })}><FolderGit2 size={15} aria-hidden="true" />{t('app.projects.openRepo')}</a></div> : null}
        {p.kind === 'ticket' && p.ref ? <div className="panel-foot"><a className="btn sm" href={hrefFor({ name: 'tickets', ref: p.ref })}>{w('Reprendre et suivre le ticket', 'Resume and follow the ticket')}</a></div> : null}
      </section>
      <LeftOffCard project={p} />
      <div className="grid-2">
        <div className="stack lg">
          <section className="panel" aria-labelledby="p-todo">
            <div className="panel-head"><h2 id="p-todo"><ListTodo size={17} aria-hidden="true" />{t('app.actions.todo')}</h2></div>
            <div className="panel-body flush"><ActionList kind="todo" project={id} actions={open.filter((a) => a.kind === 'todo' || a.kind === 'asked')} placeholder={t('app.actions.todoPlaceholder')} empty={t('app.actions.todoEmpty')} /></div>
          </section>
          <section className="panel" aria-labelledby="p-journal">
            <div className="panel-head"><h2 id="p-journal"><NotebookPen size={17} aria-hidden="true" />{t('app.journal.title')}</h2></div>
            <div className="panel-body"><JournalList project={id} entries={entries.data?.entries ?? []} empty={t('app.journal.empty')} /></div>
          </section>
        </div>
        <div className="stack lg">
          <section className="panel" aria-labelledby="p-waiting">
            <div className="panel-head"><h2 id="p-waiting"><Hourglass size={17} aria-hidden="true" />{t('app.actions.waiting')}</h2></div>
            <div className="panel-body flush"><ActionList kind="waiting" project={id} actions={open.filter((a) => a.kind === 'waiting')} placeholder={t('app.actions.waitingPlaceholder')} empty={t('app.actions.waitingEmpty')} /></div>
          </section>
          <section className="panel" aria-labelledby="p-docs">
            <div className="panel-head"><h2 id="p-docs"><Paperclip size={17} aria-hidden="true" />{t('app.memory.documents')}</h2><span className="spacer" /><KeepFileButton project={id} small /></div>
            <div className="panel-body flush">{docs.data?.documents.length ? <DocumentRows docs={docs.data.documents} showProject={false} /> : <p className="muted small action-empty" style={{ paddingBottom: 12 }}>{t('app.docs.projectEmpty')}</p>}</div>
          </section>
          <section className="panel" aria-labelledby="p-questions">
            <div className="panel-head"><h2 id="p-questions"><CircleHelp size={17} aria-hidden="true" />{t('app.actions.questions')}</h2></div>
            <div className="panel-body flush"><ActionList kind="question" project={id} actions={open.filter((a) => a.kind === 'question')} placeholder={t('app.actions.questionPlaceholder')} empty={t('app.actions.questionsEmpty')} /></div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function Projects({ route, setTitle }: { route: Extract<Route, { name: 'projects' }>; setTitle?: (s: string) => void }) {
  return route.id ? <Detail id={route.id} setTitle={setTitle} /> : <List />;
}
