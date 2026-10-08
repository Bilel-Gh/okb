import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileDiff, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { currentSession, get, post } from '../app/api';
import { useCategories } from '../app/data';
import { useT } from '../app/i18n';
import { hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { Waiting } from './Today';

type ProposalItem = { id: string; number: number | null; title: string; status: string; createdAt: string; files: number; created: number; updated: number; changes: number };
type ProposalDetail = {
  id: string; number: number | null; title: string; status: string; createdAt: string; approvalCommand: string;
  notes: string[]; contradictions: unknown[];
  guard: { ok: boolean; violations: { message?: string; code?: string }[] };
  files: { path: string; created: boolean; html: string; diff: string; stats: { added: number; removed: number }; noteCategory: string }[];
  evidence: { id: string; quote: string }[];
};

function Diff({ text }: { text: string }) {
  return (
    <pre className="diff" aria-label="diff">
      {text.split('\n').map((line, i) => {
        const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '';
        return <span key={i} className={kind ? `d-${kind}` : undefined}>{line || ' '}{'\n'}</span>;
      })}
    </pre>
  );
}

function ProposalView({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const cats = useCategories();
  const p = useQuery({ queryKey: ['proposal', id], queryFn: () => get<ProposalDetail>('/api/proposal', { id }) });
  const [view, setView] = useState<'preview' | 'diff'>('preview');
  const presence = (currentSession() as { presence?: string } | null)?.presence ?? 'none';
  const approve = useMutation({
    mutationFn: (apply: boolean) => post<{ ok: boolean; presence?: string; applied?: boolean; receipt?: { results: { action: string }[] } }>('/api/proposal/approve', { id, apply }),
    onSuccess: (r) => {
      if (!r.ok) { toast(r.presence === 'refused' ? t('web.review.refused') : t('web.review.noPresence'), 'err'); return; }
      toast(r.applied ? t('app.inbox.applied', { n: r.receipt?.results.length ?? 0 }) : t('review.approvedShort'));
      void qc.invalidateQueries();
      window.location.hash = hrefFor({ name: 'inbox' }).slice(1);
    },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const discard = useMutation({
    mutationFn: () => post('/api/proposal/discard', { id }),
    onSuccess: () => { toast(t('review.discarded')); void qc.invalidateQueries(); window.location.hash = hrefFor({ name: 'inbox' }).slice(1); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  if (p.isLoading) return <SkeletonRows rows={8} />;
  if (p.error || !p.data) return <ErrorState error={p.error} retry={() => void p.refetch()} />;
  const d = p.data;
  const pending = d.status === 'prepared';
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={hrefFor({ name: 'inbox' })}><ArrowLeft size={16} aria-hidden="true" />{t('app.inbox.back')}</a>
      <div className="page-head"><h2>{d.title}</h2><span className="pill">{t(`app.inbox.status.${d.status}`)}</span></div>
      {!d.guard.ok ? <div className="notice warn" role="alert">{t('app.inbox.guard')} {d.guard.violations.map((v) => v.message ?? v.code).join(' · ')}</div> : null}
      {d.notes.length ? <ul className="small muted">{d.notes.slice(0, 6).map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {pending ? (
        <div className="panel"><div className="panel-body row wrap" style={{ justifyContent: 'space-between' }}>
          <p className="small">{presence === 'none' ? t('web.review.useTerminal') : t('app.inbox.approveWhy')}</p>
          {presence === 'none' ? <code className="cmd">{d.approvalCommand}</code> : (
            <div className="row">
              <button type="button" className="btn danger sm" disabled={discard.isPending} onClick={() => { if (window.confirm(t('review.discard.q'))) discard.mutate(); }}><Trash2 size={14} aria-hidden="true" />{t('review.action.discard')}</button>
              <button type="button" className="btn sm" disabled={approve.isPending} onClick={() => approve.mutate(false)}>{t('review.action.approveOnly')}</button>
              <button type="button" className="btn primary" disabled={approve.isPending || !d.guard.ok} aria-busy={approve.isPending} onClick={() => approve.mutate(true)}><Check size={16} aria-hidden="true" />{approve.isPending ? t('app.inbox.waiting') : t('review.action.apply')}</button>
            </div>
          )}
        </div></div>
      ) : null}
      {d.files.length ? (
        <>
          <div className="segmented" role="group" aria-label={t('app.inbox.view')} style={{ alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>{t('app.inbox.preview')}</button>
            <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>{t('app.inbox.diff')}</button>
          </div>
          {d.files.map((f) => (
            <section key={f.path} className="panel" style={{ '--line': cats.color(f.noteCategory) } as CSSProperties}>
              <div className="panel-head">
                <span className="station sm" aria-hidden="true" />
                <h3 className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</h3>
                <span className="spacer" />
                <span className={`pill ${f.created ? 'ok' : 'info'}`}>{f.created ? t('app.inbox.new') : t('app.inbox.changed')}</span>
                <span className="xs num"><span style={{ color: 'var(--add-ink)' }}>+{f.stats.added}</span> <span style={{ color: 'var(--del-ink)' }}>−{f.stats.removed}</span></span>
              </div>
              <div className="panel-body">{view === 'diff' ? <Diff text={f.diff} /> : <article className="prose" dangerouslySetInnerHTML={{ __html: f.html }} />}</div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}

export default function InboxPage({ route }: { route: Extract<Route, { name: 'inbox' }> }) {
  const t = useT();
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: ProposalItem[] }>('/api/proposals') });
  if (route.id) return <div className="page"><ProposalView id={route.id} /></div>;
  const pending = (proposals.data?.proposals ?? []).filter((p) => p.status === 'prepared');
  const done = (proposals.data?.proposals ?? []).filter((p) => p.status !== 'prepared').slice(0, 8);
  return (
    <div className="page">
      <p className="muted" style={{ maxWidth: '72ch' }}>{t('app.inbox.intro')}</p>
      <section className="panel" aria-labelledby="cards-h">
        <div className="panel-head"><h2 id="cards-h">{t('app.inbox.cards')}</h2></div>
        <div style={{ paddingTop: 'var(--s2)' }}><Waiting /></div>
      </section>
      <section className="panel" aria-labelledby="done-h">
        <div className="panel-head"><h2 id="done-h">{t('app.inbox.history')}</h2></div>
        {proposals.isLoading ? <SkeletonRows rows={3} /> : done.length || pending.length ? (
          <ul className="rows" style={{ paddingTop: 'var(--s2)' }}>
            {done.map((p) => (
              <li key={p.id}>
                <FileDiff size={18} aria-hidden="true" className="muted" />
                <div className="grow"><a className="title" href={hrefFor({ name: 'inbox', tab: 'proposals', id: p.id })}>{p.title}</a><span className="meta">{new Date(p.createdAt).toLocaleString(t.lang)} · {t(`app.inbox.status.${p.status}`)}</span></div>
              </li>
            ))}
          </ul>
        ) : <Empty title={t('app.inbox.historyEmpty')} />}
      </section>
    </div>
  );
}
