import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { Badges, ProgressLine, useProgress } from '../ui/Progress';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type Card = { id: string; path: string; title: string; front: string; back: string; kind: string; subject: string; level: string };
type LearnData = {
  due: Card[]; fresh: Card[];
  counts: { cards: number; due: number; newLeft: number; reviewedToday: number };
  map: { subject: string; cards: number; levels: { new: number; learning: number; known: number; mastered: number }; percent: number }[];
};
const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

/** Spaced review: the question, think, reveal, say how it went; OKB plans the next time. */
export default function Learn() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn'], queryFn: () => get<LearnData>('/api/learn') });
  const progress = useProgress();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const queue = q.data ? [...q.data.due, ...q.data.fresh] : [];
  const card = queue[index];
  const grade = useMutation({
    mutationFn: (rating: (typeof RATINGS)[number]) => post<{ ok: true; level: string }>('/api/learn/grade', { id: card!.id, rating }),
    onSuccess: () => { setShown(false); setIndex((i) => i + 1); void qc.invalidateQueries({ queryKey: ['progress'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!card || e.target instanceof HTMLInputElement) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); }
      else if (shown && ['1', '2', '3', '4'].includes(e.key)) grade.mutate(RATINGS[Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [card, shown, grade]);
  useEffect(() => { if (q.data && index >= queue.length && index > 0) void qc.invalidateQueries({ queryKey: ['learn'] }); }, [index, queue.length, q.data, qc]);

  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const d = q.data;
  return (
    <div className="page">
      <p className="muted">{t('app.learn.intro', { due: d.counts.due, fresh: d.counts.newLeft, cards: d.counts.cards })}</p>
      <section className="panel learn-card" aria-live="polite">
        {card ? (
          <div className="panel-body stack" style={{ gap: 'var(--s5)', alignItems: 'center', textAlign: 'center', padding: 'var(--s8) var(--s6)' }}>
            <p className="xs muted">{t('app.learn.position', { n: index + 1, total: queue.length })} · {card.subject} · {t(`app.learn.level.${card.level}`)}</p>
            <h2 className="learn-front">{card.front}</h2>
            {shown ? (
              <>
                <p className="learn-back">{card.back}</p>
                <a className="small" href={hrefFor({ name: 'brain', path: card.path })}>{t('app.learn.open', { title: card.title })} <ArrowRight size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></a>
                <div className="row wrap" role="group" aria-label={t('app.learn.how')} style={{ justifyContent: 'center' }}>
                  {RATINGS.map((r, i) => (
                    <button key={r} type="button" className={`btn${r === 'good' ? ' primary' : ''}`} disabled={grade.isPending} onClick={() => grade.mutate(r)}>
                      {t(`app.learn.rate.${r}`)}<kbd aria-hidden="true">{i + 1}</kbd>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => setShown(true)}><Eye size={16} aria-hidden="true" />{t('app.learn.reveal')}<kbd aria-hidden="true">␣</kbd></button>
            )}
          </div>
        ) : (
          <Empty title={t('app.learn.doneTitle')}>{d.counts.cards ? t('app.learn.done') : t('app.learn.noCards')}</Empty>
        )}
      </section>
      {progress.data?.show ? (
        <section className="panel" aria-labelledby="prog-h">
          <div className="panel-head"><h2 id="prog-h">{t('app.progress.title')}</h2></div>
          <div className="panel-body grid-2">
            <div className="stack"><ProgressLine data={progress.data} /><p className="xs muted">{t('app.progress.why')}</p></div>
            <Badges badges={progress.data.badges} />
          </div>
        </section>
      ) : null}
      <section className="panel" aria-labelledby="map-h">
        <div className="panel-head"><h2 id="map-h">{t('app.learn.map')}</h2></div>
        {d.map.some((m) => m.percent > 0 || m.levels.learning + m.levels.known + m.levels.mastered > 0) ? (
          <ul className="rows" style={{ paddingTop: 'var(--s2)' }}>
            {d.map.map((m) => (
              <li key={m.subject}>
                <div className="grow"><span className="title">{m.subject}</span><span className="meta">{tn(t, 'app.learn.cards', m.cards)} · {t('app.learn.mastered', { n: m.levels.mastered })}</span></div>
                <span className="bar" style={{ width: 160 }} aria-hidden="true"><span style={{ width: `${m.percent}%` }} /></span>
                <span className="num small" style={{ width: 44, textAlign: 'right' }}>{m.percent} %</span>
              </li>
            ))}
          </ul>
        ) : <Empty title={t('app.learn.mapEmptyTitle')}>{t('app.learn.mapEmpty')}</Empty>}
      </section>
    </div>
  );
}
