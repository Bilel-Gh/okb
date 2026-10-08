import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Clock, FileDiff, GraduationCap, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { get, post } from '../app/api';
import { recentNotes, useCategories } from '../app/data';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

export type Suggestion = {
  id: string; type: string; title: string; why: string; breadcrumb: string; status: string; recommendation: 'create' | 'complete' | 'link' | 'nothing';
  target: string | null; path: string | null; pertinence: { total: number }; cost: { size: string; tokens: number; notes: number }; category: string;
};
type Suggestions = { suggestions: Suggestion[]; budget: { daily: number; spent: number } };
type Proposal = { id: string; number: number | null; title: string; status: string; createdAt: string; files: number; created: number; updated: number };
type Brain = {
  name: string;
  shape: { drawers: { drawer: string; folder: string; label: string; notes: number; subjects: { name: string; notes: number }[] }[] } | null;
  now: { objective: { text: string } | null; tickets: { ref: string; title: string }[]; waiting: { text: string; who: string; days: number }[]; lastSession: { summary: string; next: string | null } | null };
};
type Learn = { counts: { due: number; newLeft: number; cards: number } };

const DRAWER_LINE: Readonly<Record<string, string>> = { inbox: 'var(--ink-3)', world: '#0891b2', subjects: '#2563eb', toolbox: '#059669', activity: '#ca8a04' };

/** The cards and proposals waiting for the person's yes, the first one with the yellow button. */
export function Waiting({ limit }: { limit?: number }) {
  const t = useT();
  const qc = useQueryClient();
  const cats = useCategories();
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Suggestions>('/api/suggestions') });
  const p = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: Proposal[] }>('/api/proposals') });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'accept' | 'later' | 'decline' }) => post('/api/suggestions/decide', v),
    onSuccess: (_r, v) => { toast(t(`app.waiting.done.${v.decision}`)); void qc.invalidateQueries({ queryKey: ['suggestions'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  if (s.isLoading || p.isLoading) return <SkeletonRows rows={3} />;
  if (s.error) return <div className="panel-body"><ErrorState error={s.error} retry={() => void s.refetch()} /></div>;
  const cards = (s.data?.suggestions ?? []).filter((x) => x.status === 'pending' || x.status === 'later');
  const proposals = (p.data?.proposals ?? []).filter((x) => x.status === 'prepared');
  if (!cards.length && !proposals.length) {
    return <Empty title={t('app.waiting.emptyTitle')}>{t('app.waiting.empty')}</Empty>;
  }
  const shownCards = limit ? cards.slice(0, limit) : cards;
  return (
    <ul className="rows" aria-label={t('app.waiting.title')}>
      {proposals.map((x) => (
        <li key={x.id}>
          <FileDiff size={18} aria-hidden="true" className="muted" />
          <div className="grow">
            <a className="title" href={hrefFor({ name: 'inbox', tab: 'proposals', id: x.id })}>{x.title}</a>
            <span className="meta">{t('app.waiting.proposal', { created: x.created, updated: x.updated })}</span>
          </div>
          <a className="btn sm" href={hrefFor({ name: 'inbox', tab: 'proposals', id: x.id })}>{t('app.waiting.read')}<ArrowRight size={14} aria-hidden="true" /></a>
        </li>
      ))}
      {shownCards.map((c, i) => (
        <li key={c.id}>
          <span className="station" style={{ '--line': cats.color(c.category) } as CSSProperties} aria-hidden="true" />
          <div className="grow">
            <span className="title">{c.title}</span>
            <span className="meta">{c.why} · {t(`app.waiting.rec.${c.recommendation}`)} · ≈ {Math.round(c.cost.tokens / 1000)}k tokens{c.status === 'later' ? ` · ${t('app.waiting.later')}` : ''}</span>
          </div>
          <div className="row">
            <button type="button" className={`btn sm${i === 0 && !proposals.length ? ' primary' : ''}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'accept' })}><Check size={14} aria-hidden="true" />{t('app.waiting.accept')}</button>
            <button type="button" className="btn sm ghost icon" title={t('app.waiting.laterBtn')} aria-label={t('app.waiting.laterBtn')} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'later' })}><Clock size={14} aria-hidden="true" /></button>
            <button type="button" className="btn sm ghost icon" title={t('app.waiting.decline')} aria-label={t('app.waiting.decline')} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'decline' })}><X size={14} aria-hidden="true" /></button>
          </div>
        </li>
      ))}
      {limit && cards.length > limit ? <li><a className="btn sm ghost" href={hrefFor({ name: 'inbox', tab: 'suggestions' })}>{t('app.waiting.more', { n: cards.length - limit })}</a></li> : null}
    </ul>
  );
}

function BrainMap({ brain }: { brain: Brain }) {
  const t = useT();
  if (!brain.shape) return null;
  return (
    <ul className="brain-map" aria-label={t('app.today.map')}>
      {brain.shape.drawers.map((d) => (
        <li key={d.drawer} style={{ '--line': DRAWER_LINE[d.drawer] ?? 'var(--ink-3)' } as CSSProperties}>
          <a href={hrefFor({ name: 'brain', query: { in: d.folder } })} className="brain-map-line">
            <span className="station" aria-hidden="true" />
            <span className="brain-map-name">{d.label}</span>
            <span className="brain-map-count num">{d.notes}</span>
          </a>
          {d.subjects.length ? (
            <span className="brain-map-stops" aria-hidden="true">
              {d.subjects.slice(0, 8).map((s) => <span key={s.name} className="station sm" title={`${s.name} · ${s.notes}`} />)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function Today() {
  const t = useT();
  const cats = useCategories();
  const brain = useQuery({ queryKey: ['brain'], queryFn: () => get<Brain>('/api/brain') });
  const learn = useQuery({ queryKey: ['learn'], queryFn: () => get<Learn>('/api/learn') });
  const recent = recentNotes();
  const now = brain.data?.now;
  const due = learn.data ? learn.data.counts.due + Math.min(10, learn.data.counts.newLeft) : 0;
  return (
    <div className="page">
      <div className="grid-2">
        <div className="stack" style={{ gap: 'var(--s6)' }}>
          <section className="panel" aria-labelledby="waiting-h">
            <div className="panel-head"><h2 id="waiting-h">{t('app.waiting.title')}</h2><span className="spacer" /><a className="btn sm ghost" href={hrefFor({ name: 'inbox' })}>{t('app.waiting.all')}</a></div>
            <div style={{ paddingTop: 'var(--s2)' }}><Waiting limit={5} /></div>
          </section>
          <section className="panel" aria-labelledby="recent-h">
            <div className="panel-head"><h2 id="recent-h">{t('app.today.resume')}</h2></div>
            {recent.length ? (
              <ul className="rows" style={{ paddingTop: 'var(--s2)' }}>
                {recent.slice(0, 6).map((r) => (
                  <li key={r.path}>
                    <span className="station sm" style={{ '--line': cats.color(r.category) } as CSSProperties} aria-hidden="true" />
                    <div className="grow"><a className="title" href={hrefFor({ name: 'brain', path: r.path })}>{r.title}</a><span className="meta">{r.path.split('/').slice(0, -1).join(' › ')}</span></div>
                  </li>
                ))}
              </ul>
            ) : <Empty title={t('app.today.resumeEmptyTitle')} action={<a className="btn sm" href={hrefFor({ name: 'brain' })}>{t('app.today.openBrain')}<ArrowRight size={14} aria-hidden="true" /></a>}>{t('app.today.resumeEmpty')}</Empty>}
          </section>
        </div>
        <div className="stack" style={{ gap: 'var(--s6)' }}>
          <section className="panel" aria-labelledby="now-h">
            <div className="panel-head"><h2 id="now-h">{t('app.today.now')}</h2></div>
            <div className="panel-body stack">
              {brain.error ? <ErrorState error={brain.error} retry={() => void brain.refetch()} /> : null}
              <p><span className="muted">{t('app.today.objective')} </span>{now?.objective?.text ?? <span className="muted">{t('app.today.noObjective')}</span>}</p>
              {now?.tickets.length ? <p className="small">{now.tickets.slice(0, 3).map((x) => <span key={x.ref} className="pill" style={{ marginRight: 6 }}>{x.ref}</span>)}</p> : null}
              {now?.waiting.length ? <p className="small muted">{tn(t, 'app.today.waitingFor', now.waiting.length)}</p> : null}
              {now?.lastSession?.next ? <p className="small"><span className="muted">{t('app.today.next')} </span>{now.lastSession.next}</p> : null}
            </div>
          </section>
          <section className="panel" aria-labelledby="learn-h">
            <div className="panel-head"><h2 id="learn-h">{t('app.today.review')}</h2></div>
            <div className="panel-body row wrap" style={{ justifyContent: 'space-between' }}>
              <p>{learn.data ? (due ? tn(t, 'app.today.cards', due) : t('app.today.noCards')) : <span className="skeleton" style={{ width: 160, display: 'inline-block' }} />}</p>
              {due ? <a className="btn sm" href={hrefFor({ name: 'learn' })}><GraduationCap size={14} aria-hidden="true" />{t('app.today.reviewNow')}</a> : null}
            </div>
          </section>
          {brain.data?.shape ? (
            <section className="panel" aria-labelledby="map-h">
              <div className="panel-head"><h2 id="map-h">{brain.data.name}</h2></div>
              <div className="panel-body"><BrainMap brain={brain.data} /></div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
