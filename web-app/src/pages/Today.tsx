import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Clock, FileDiff, GraduationCap, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { get, post } from '../app/api';
import { DRAWER_COLOR, recentNotes, useCategories } from '../app/data';
import { useStatus } from '../app/Shell';
import { CatMark } from '../ui/CatMark';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { ProgressLine, useProgress } from '../ui/Progress';
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

/** The cards and proposals waiting for the person's yes, the first one with the main button. */
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
            <span className="meta">{t('app.waiting.proposal', { details: [x.created ? tn(t, 'app.waiting.created', x.created) : '', x.updated ? tn(t, 'app.waiting.updated', x.updated) : ''].filter(Boolean).join(', ') })}</span>
          </div>
          <a className="btn sm" href={hrefFor({ name: 'inbox', tab: 'proposals', id: x.id })}>{t('app.waiting.read')}<ArrowRight size={14} aria-hidden="true" /></a>
        </li>
      ))}
      {shownCards.map((c, i) => (
        <li key={c.id}>
          <CatMark color={cats.color(c.category)} emoji={cats.emoji(c.category)} label={cats.label(c.category)} />
          <div className="grow">
            <span className="title">{c.title}</span>
            <span className="meta">{c.why} · {t(`app.waiting.rec.${c.recommendation}`)} · ≈ {Math.round(c.cost.tokens / 1000)}k tokens{c.status === 'later' ? ` · ${t('app.waiting.later')}` : ''}</span>
          </div>
          <div className="row">
            <button type="button" className={`btn sm${i === 0 && !proposals.length ? ' primary' : ''}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'accept' })}><Check size={14} aria-hidden="true" />{t('app.waiting.accept')}</button>
            <button type="button" className="btn sm ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'later' })}><Clock size={14} aria-hidden="true" />{t('app.waiting.laterBtn')}</button>
            <button type="button" className="btn sm ghost icon" title={t('app.waiting.decline')} aria-label={t('app.waiting.decline')} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'decline' })}><X size={14} aria-hidden="true" /></button>
          </div>
        </li>
      ))}
      {limit && cards.length > limit ? <li><a className="btn sm ghost" href={hrefFor({ name: 'inbox', tab: 'suggestions' })}>{tn(t, 'app.waiting.more', cards.length - limit)}</a></li> : null}
    </ul>
  );
}

/** The drawers of the brain, each with its number and how many notes it holds. */
function Drawers({ brain }: { brain: Brain }) {
  const t = useT();
  if (!brain.shape) return null;
  return (
    <ul className="drawers" aria-label={t('app.today.map')}>
      {brain.shape.drawers.map((d) => (
        <li key={d.drawer} style={{ '--c': DRAWER_COLOR[d.drawer] ?? 'var(--ink-3)' } as CSSProperties}>
          <a href={hrefFor({ name: 'brain', query: { in: d.folder } })}>
            <span className="drawer-n" aria-hidden="true">{/^(\d)\s/.exec(d.folder)?.[1] ?? '·'}</span>
            <span className="drawer-name">{d.label}</span>
            <span className="num muted xs">{d.notes}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** How the brain is made: its notes by type, as one bar and a legend. */
function Types() {
  const t = useT();
  const cats = useCategories();
  const status = useStatus();
  const list = (status.data?.categories ?? []).filter((c) => c.count > 0);
  const total = list.reduce((n, c) => n + c.count, 0);
  if (!total) return null;
  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <div className="typebar" role="img" aria-label={list.map((c) => `${c.label} ${c.count}`).join(', ')}>
        {list.map((c) => <span key={c.id} style={{ flex: c.count / total, '--c': cats.color(c.id) } as CSSProperties} />)}
      </div>
      <ul className="type-legend">
        {list.map((c) => (
          <li key={c.id} style={{ '--c': cats.color(c.id) } as CSSProperties}>
            <a href={hrefFor({ name: 'brain', query: { cat: c.id } })}><span className="dot" aria-hidden="true" /><span className="cat-emoji" aria-hidden="true">{c.emoji}</span>{c.label} <b className="num">{c.count}</b></a>
          </li>
        ))}
      </ul>
      <span className="sr-only">{t('app.today.types')}</span>
    </div>
  );
}

/** The welcome: the brain, what it holds, and three numbers that call for a gesture. */
function Hello({ waiting, due }: { waiting: number; due: number | null }) {
  const t = useT();
  const status = useStatus();
  const hour = new Date().getHours();
  const s = status.data;
  return (
    <section className="panel hello" aria-labelledby="hello-h">
      <div className="hello-text">
        <p className="muted">{hour >= 5 && hour < 18 ? t('app.today.morning') : t('app.today.evening')}</p>
        <h2 id="hello-h">{s?.name ?? '…'}</h2>
        <p className="muted small">{s ? t('app.today.notesLine', { notes: s.notes, concepts: s.concepts }) : <span className="skeleton" style={{ width: 200, display: 'inline-block' }} />}</p>
      </div>
      <div className="hello-stats">
        <a className="stat" href={hrefFor({ name: 'inbox' })}><b className="num">{waiting}</b><span>{t('app.today.stat.waiting')}</span></a>
        <a className="stat" href={hrefFor({ name: 'learn' })}><b className="num">{due ?? '–'}</b><span>{t('app.today.stat.cards')}</span></a>
        <a className="stat" href="/classic#/health"><b className="num">{s?.health?.score ?? '–'}</b><span>{t('app.today.stat.health')}</span></a>
      </div>
    </section>
  );
}

export default function Today() {
  const t = useT();
  const cats = useCategories();
  const brain = useQuery({ queryKey: ['brain'], queryFn: () => get<Brain>('/api/brain') });
  const learn = useQuery({ queryKey: ['learn'], queryFn: () => get<Learn>('/api/learn') });
  const progress = useProgress();
  const recent = recentNotes();
  const now = brain.data?.now;
  const due = learn.data ? learn.data.counts.due + Math.min(10, learn.data.counts.newLeft) : 0;
  const suggestions = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Suggestions>('/api/suggestions') });
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: Proposal[] }>('/api/proposals') });
  const waiting = (suggestions.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0) + (proposals.data?.proposals.filter((x) => x.status === 'prepared').length ?? 0);
  return (
    <div className="page">
      <Hello waiting={waiting} due={learn.data ? due : null} />
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
                    <CatMark small color={cats.color(r.category)} emoji={cats.emoji(r.category)} label={cats.label(r.category)} />
                    <div className="grow"><a className="title" href={hrefFor({ name: 'brain', path: r.path })}>{r.title}</a><span className="meta">{r.path.split('/').slice(0, -1).join(' › ')}</span></div>
                  </li>
                ))}
              </ul>
            ) : <Empty title={t('app.today.resumeEmptyTitle')} action={<a className="btn sm" href={hrefFor({ name: 'brain' })}>{t('app.today.openBrain')}<ArrowRight size={14} aria-hidden="true" /></a>}>{t('app.today.resumeEmpty')}</Empty>}
          </section>
          <section className="panel" aria-labelledby="learn-h">
            <div className="panel-head"><h2 id="learn-h">{t('app.today.review')}</h2></div>
            <div className="panel-body row wrap" style={{ justifyContent: 'space-between' }}>
              <p>{learn.data ? (due ? tn(t, 'app.today.cards', due) : t('app.today.noCards')) : <span className="skeleton" style={{ width: 160, display: 'inline-block' }} />}</p>
              {due ? <a className="btn sm" href={hrefFor({ name: 'learn' })}><GraduationCap size={14} aria-hidden="true" />{t('app.today.reviewNow')}</a> : null}
            </div>
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
          {progress.data?.show ? (
            <section className="panel" aria-labelledby="progress-h">
              <div className="panel-head"><h2 id="progress-h">{t('app.progress.title')}</h2><span className="spacer" /><a className="btn sm ghost" href={hrefFor({ name: 'learn' })}>{t('app.progress.badges')}</a></div>
              <div className="panel-body"><ProgressLine data={progress.data} /></div>
            </section>
          ) : null}
          {brain.data?.shape ? (
            <section className="panel" aria-labelledby="map-h">
              <div className="panel-head"><h2 id="map-h">{t('app.today.map')}</h2></div>
              <div className="panel-body"><Drawers brain={brain.data} /></div>
            </section>
          ) : null}
        </div>
      </div>
      <section className="panel" aria-labelledby="types-h">
        <div className="panel-head"><h2 id="types-h">{t('app.today.types')}</h2><span className="spacer" /><a className="btn sm ghost" href="/classic#/graph">{t('app.today.seeGraph')}</a></div>
        <div className="panel-body"><Types /></div>
      </section>
    </div>
  );
}
