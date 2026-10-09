import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, GraduationCap, Minus, Plus, Trash2, X } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { ConfirmDialog } from '../ui/Confirm';
import { Ring } from '../ui/Ring';
import { ErrorState, SkeletonRows } from '../ui/States';

type Grade = 'right' | 'partial' | 'wrong' | 'ungraded';
type Reference = 'expected' | 'person' | 'code' | 'none';
type Item = { id: string; question: string; custom: boolean; answer: string; found: number; notes: string[]; grade: Grade; why: string; reference: Reference };
type Result = { at: string; score: number | null; counts: Record<Grade, number>; items: Item[]; tokens: number; history: { at: string; score: number | null }[] };
type Plan = { questions: { id: string; text: string; custom: boolean; reference: Reference; found: number }[]; tokens: number; budget: { spent: number; daily: number } };
type ExamData = { repo: { id: string; name: string }; plan: Plan; last: Result | null; custom: { id: string; text: string; expected: string }[]; ai: boolean };

const ORDER: Record<Grade, number> = { wrong: 0, partial: 1, right: 2, ungraded: 3 };
const MARK: Record<Grade, ReactNode> = {
  right: <Check size={14} strokeWidth={2.5} aria-hidden="true" />,
  partial: <span className="half" aria-hidden="true" />,
  wrong: <X size={14} strokeWidth={2.5} aria-hidden="true" />,
  ungraded: <Minus size={14} strokeWidth={2.5} aria-hidden="true" />,
};
const REASONS = new Set(['not-found', 'not-in-notes', 'no-answer', 'no-reference', 'undecided']);
const SHOWN = 6;

const day = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
const tone = (score: number) => (score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--err)');

function ItemRow({ item }: { item: Item }) {
  const t = useT();
  const why = REASONS.has(item.why) ? t(`exam.why.${item.why}`) : item.why;
  return (
    <li className="exam-item" data-grade={item.grade}>
      <details>
        <summary>
          <span className="exam-mark" title={t(`app.exam.grade.${item.grade}`)}>{MARK[item.grade]}<span className="sr-only">{t(`app.exam.grade.${item.grade}`)}</span></span>
          <span className="grow">
            <span className="title">{item.question}</span>
            {why ? <span className="meta">{why}</span> : null}
          </span>
          <ChevronDown size={16} className="exam-chev" aria-hidden="true" />
        </summary>
        <div className="exam-answer">
          {item.answer ? <p>{item.answer}</p> : <p className="muted">{t('app.exam.noAnswer')}</p>}
          <p className="small muted">
            {t('app.exam.checkedWith', { ref: t(`exam.reference.${item.reference}`) })}
            {item.notes.length ? <> · {t('app.exam.from')} {item.notes.slice(0, 3).map((n, i) => <span key={n}>{i ? ', ' : ''}<a href={hrefFor({ name: 'brain', path: n })}>{n.split('/').pop()?.replace(/\.md$/, '')}</a></span>)}</> : null}
          </p>
        </div>
      </details>
    </li>
  );
}

function TeamQuestions({ repo, custom }: { repo: string; custom: ExamData['custom'] }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [expected, setExpected] = useState('');
  const change = useMutation({
    mutationFn: (body: Record<string, unknown>) => post('/api/repos/exam/question', { repo, ...body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['exam', repo] }); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const add = (e: FormEvent) => {
    e.preventDefault();
    change.mutate({ text, expected }, { onSuccess: () => { setText(''); setExpected(''); toast(t('app.exam.added')); } });
  };
  return (
    <details className="exam-team">
      <summary><span className="grow">{t('app.exam.team')}</span><span className="pill sm num">{custom.length}</span><ChevronDown size={16} className="exam-chev" aria-hidden="true" /></summary>
      <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
        <p className="small muted">{t('app.exam.teamWhy')}</p>
        {custom.length ? (
          <ul className="rows tight">
            {custom.map((q) => (
              <li key={q.id}>
                <span className="grow"><span className="title">{q.text}</span><span className="meta">{t('app.exam.expects', { answer: q.expected })}</span></span>
                <button type="button" className="btn sm ghost icon" aria-label={t('app.exam.remove')} title={t('app.exam.remove')} onClick={() => change.mutate({ remove: q.id })}><Trash2 size={15} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <form className="exam-form" onSubmit={add}>
          <div className="field"><label htmlFor="exam-q">{t('app.exam.question')}</label><input id="exam-q" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('app.exam.questionHint')} /></div>
          <div className="field"><label htmlFor="exam-a">{t('app.exam.expected')}</label><input id="exam-a" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={t('app.exam.expectedHint')} /></div>
          <button type="submit" className="btn sm" disabled={text.trim().length < 5 || !expected.trim() || change.isPending}><Plus size={15} aria-hidden="true" />{t('app.exam.add')}</button>
        </form>
      </div>
    </details>
  );
}

/**
 * The knowledge exam of a repository: Claude answers its questions from the
 * notes only, each answer checked against the code, a person's answer or the
 * expected one. The cost is said before the yes.
 */
export function ExamPanel({ repo, color }: { repo: string; color: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [all, setAll] = useState(false);
  const d = useQuery({ queryKey: ['exam', repo], queryFn: () => get<ExamData>('/api/repos/exam', { repo }) });
  const run = useMutation({
    mutationFn: () => post<{ exam: Result }>('/api/repos/exam', { repo }),
    onSuccess: (r) => { toast(r.exam.score === null ? t('app.exam.doneNoScore') : t('app.exam.done', { score: r.exam.score })); void qc.invalidateQueries({ queryKey: ['exam', repo] }); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (d.isLoading) return <section className="panel"><div className="panel-body"><SkeletonRows rows={3} /></div></section>;
  if (d.error || !d.data) return <section className="panel"><ErrorState error={d.error} retry={() => void d.refetch()} /></section>;
  const { plan, last, custom, ai } = d.data;
  const answerable = plan.questions.filter((q) => q.found > 0).length;
  const gradable = plan.questions.filter((q) => q.reference !== 'none').length;
  const items = last ? [...last.items].sort((a, b) => ORDER[a.grade] - ORDER[b.grade]) : [];
  const shown = all ? items : items.slice(0, SHOWN);
  const before = last?.history[1];
  const delta = last && before && last.score !== null && before.score !== null ? last.score - before.score : null;
  return (
    <section className="panel exam" style={{ '--c': color } as CSSProperties}>
      <div className="panel-head">
        <h2><GraduationCap size={17} aria-hidden="true" />{t('app.exam.title')}</h2>
        <span className="spacer" />
        {last?.score !== null && last ? <span className="pill sm num">{last.score} %</span> : null}
      </div>
      <div className="panel-body stack">
        <p className="small muted">{t('app.exam.intro')}</p>
        {last ? (
          <div className="exam-summary">
            {last.score !== null ? <Ring score={last.score} tone={tone(last.score)} label={t('app.exam.scoreLabel', { score: last.score })} /> : <span className="ring" style={{ '--v': 0 } as CSSProperties}><span className="num">—</span></span>}
            <div className="stack" style={{ gap: 8 }}>
              <div className="exam-counts">
                {(['right', 'partial', 'wrong', 'ungraded'] as const).map((g) => <span key={g} className="exam-count" data-grade={g}><span className="exam-mark">{MARK[g]}</span><span className="num">{last.counts[g]}</span> {t(`app.exam.grade.${g}`)}</span>)}
              </div>
              <p className="small muted">
                {t('app.exam.when', { day: day(last.at, t.lang), tokens: last.tokens.toLocaleString(t.lang) })}
                {delta && before ? <> · <span className={delta > 0 ? 'ok-ink' : delta < 0 ? 'err-ink' : ''}>{t('app.exam.delta', { delta: `${delta > 0 ? '+' : ''}${delta}`, day: day(before.at, t.lang) })}</span></> : null}
              </p>
            </div>
          </div>
        ) : null}
        {items.length ? (
          <>
            <ul className="exam-items">{shown.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
            {items.length > SHOWN ? <button type="button" className="btn sm ghost" onClick={() => setAll(!all)}>{all ? t('app.exam.less') : tn(t, 'app.exam.more', items.length - SHOWN)}</button> : null}
          </>
        ) : null}
        {!gradable ? <div className="notice info small">{t('app.exam.noReference')}</div> : null}
        {!ai ? <div className="notice warn small">{t('app.exam.noAi')}</div> : null}
        <div className="exam-run">
          <p className="small muted grow">{t('app.exam.plan', { n: plan.questions.length, answerable, gradable })}</p>
          <button type="button" className="btn primary" disabled={!ai || !plan.tokens || run.isPending} onClick={() => setAsking(true)}>
            <GraduationCap size={16} aria-hidden="true" />{run.isPending ? t('app.exam.running') : last ? t('app.exam.again') : t('app.exam.take')}
          </button>
        </div>
      </div>
      <TeamQuestions repo={repo} custom={custom} />
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t('app.exam.confirmTitle')} confirm={t('app.exam.take')} onConfirm={() => run.mutateAsync().then(() => undefined)}>
        {t('app.exam.confirmWhy', { tokens: plan.tokens.toLocaleString(t.lang), left: Math.max(0, plan.budget.daily - plan.budget.spent).toLocaleString(t.lang) })}
      </ConfirmDialog>
    </section>
  );
}
