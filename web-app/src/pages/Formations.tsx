import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, Check, GraduationCap, Layers } from 'lucide-react';
import { get } from '../app/api';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import '../styles/work.css';

type Step = { path: string; title: string; level: string | null; cards: number; due: number; done: boolean };
type Formation = { path: string; title: string; description: string; goal: 'revision' | 'certification' | 'skill'; by: string | null; daysLeft: number | null; steps: Step[]; percent: number; next: Step | null; due: number };

const noteLink = (path: string) => hrefFor({ name: 'brain', path, query: { understand: '1' } });

/** Chantier 5: the learning paths agents prepared, each with its goal, its deadline, its steps and its cards. */
export function Formations() {
  const w = useShareWords();
  const q = useQuery({ queryKey: ['formations'], queryFn: () => get<{ formations: Formation[] }>('/api/formations') });
  if (q.isLoading) return <SkeletonRows rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const goal = (g: Formation['goal']) => g === 'certification' ? w('Certification', 'Certification') : g === 'revision' ? w('Révision', 'Revision') : w('Monter en compétence', 'Skill up');
  if (!q.data.formations.length) return <section className="panel"><div className="panel-body"><Empty icon={<GraduationCap size={22} />} title={w('Aucune formation pour l’instant', 'No formation yet')}>{w('Demande à Claude : « prépare-moi une formation sur … pour le … ». Elle arrive comme une note à relire, ses liens dans l’ordre sont les étapes.', 'Ask Claude: « prepare a formation on … for … ». It arrives as a note to review; its links, in order, are the steps.')}</Empty></div></section>;
  return <div className="stack lg">{q.data.formations.map((f) => <section className="panel formation" key={f.path} aria-labelledby={`f-${f.path}`}>
    <div className="panel-head"><h2 id={`f-${f.path}`}><GraduationCap size={17} aria-hidden="true" /><a href={noteLink(f.path)}>{f.title}</a></h2><span className="pill sm">{goal(f.goal)}</span></div>
    <div className="panel-body stack">
      {f.description ? <p className="muted">{f.description}</p> : null}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="grow"><div className="formation-bar" role="progressbar" aria-valuenow={f.percent} aria-valuemin={0} aria-valuemax={100} aria-label={w('Avancement', 'Progress')}><span style={{ width: `${f.percent}%` }} /></div><span className="meta">{f.percent} % · {f.steps.filter((s) => s.done).length}/{f.steps.length} {w('étapes expliquées', 'steps explained')}</span></div>
        {f.by ? <span className={`pill sm${f.daysLeft !== null && f.daysLeft <= 7 ? ' warn' : ''}`}><CalendarClock size={13} aria-hidden="true" />{f.daysLeft !== null && f.daysLeft >= 0 ? w(`J-${f.daysLeft}`, `${f.daysLeft} days left`) : w('Échéance passée', 'Past due')} · {new Date(f.by).toLocaleDateString()}</span> : null}
        {f.due ? <a className="btn sm" href={hrefFor({ name: 'learn' })}><Layers size={14} aria-hidden="true" />{w(`${f.due} carte(s) à réviser`, `${f.due} card(s) to review`)}</a> : null}
      </div>
      {f.next ? <a className="btn sm primary" href={noteLink(f.next.path)}>{w('Étape suivante : ', 'Next step: ')}{f.next.title}<ArrowRight size={14} aria-hidden="true" /></a> : f.steps.length ? <p className="ok-ink">{w('Toutes les étapes sont expliquées.', 'Every step is explained.')}</p> : null}
      <details><summary>{w('Les étapes', 'The steps')}</summary><ol className="formation-steps">{f.steps.map((s) => <li key={s.path} className={s.done ? 'muted' : undefined}>{s.done ? <Check size={13} aria-hidden="true" /> : null}<a href={noteLink(s.path)}>{s.title}</a>{s.cards ? <span className="meta"> · {s.cards} {w('carte(s)', 'card(s)')}{s.due ? `, ${s.due} ${w('à revoir', 'due')}` : ''}</span> : null}</li>)}</ol></details>
    </div>
  </section>)}</div>;
}
