import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Briefcase, CircleCheck, Eye, GraduationCap, Layers, Sparkles, Terminal, TriangleAlert, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { PageTabs } from '../ui/PageTabs';
import { useFrozen } from '../app/Shell';
import UnderstandingPage, { UnderstandingProgress } from './Understanding';
import { useShareWords } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type Card = { id: string; path: string; title: string; front: string; back: string; kind: string; subject: string; level: string };
type LearnData = {
  due: Card[]; fresh: Card[];
  counts: { cards: number; due: number; newLeft: number; reviewedToday: number };
  map: { subject: string; cards: number; levels: { new: number; learning: number; known: number; mastered: number }; percent: number }[];
};
type Career = {
  notes: unknown[]; achievements: { path: string; title: string; date?: string; star: string[]; hasProof: boolean; skills: string[] }[];
  feedback: { count: number }; goals: { open: number; done: number }; hints: { key: string; detail?: string }[]; skills: { skill: string; stories: number }[]; leaks: number;
};
const RATINGS = ['again', 'hard', 'good', 'easy'] as const;
/* ================================================================ review */

export function Review() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn'], queryFn: () => get<LearnData>('/api/learn') });
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const queue = q.data ? [...q.data.due, ...q.data.fresh] : [];
  const card = queue[index];
  // One grade per card shown: a second key press while the first is on its way does nothing (F2.0-39).
  const grading = useRef(false);
  const grade = useMutation({
    mutationFn: (rating: (typeof RATINGS)[number]) => post<{ ok: true; level: string }>('/api/learn/grade', { id: card!.id, rating }),
    onSuccess: () => { setShown(false); setIndex((i) => i + 1); void qc.invalidateQueries({ queryKey: ['progress'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
    onSettled: () => { grading.current = false; },
  });
  const rate = (rating: (typeof RATINGS)[number]) => {
    if (grading.current) return;
    grading.current = true;
    grade.mutate(rating);
  };
  // A new list of due cards (after the last one, or from the server) starts from its first card.
  useEffect(() => { setIndex(0); setShown(false); }, [q.dataUpdatedAt]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!card || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); }
      else if (shown && ['1', '2', '3', '4'].includes(e.key)) rate(RATINGS[Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [card, shown, rate]);
  useEffect(() => { if (q.data && index >= queue.length && index > 0) void qc.invalidateQueries({ queryKey: ['learn'] }); }, [index, queue.length, q.data, qc]);

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <>
      <section className="panel hero flash" aria-live="polite">
        {card ? (
          <>
            <p className="where">{t('app.learn.position', { n: index + 1, total: queue.length })} · {card.subject} · {t(`app.learn.level.${card.level}`)}</p>
            <h2>{card.front}</h2>
            {shown ? (
              <>
                <p className="flash-back">{card.back}</p>
                <a className="small link" href={hrefFor({ name: 'brain', path: card.path })}>{t('app.learn.open', { title: card.title })} <ArrowRight size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></a>
                <div className="grades" role="group" aria-label={t('app.learn.how')}>
                  {RATINGS.map((r, i) => (
                    <button key={r} type="button" className={`btn${r === 'good' ? ' primary' : ''}`} disabled={grade.isPending} onClick={() => rate(r)}>
                      {t(`app.learn.rate.${r}`)}<kbd aria-hidden="true">{i + 1}</kbd>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button type="button" className="btn primary lg" onClick={() => setShown(true)}><Eye size={16} aria-hidden="true" />{t('app.learn.reveal')}<kbd aria-hidden="true" className="on-fill">{t('app.learn.space')}</kbd></button>
            )}
          </>
        ) : (
          <Empty center icon={<GraduationCap size={22} />} title={t('app.learn.doneTitle')}>{d.counts.cards ? t('app.learn.done') : t('app.learn.noCards')}</Empty>
        )}
      </section>
      <p className="small muted" style={{ textAlign: 'center' }}>{t('app.learn.intro', { due: d.counts.due, fresh: d.counts.newLeft, cards: d.counts.cards })}</p>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>{t('app.learn.map')}</h2></div>
          <div className="panel-body">
            {d.map.length ? (
              <ul className="skills">
                {d.map.map((m) => (
                  <li key={m.subject}>
                    <span className="clip">{m.subject}</span>
                    <span className="bar" aria-hidden="true"><span style={{ width: `${m.percent}%` }} /></span>
                    <span className="num muted">{m.percent} %</span>
                    <small className="muted">{tn(t, 'app.learn.cards', m.cards)} · {t('app.learn.mastered', { n: m.levels.mastered })}</small>
                  </li>
                ))}
              </ul>
            ) : <Empty title={t('app.learn.mapEmptyTitle')}>{t('app.learn.mapEmpty')}</Empty>}
          </div>
        </section>
      </div>
    </>
  );
}

/* ================================================================ career */

function CareerTab() {
  const t = useT();
  const c = useQuery({ queryKey: ['career'], queryFn: () => get<Career>('/api/career') });
  if (c.isLoading) return <SkeletonRows rows={5} />;
  if (c.error || !c.data) return <ErrorState error={c.error} retry={() => void c.refetch()} />;
  const d = c.data;
  if (!d.notes.length) {
    return (
      <section className="panel">
        <Empty icon={<Briefcase size={22} />} title={t('web.career.empty')} action={<code className="cmd"><Terminal size={13} aria-hidden="true" />/okb:career</code>}>{t('web.career.emptyText')} {t('web.career.claude')}</Empty>
      </section>
    );
  }
  return (
    <>
      <div className="stats">
        <div className="stat"><b className="num">{d.achievements.length}</b><span><Trophy size={14} aria-hidden="true" />{t('web.career.stories')}</span></div>
        <div className="stat"><b className="num">{d.feedback.count}</b><span><Sparkles size={14} aria-hidden="true" />{t('web.career.feedback')}</span></div>
        <div className="stat"><b className="num">{d.goals.done} / {d.goals.open + d.goals.done}</b><span><CircleCheck size={14} aria-hidden="true" />{t('web.career.goals')}</span></div>
      </div>
      {d.hints.length ? <div className="notice warn"><TriangleAlert size={18} aria-hidden="true" /><div className="stack" style={{ gap: 4 }}>{d.hints.map((x) => <span key={x.key}>{t(`career.hint.${x.key}`, { detail: x.detail ?? '' })}</span>)}</div></div> : null}
      <section className="panel">
        <div className="panel-head"><h2><Trophy size={17} aria-hidden="true" />{t('web.career.storiesTitle')}</h2></div>
        <ul className="rows">
          {d.achievements.map((a) => (
            <li key={a.path} className="link-row">
              <a href={hrefFor({ name: 'brain', path: a.path })}>
                <span className="tile sm" aria-hidden="true"><Trophy size={16} /></span>
                <span className="grow"><span className="title">{a.title}</span><span className="meta">{[a.date, `STAR ${a.star.length}/4`, a.hasProof ? t('app.career.proof') : '', a.skills.join(', ')].filter(Boolean).join(' · ')}</span></span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      {d.skills.length ? (
        <section className="panel"><div className="panel-head"><h2>{t('web.career.skills')}</h2></div>
          <div className="panel-body row wrap">{d.skills.map((s) => <span key={s.skill} className="pill">{s.skill} <b className="num">{s.stories}</b></span>)}</div>
        </section>
      ) : null}
      <p className={`notice ${d.leaks ? 'warn' : 'ok'}`}>{d.leaks ? <TriangleAlert size={17} aria-hidden="true" /> : <CircleCheck size={17} aria-hidden="true" />}<span>{d.leaks ? t('web.career.leaks', { count: d.leaks }) : t('web.career.clean')} <code>okb career check</code></span></p>
    </>
  );
}

export default function Learn({ route }: { route: Extract<Route, { name: 'learn' }> }) {
  const t = useT();
  const w = useShareWords();
  const frozen = useFrozen();
  const tab = route.tab === 'career' && frozen.has('career') ? undefined : route.tab;
  return (
    <div className="page">
      <PageTabs label={t('app.screen.progress')} tabs={[
        { to: { name: 'learn' }, label: t('app.learn.tab.review'), current: !tab, icon: Layers },
        { to: { name: 'learn', tab: 'understanding' }, label: w('Comprendre', 'Understand'), current: tab === 'understanding', icon: BookOpen },
        { to: { name: 'learn', tab: 'progress' }, label: t('app.learn.tab.progress'), current: tab === 'progress', icon: Trophy },
        ...(frozen.has('career') ? [] : [{ to: { name: 'learn', tab: 'career' } as Route, label: t('app.learn.tab.career'), current: tab === 'career', icon: Briefcase }]),
      ]} />
      {!tab ? <Review /> : tab === 'understanding' ? <UnderstandingPage /> : tab === 'progress' ? <UnderstandingProgress /> : <CareerTab />}
    </div>
  );
}
