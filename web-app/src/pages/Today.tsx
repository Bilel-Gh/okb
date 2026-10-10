import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, CalendarCheck, Check, ChevronLeft, ChevronRight, Clock, FileDiff, GraduationCap, HeartPulse, Inbox, Layers, NotebookPen, Pencil, Plus, Sparkles, Sun, Target, Ticket, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { get, post } from '../app/api';
import { DRAWER_COLOR, recentNotes, useCategories } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { useStatus } from '../app/Shell';
import { toast } from '../app/toast';
import { Prose } from '../reader/Prose';
import { CatIcon } from '../ui/CatMark';
import { PageTabs } from '../ui/PageTabs';
import { useProgress, type ProgressData } from '../ui/Progress';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { TypeMark } from '../ui/TypeMark';
import { drawerOf } from './brain-tree';

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
type FullStatus = { focus: { exists: boolean; ageDays: number | null; stale: boolean }; inbox: { open: number; oldestDays: number | null }; toReview: number };

const fmtDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
const ago = (iso: string | null, lang: string) => {
  if (!iso) return '';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
};

/* ================================================================ shared: what waits for a yes */

/** The cards and proposals waiting for the person's yes, the first one with the main button. */
export function Waiting({ limit, only }: { limit?: number; only?: 'cards' }) {
  const t = useT();
  const qc = useQueryClient();
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
  const proposals = only === 'cards' ? [] : (p.data?.proposals ?? []).filter((x) => x.status === 'prepared');
  // Proposals that could not be read are not « nothing waiting » (F2.0-41).
  const failed = only !== 'cards' && p.error ? <div className="panel-body"><ErrorState error={p.error} retry={() => void p.refetch()} /></div> : null;
  if (!cards.length && !proposals.length) {
    return failed ?? <Empty icon={<Check size={22} />} title={t('app.waiting.emptyTitle')}>{t('app.waiting.empty')}</Empty>;
  }
  const shownCards = limit ? cards.slice(0, limit) : cards;
  return (
    <>
    {failed}
    <ul className="rows" aria-label={t('app.waiting.title')}>
      {proposals.map((x) => (
        <li key={x.id}>
          <span className="cat" style={{ '--c': 'var(--accent)' } as CSSProperties} aria-hidden="true"><FileDiff size={17} /></span>
          <div className="grow">
            <a className="title" href={hrefFor({ name: 'inbox', tab: 'proposals', id: x.id })}>{x.title}</a>
            <span className="meta">{t('app.waiting.proposal', { details: [x.created ? tn(t, 'app.waiting.created', x.created) : '', x.updated ? tn(t, 'app.waiting.updated', x.updated) : ''].filter(Boolean).join(', ') })}</span>
          </div>
          <div className="actions"><a className="btn sm primary" href={hrefFor({ name: 'inbox', tab: 'proposals', id: x.id })}>{t('app.waiting.read')}<ArrowRight size={14} aria-hidden="true" /></a></div>
        </li>
      ))}
      {shownCards.map((c, i) => (
        <li key={c.id}>
          <TypeMark id={c.category} />
          <div className="grow">
            <span className="title">{c.title}</span>
            <span className="meta">{c.why} · {t(`app.waiting.rec.${c.recommendation}`)} · ≈ {Math.round(c.cost.tokens / 1000)}k tokens{c.status === 'later' ? ` · ${t('app.waiting.later')}` : ''}</span>
          </div>
          <div className="actions">
            <button type="button" className={`btn sm${i === 0 && !proposals.length ? ' primary' : ''}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'accept' })}><Check size={14} aria-hidden="true" />{t('app.waiting.accept')}</button>
            <button type="button" className="btn sm ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'later' })}><Clock size={14} aria-hidden="true" />{t('app.waiting.laterBtn')}</button>
            <button type="button" className="btn sm ghost icon" title={t('app.waiting.decline')} aria-label={t('app.waiting.decline')} disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, decision: 'decline' })}><X size={14} aria-hidden="true" /></button>
          </div>
        </li>
      ))}
      {limit && cards.length > limit ? <li><a className="btn sm ghost" href={hrefFor({ name: 'inbox', tab: 'suggestions' })}>{tn(t, 'app.waiting.more', cards.length - limit)}</a></li> : null}
    </ul>
    </>
  );
}

function Panel({ title, icon, link, children, flush = false }: { title: string; icon?: ReactNode; link?: { href: string; label: string }; children: ReactNode; flush?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>{icon}{title}</h2>{link ? <a className="link" href={link.href}>{link.label}</a> : null}</div>
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
    </section>
  );
}

/* ================================================================ today */

function Hello({ waiting, due }: { waiting: number; due: number | null }) {
  const t = useT();
  const status = useStatus();
  const hour = new Date().getHours();
  const s = status.data;
  return (
    <section className="panel hero hello" aria-labelledby="hello-h">
      <div className="hello-text">
        <p className="muted">{hour >= 5 && hour < 18 ? t('app.today.morning') : t('app.today.evening')}</p>
        <h2 id="hello-h">{s?.name ?? '…'}</h2>
        <p className="muted">{s ? t('app.today.notesLine', { notes: s.notes, concepts: s.concepts }) : <span className="skeleton" style={{ width: 200, display: 'inline-block' }} />}</p>
      </div>
      <div className="stats">
        <a className="stat" href={hrefFor({ name: 'inbox' })}><b className="num">{waiting}</b><span><Inbox size={14} aria-hidden="true" />{t('app.today.stat.waiting')}</span></a>
        <a className="stat" href={hrefFor({ name: 'learn' })}><b className="num">{due ?? '–'}</b><span><Layers size={14} aria-hidden="true" />{t('app.today.stat.cards')}</span></a>
        <a className="stat" href={hrefFor({ name: 'upkeep', tab: 'health' })}><b className="num">{s?.health?.score ?? '–'}</b><span><HeartPulse size={14} aria-hidden="true" />{t('app.today.stat.health')}</span></a>
      </div>
    </section>
  );
}

function Level({ data }: { data: Extract<ProgressData, { show: true }> }) {
  const t = useT();
  const { level, from, to } = data.level;
  const k = Math.max(0, Math.min(1, (data.xp - from) / Math.max(1, to - from)));
  const label = t('app.progress.xp', { xp: data.xp, left: to - data.xp, next: level + 1 });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="level-line" role="meter" aria-valuemin={from} aria-valuemax={to} aria-valuenow={data.xp} aria-label={label}>
        <span className="level-badge num" aria-hidden="true">{level}</span>
        <div className="grow">
          <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(k * 100)}%` }} /></span>
          <small className="muted num">{label}</small>
        </div>
      </div>
      <p className="small muted">{t('app.progress.today', { xp: Math.round(data.today) })} · {tn(t, 'app.progress.streak', data.streak.current)}</p>
    </div>
  );
}

function QuickCapture() {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const save = async () => {
    if (!text.trim()) return;
    try { await post('/api/capture', { text }); setText(''); toast(t('web.inbox.captured')); void qc.invalidateQueries({ queryKey: ['status'] }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} placeholder={t('web.home.quickCapture')} aria-label={t('web.home.captureTitle')} />
        <button type="button" className="btn" onClick={() => void save()} disabled={!text.trim()}><Plus size={15} aria-hidden="true" />{t('web.home.capture')}</button>
      </div>
      <p className="xs muted">{t('app.today.captureWhere')}</p>
    </div>
  );
}

function BrainShape({ brain }: { brain: Brain | undefined }) {
  const t = useT();
  const cats = useCategories();
  const status = useStatus();
  const list = (status.data?.categories ?? []).filter((c) => c.count > 0);
  const total = list.reduce((n, c) => n + c.count, 0);
  return (
    <div className="stack" style={{ gap: 18 }}>
      {total ? (
        <>
          <div className="typebar" role="img" aria-label={list.map((c) => `${c.label} ${c.count}`).join(', ')}>
            {list.map((c) => <span key={c.id} style={{ flex: c.count / total, '--c': cats.color(c.id) } as CSSProperties} />)}
          </div>
          <ul className="type-legend">
            {list.map((c) => (
              <li key={c.id} style={{ '--c': cats.color(c.id) } as CSSProperties}>
                <a href={hrefFor({ name: 'brain', query: { cat: c.id } })}><span className="cat xs"><CatIcon id={c.id} emoji={c.emoji} size={11} /></span>{c.label} <b className="num">{c.count}</b></a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {brain?.shape ? (
        <ul className="drawer-cards" aria-label={t('app.today.map')}>
          {brain.shape.drawers.map((d) => (
            <li key={d.drawer} style={{ '--c': DRAWER_COLOR[d.drawer] ?? 'var(--ink-3)' } as CSSProperties}>
              <a href={hrefFor({ name: 'brain', query: { in: d.folder } })}>
                <span className="drawer-n" aria-hidden="true">{drawerOf(d.folder).n ?? '·'}</span>
                <b>{d.label}</b>
                <small className="muted num">{tn(t, 'app.brain.count', d.notes)}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TodayTab() {
  const t = useT();
  const brain = useQuery({ queryKey: ['brain'], queryFn: () => get<Brain>('/api/brain') });
  const learn = useQuery({ queryKey: ['learn'], queryFn: () => get<Learn>('/api/learn') });
  const full = useQuery({ queryKey: ['status-full'], queryFn: () => get<FullStatus>('/api/status') });
  const progress = useProgress();
  const recent = recentNotes();
  const now = brain.data?.now;
  const due = learn.data ? learn.data.counts.due + Math.min(10, learn.data.counts.newLeft) : 0;
  const suggestions = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Suggestions>('/api/suggestions') });
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: Proposal[] }>('/api/proposals') });
  const waiting = (suggestions.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0) + (proposals.data?.proposals.filter((x) => x.status === 'prepared').length ?? 0);
  // What is useful now, beyond the cards: captures to sort, a stale focus, the weekly review.
  const nudges: { icon: ReactNode; text: string; to: Route; action: string }[] = [];
  const f = full.data;
  if (f?.inbox.open) nudges.push({ icon: <Inbox size={16} aria-hidden="true" />, text: tn(t, 'status.inboxOpen', f.inbox.open, { days: f.inbox.oldestDays ?? 0 }), to: { name: 'inbox', tab: 'captures' }, action: t('web.home.sortInbox') });
  if (f && !f.focus.exists) nudges.push({ icon: <Target size={16} aria-hidden="true" />, text: t('web.home.noFocus'), to: { name: 'today', tab: 'focus' }, action: t('web.home.writeFocus') });
  else if (f?.focus.stale) nudges.push({ icon: <Target size={16} aria-hidden="true" />, text: t('status.focusStale', { age: f.focus.ageDays ?? 0 }), to: { name: 'today', tab: 'focus' }, action: t('web.home.updateFocus') });
  if (f?.toReview) nudges.push({ icon: <GraduationCap size={16} aria-hidden="true" />, text: tn(t, 'status.toReviewCount', f.toReview), to: { name: 'today', tab: 'week', step: 'reread' }, action: t('web.home.reread') });
  if ([0, 1].includes(new Date().getDay())) nudges.push({ icon: <CalendarCheck size={16} aria-hidden="true" />, text: t('web.home.weeklyTime'), to: { name: 'today', tab: 'week' }, action: t('web.home.startWeekly') });

  return (
    <>
      <Hello waiting={waiting} due={learn.data ? due : null} />
      <div className="grid-2">
        <div className="stack lg">
          <Panel title={t('app.waiting.title')} link={{ href: hrefFor({ name: 'inbox' }), label: t('app.waiting.all') }} flush><Waiting limit={5} /></Panel>
          <Panel title={t('app.today.resume')} flush>
            {recent.length ? (
              <ul className="rows tight">
                {recent.slice(0, 6).map((r) => (
                  <li key={r.path} className="link-row">
                    <a href={hrefFor({ name: 'brain', path: r.path })}>
                      <TypeMark id={r.category} size="sm" />
                      <span className="grow"><span className="title">{r.title}</span><span className="meta">{r.path.split('/').slice(0, -1).map((p) => drawerOf(p).label).join(' › ')} · {ago(r.at, t.lang)}</span></span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <Empty title={t('app.today.resumeEmptyTitle')} action={<a className="btn sm" href={hrefFor({ name: 'brain' })}>{t('app.today.openBrain')}<ArrowRight size={14} aria-hidden="true" /></a>}>{t('app.today.resumeEmpty')}</Empty>}
          </Panel>
        </div>
        <div className="stack lg">
          <Panel title={t('app.today.now')} link={{ href: hrefFor({ name: 'today', tab: 'focus' }), label: t('app.today.tab.focus') }}>
            <div className="stack" style={{ gap: 12 }}>
              {brain.error ? <ErrorState error={brain.error} retry={() => void brain.refetch()} /> : null}
              <p className="objective"><Target size={17} aria-hidden="true" /><span>{now?.objective?.text ?? <span className="muted">{t('app.today.noObjective')}</span>}</span></p>
              {now?.tickets.length ? <p className="objective"><Ticket size={17} aria-hidden="true" /><span>{now.tickets.slice(0, 3).map((x) => x.ref).join(', ')}{now.waiting.length ? ` · ${tn(t, 'app.today.waitingFor', now.waiting.length)}` : ''}</span></p> : null}
              {now?.lastSession?.next ? <p className="objective"><ArrowRight size={17} aria-hidden="true" /><span><span className="muted">{t('app.today.next')} </span>{now.lastSession.next}</span></p> : null}
              {nudges.length ? (
                <ul className="nudges">
                  {nudges.slice(0, 3).map((n) => <li key={n.text}>{n.icon}<span className="grow">{n.text}</span><a className="btn sm" href={hrefFor(n.to)}>{n.action}</a></li>)}
                </ul>
              ) : null}
              <div className="row wrap">
                <a className="btn sm" href={hrefFor({ name: 'today', tab: 'focus', done: true })}><BadgeCheck size={14} aria-hidden="true" />{t('web.home.endSession')}</a>
              </div>
            </div>
          </Panel>
          {progress.data?.show ? (
            <Panel title={t('app.progress.title')} link={{ href: hrefFor({ name: 'learn', tab: 'progress' }), label: t('app.progress.badges') }}><Level data={progress.data} /></Panel>
          ) : null}
          <Panel title={t('app.today.review')}>
            <div className="row" style={{ gap: 12 }}>
              <p className="grow">{learn.data ? (due ? tn(t, 'app.today.cards', due) : t('app.today.noCards')) : <span className="skeleton" style={{ width: 160, display: 'inline-block' }} />}</p>
              {due ? <a className="btn sm" href={hrefFor({ name: 'learn' })}><Layers size={14} aria-hidden="true" />{t('app.today.review')}</a> : null}
            </div>
          </Panel>
          <Panel title={t('web.home.captureTitle')}><QuickCapture /></Panel>
        </div>
      </div>
      <Panel title={t('app.today.brain')} link={{ href: hrefFor({ name: 'graph' }), label: t('app.today.seeGraph') }}><BrainShape brain={brain.data} /></Panel>
    </>
  );
}

/* ================================================================ focus and journal */

type Focus = { exists: boolean; raw: string; html: string; updatedAt: string | null; stale: boolean };
type Session = { at: string; profile: string; summary: string; next?: string | null; did?: string[]; decided?: string[] };

function ListEditor({ label, placeholder, values, setValues, hint }: { label: string; placeholder: string; values: string[]; setValues: (v: string[]) => void; hint?: string }) {
  const t = useT();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <div className="field">
      <span className="label">{label}</span>
      {hint ? <small>{hint}</small> : null}
      {values.map((v, i) => (
        <div className="row" key={i}>
          <input ref={(el) => { refs.current[i] = el; }} className="input" value={v} placeholder={placeholder} aria-label={`${label} ${i + 1}`}
            onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setValues([...values, '']); setTimeout(() => refs.current[values.length]?.focus(), 20); } }} />
          {values.length > 1 ? <button type="button" className="btn ghost sm icon" aria-label={t('app.remove')} onClick={() => setValues(values.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button> : null}
        </div>
      ))}
      <span><button type="button" className="btn ghost sm" onClick={() => setValues([...values, ''])}><Plus size={14} aria-hidden="true" />{t('web.add')}</button></span>
    </div>
  );
}

function EndSession({ start }: { start: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [summary, setSummary] = useState('');
  const [did, setDid] = useState(['']);
  const [decided, setDecided] = useState(['']);
  const [keep, setKeep] = useState(['']);
  const [next, setNext] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (start) { box.current?.scrollIntoView({ block: 'start' }); first.current?.focus(); } }, [start]);
  const save = async () => {
    if (!summary.trim()) { toast(t('web.done.needSummary'), 'err'); first.current?.focus(); return; }
    const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
    try {
      const r = await post<{ captured: unknown[] }>('/api/done', { summary, did: clean(did), decided: clean(decided), keep: clean(keep), next });
      toast(r.captured.length ? t('app.today.savedCaptured', { n: r.captured.length }) : t('app.today.saved'));
      setSummary(''); setDid(['']); setDecided(['']); setKeep(['']); setNext('');
      void qc.invalidateQueries({ queryKey: ['journal'] });
      void qc.invalidateQueries({ queryKey: ['brain'] });
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <section ref={box} className="panel" id="done">
      <div className="panel-head"><h2><BadgeCheck size={17} aria-hidden="true" />{t('web.done.title')}</h2></div>
      <div className="panel-body stack lg">
        <p className="muted">{t('web.done.text')}</p>
        <div className="field"><label htmlFor="done-summary">{t('done.summary.q')}</label><input ref={first} id="done-summary" className="input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('done.summary.placeholder')} /></div>
        <div className="grid-even">
          <ListEditor label={t('web.done.did')} placeholder={t('web.done.didPlaceholder')} values={did} setValues={setDid} />
          <ListEditor label={t('web.done.decided')} placeholder={t('web.done.decidedPlaceholder')} values={decided} setValues={setDecided} />
        </div>
        <ListEditor label={t('web.done.keep')} hint={t('app.today.keepWhere')} placeholder={t('done.keep.placeholder')} values={keep} setValues={setKeep} />
        <div className="field"><label htmlFor="done-next">{t('done.next.q')}</label><input id="done-next" className="input" value={next} onChange={(e) => setNext(e.target.value)} placeholder={t('done.next.placeholder')} /></div>
        <div className="row"><span className="spacer" /><button type="button" className="btn primary" onClick={() => void save()}><Check size={16} aria-hidden="true" />{t('web.done.save')}</button></div>
      </div>
    </section>
  );
}

function FocusTab({ done }: { done: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const focus = useQuery({ queryKey: ['focus'], queryFn: () => get<Focus>('/api/focus') });
  const journal = useQuery({ queryKey: ['journal'], queryFn: () => get<{ sessions: Session[] }>('/api/journal') });
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['focus'] }); void qc.invalidateQueries({ queryKey: ['status-full'] }); };
  const create = async () => { try { await post('/api/focus/init'); toast(t('app.today.focusCreated')); refresh(); } catch (e) { toast((e as Error).message, 'err'); } };
  const save = async () => { try { await post('/api/focus', { text: editing ?? '' }); toast(t('app.today.focusSaved')); setEditing(null); refresh(); } catch (e) { toast((e as Error).message, 'err'); } };
  const f = focus.data;
  return (
    <div className="grid-2">
      <div className="stack lg">
        <section className="panel">
          <div className="panel-head">
            <h2><Target size={17} aria-hidden="true" />{t('app.today.focusTitle')}</h2>
            {f?.exists ? <span className={`pill sm ${f.stale ? 'warn' : 'ok'}`}>{f.stale ? t('web.home.stale') : t('focus.updatedAgo', { when: ago(f.updatedAt, t.lang) })}</span> : null}
            <span className="spacer" />
            {f?.exists && editing === null ? <button type="button" className="btn sm" onClick={() => setEditing(f.raw)}><Pencil size={14} aria-hidden="true" />{t('web.edit')}</button> : null}
          </div>
          <div className="panel-body">
            {focus.isLoading ? <SkeletonRows rows={4} /> : focus.error ? <ErrorState error={focus.error} /> : !f?.exists ? (
              <Empty icon={<Target size={22} />} title={t('focus.none')} action={<button type="button" className="btn primary" onClick={() => void create()}>{t('web.focus.create')}</button>}>{t('web.focus.createText')}</Empty>
            ) : editing !== null ? (
              <div className="stack">
                <textarea className="textarea code" style={{ minHeight: 280 }} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label={t('app.today.focusTitle')} autoFocus />
                <div className="row"><span className="small muted grow">{t('focus.previousKept')}</span><button type="button" className="btn" onClick={() => setEditing(null)}>{t('web.cancel')}</button><button type="button" className="btn primary" onClick={() => void save()}>{t('web.save')}</button></div>
              </div>
            ) : <><p className="small muted" style={{ marginBottom: 14 }}>{t('focus.why')}</p><Prose html={f.html} dropTitle /></>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2><NotebookPen size={17} aria-hidden="true" />{t('web.journal.title')}</h2></div>
          <div className="panel-body">
            {journal.isLoading ? <SkeletonRows rows={4} /> : !journal.data?.sessions.length ? <p className="muted">{t('app.today.noSession')}</p> : (
              <ol className="timeline">
                {journal.data.sessions.slice(0, 30).map((s) => (
                  <li key={s.at}>
                    <b>{s.summary}</b>
                    <small className="muted">{fmtDate(s.at, t.lang)} · {s.profile}</small>
                    {s.next ? <p className="small"><span className="muted">{t('focus.nextTime')} </span>{s.next}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
      <EndSession start={done} />
    </div>
  );
}

/* ================================================================ the weekly review */

type Weekly = {
  period: { from: string; to: string };
  inbox: { open: number; oldestDays: number | null; stale: { title: string; ageDays: number }[] };
  proposals: { prepared: { id: string; label: string; ageDays: number; changes: number }[] };
  applied: { receipts: number; created: string[]; updated: string[] };
  toReview: { path: string; title: string; milestone: number }[];
  maintenance: { errors: number; warnings: number };
  focus: { exists: boolean; ageDays: number | null; stale: boolean };
  sessions: { count: number; next: { next: string; at: string; profile: string }[] };
};
const STEPS = ['inbox', 'proposals', 'reread', 'focus', 'health', 'next'] as const;

function WeekTab({ step: initial }: { step?: string }) {
  const t = useT();
  const week = useQuery({ queryKey: ['weekly'], queryFn: () => get<Weekly>('/api/weekly') });
  const [step, setStep] = useState(Math.max(0, STEPS.indexOf((initial ?? 'inbox') as typeof STEPS[number])));
  const [idea, setIdea] = useState('');
  if (week.isLoading) return <SkeletonRows rows={6} />;
  if (week.error || !week.data) return <ErrorState error={week.error} retry={() => void week.refetch()} />;
  const r = week.data;
  const d = (iso: string) => new Date(iso).toLocaleDateString(t.lang, { day: 'numeric', month: 'long' });
  const keep = async () => {
    if (!idea.trim()) return;
    try { await post('/api/capture', { text: idea, title: t('web.weekly.nextTitle'), tags: ['weekly'] }); toast(t('web.inbox.captured')); setIdea(''); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const tone = (ok: boolean) => (ok ? 'ok' : 'warn');
  const body: Record<typeof STEPS[number], ReactNode> = {
    inbox: <>
      <h2>{t('weekly.inbox')}</h2>
      {r.inbox.open ? <p>{tn(t, 'weekly.inboxOpen', r.inbox.open, { days: r.inbox.oldestDays ?? 0 })}</p> : <p className="notice ok"><Check size={17} aria-hidden="true" />{t('app.today.inboxEmpty')}</p>}
      {r.inbox.stale.length ? <ul className="rows tight panel">{r.inbox.stale.map((i) => <li key={i.title}><span className="grow">{i.title}</span><span className="muted small">{tn(t, 'weekly.days', i.ageDays)}</span></li>)}</ul> : null}
      {r.inbox.open ? <a className="btn" href={hrefFor({ name: 'inbox', tab: 'captures' })}>{t('web.home.sortInbox')}<ArrowRight size={14} aria-hidden="true" /></a> : null}
    </>,
    proposals: <>
      <h2>{t('weekly.proposals')}</h2>
      {r.proposals.prepared.length ? <ul className="rows tight panel">{r.proposals.prepared.map((p) => <li key={p.id} className="link-row"><a href={hrefFor({ name: 'inbox', tab: 'proposals', id: p.id })}><FileDiff size={16} aria-hidden="true" className="muted" /><span className="grow"><span className="title">{p.label || p.id}</span><span className="meta">{tn(t, 'weekly.days', p.ageDays)}</span></span><ChevronRight size={15} aria-hidden="true" /></a></li>)}</ul> : <p className="notice ok"><Check size={17} aria-hidden="true" />{t('app.today.noProposals')}</p>}
      <p className="small muted">{t('weekly.appliedLine', { receipts: r.applied.receipts, created: r.applied.created.length, updated: r.applied.updated.length })}</p>
    </>,
    reread: <>
      <h2>{t('weekly.reread')}</h2>
      <p className="muted">{t('web.weekly.rereadText')}</p>
      {r.toReview.length ? <ul className="rows tight panel">{r.toReview.map((n) => <li key={n.path} className="link-row"><a href={hrefFor({ name: 'brain', path: n.path })}><span className="pill accent sm num">J+{n.milestone}</span><span className="grow title">{n.title}</span></a></li>)}</ul> : <p className="notice plain"><Sparkles size={17} aria-hidden="true" />{t('app.today.rereadNone')}</p>}
      <a className="btn" href={hrefFor({ name: 'learn' })}><GraduationCap size={15} aria-hidden="true" />{t('web.weekly.quiz')}</a>
    </>,
    focus: <>
      <h2>{t('weekly.focus')}</h2>
      <p className={`notice ${r.focus.exists ? tone(!r.focus.stale) : 'plain'}`}><Target size={17} aria-hidden="true" />{r.focus.exists ? t(r.focus.stale ? 'app.today.focusStale' : 'app.today.focusOk', { days: r.focus.ageDays ?? 0 }) : t('app.today.focusNone')}</p>
      <p>{tn(t, 'weekly.sessions', r.sessions.count)}</p>
      {r.sessions.next.map((s) => <p key={s.at} className="objective"><ArrowRight size={16} aria-hidden="true" /><span>{s.next} <span className="muted small">· {d(s.at)}</span></span></p>)}
      <a className="btn" href={hrefFor({ name: 'today', tab: 'focus' })}>{r.focus.exists ? t('web.home.updateFocus') : t('web.home.writeFocus')}</a>
    </>,
    health: <>
      <h2>{t('weekly.maintenance')}</h2>
      <p className={`notice ${r.maintenance.errors ? 'err' : r.maintenance.warnings ? 'warn' : 'ok'}`}><HeartPulse size={17} aria-hidden="true" />{tn(t, 'status.errors', r.maintenance.errors)} · {tn(t, 'status.warnings', r.maintenance.warnings)}</p>
      <a className="btn" href={hrefFor({ name: 'upkeep', tab: 'health' })}>{t('web.weekly.seeHealth')}</a>
    </>,
    next: <>
      <h2>{t('web.weekly.step.next')}</h2>
      <p className="muted">{t('web.weekly.nextText')}</p>
      <textarea className="textarea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={t('web.weekly.nextPlaceholder')} aria-label={t('web.weekly.step.next')} />
      <span><button type="button" className="btn primary" onClick={() => void keep()} disabled={!idea.trim()}>{t('web.weekly.saveNext')}</button></span>
    </>,
  };
  return (
    <div className="stack lg">
      <p className="page-intro">{d(r.period.from)} → {d(r.period.to)} · {t('web.weekly.lead')}</p>
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'now' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}><span className="step-n num">{i < step ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{t(`web.weekly.step.${s}`)}</button>
          </li>
        ))}
      </ol>
      <section className="panel week-step"><div className="panel-body stack">{body[STEPS[step]!]}</div></section>
      <div className="row">
        {step > 0 ? <button type="button" className="btn" onClick={() => setStep(step - 1)}><ChevronLeft size={15} aria-hidden="true" />{t('web.back')}</button> : null}
        <span className="spacer" />
        {step < STEPS.length - 1 ? <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>{t('web.next')}<ChevronRight size={15} aria-hidden="true" /></button> : <button type="button" className="btn primary" onClick={() => go({ name: 'today' })}>{t('web.weekly.finish')}</button>}
      </div>
    </div>
  );
}

/* ================================================================ the page */

export default function Today({ route }: { route: Extract<Route, { name: 'today' }> }) {
  const t = useT();
  const tab = route.tab;
  return (
    <div className="page">
      <PageTabs label={t('app.nav.today')} tabs={[
        { to: { name: 'today' }, label: t('app.today.tab.today'), current: !tab, icon: Sun },
        { to: { name: 'today', tab: 'focus' }, label: t('app.today.tab.focus'), current: tab === 'focus', icon: Target },
        { to: { name: 'today', tab: 'week' }, label: t('app.today.tab.week'), current: tab === 'week', icon: CalendarCheck },
      ]} />
      {!tab ? <TodayTab /> : tab === 'focus' ? <FocusTab done={route.done === true} /> : <WeekTab step={route.step} />}
    </div>
  );
}
