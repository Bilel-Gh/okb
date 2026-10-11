import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, Flag, FlaskConical, GitCommitHorizontal, PenLine, Scale, Sparkles, TriangleAlert, Users, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '../app/api';
import { useT, type Translate } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';

export type Action = {
  id: string; projectId: string | null; text: string; kind: 'todo' | 'waiting' | 'asked' | 'question'; who: string | null; due: string | null;
  status: 'open' | 'done' | 'dropped'; source: 'person' | 'ai'; createdAt: string; doneAt: string | null;
  late?: boolean; project?: { id: string; title: string } | null;
};
export type Entry = { id: string; projectId: string | null; project: { id: string; title: string } | null; at: string; day: string; kind: string; text: string; source: string };
export type LeftOff = { done: string; tried: string; waiting: string; resume: string; at: string; edited: boolean };
type Detected = { action: { kind: 'todo' | 'waiting'; text: string; due?: string; who?: string } | null };

const dayOf = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** A day said the way people say it: today, tomorrow, yesterday, else the date. */
export function dayLabel(day: string, t: Translate): string {
  const today = dayOf(new Date());
  const delta = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (delta >= -1 && delta <= 1) return new Intl.RelativeTimeFormat(t.lang, { numeric: 'auto' }).format(delta, 'day');
  return new Date(`${day}T12:00:00`).toLocaleDateString(t.lang, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** What changes when an action or a journal line changes: the day, the project, its lists. */
export function useRefreshDay() {
  const qc = useQueryClient();
  return () => { for (const key of ['today', 'actions', 'entries', 'project', 'projects']) void qc.invalidateQueries({ queryKey: [key] }); };
}

/**
 * Actions as a list to tick: the text, whose it is and for when. Adding one
 * reads the line first: « réserver le car avant le 15 mai » gets its date.
 */
export function ActionList({ actions, project, kind, placeholder, empty, showProject = false }: {
  actions: readonly Action[]; project?: string; kind: 'todo' | 'waiting' | 'question'; placeholder: string; empty: string; showProject?: boolean;
}) {
  const t = useT();
  const refresh = useRefreshDay();
  const [text, setText] = useState('');
  const today = dayOf(new Date());
  const update = useMutation({
    mutationFn: (patch: { id: string; status: Action['status'] }) => post('/api/action/update', patch),
    onSuccess: refresh, onError: (e) => toast((e as Error).message, 'err'),
  });
  const add = useMutation({
    mutationFn: async () => {
      // A waiting line reads as « j'attends … »: the name in it is who it is expected from.
      const probe = kind === 'waiting' ? `${t.lang === 'fr' ? 'j’attends' : 'waiting for'} ${text}` : text;
      const spotted = kind === 'question' ? null : (await get<Detected>('/api/actions/detect', { text: probe }).catch(() => ({ action: null }))).action;
      const body = spotted && (kind !== 'waiting' || spotted.kind === 'waiting')
        ? { text: spotted.text, kind: kind === 'waiting' ? 'waiting' : spotted.kind, ...(spotted.due ? { due: spotted.due } : {}), ...(spotted.who ? { who: spotted.who } : {}) }
        : { text: text.trim(), kind };
      return post('/api/actions', { ...body, ...(project ? { project } : {}) });
    },
    onSuccess: () => { setText(''); refresh(); }, onError: (e) => toast((e as Error).message, 'err'),
  });
  return (
    <div className="actions">
      {actions.length ? (
        <ul className="rows tight action-rows">
          {actions.map((a) => (
            <li key={a.id}>
              {kind === 'waiting'
                ? <span className="who" aria-hidden="true">{(a.who ?? '?').slice(0, 2)}</span>
                : <button type="button" className="tick" role="checkbox" aria-checked="false" aria-label={t('app.actions.markDone', { text: a.text })} onClick={() => update.mutate({ id: a.id, status: 'done' })} />}
              <span className="grow">
                <span className="title">{a.text}</span>
                <span className="meta">
                  {[showProject && a.project ? a.project.title : null, a.who && kind !== 'waiting' ? a.who : null, kind === 'waiting' && a.who ? t('app.actions.from', { who: a.who }) : null, a.source === 'ai' ? t('app.actions.byAi') : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {a.due ? <span className={`due${a.due < today ? ' late' : ''}`}>{dayLabel(a.due, t)}</span> : null}
              <span className="actions-end">
                {kind === 'waiting' ? <button type="button" className="btn sm ghost" onClick={() => update.mutate({ id: a.id, status: 'done' })}><Check size={14} aria-hidden="true" />{t('app.actions.received')}</button> : null}
                <button type="button" className="btn sm ghost icon" aria-label={t('app.actions.drop', { text: a.text })} title={t('app.actions.dropShort')} onClick={() => update.mutate({ id: a.id, status: 'dropped' })}><X size={14} aria-hidden="true" /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted small action-empty">{empty}</p>}
      <form className="action-add" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !add.isPending) add.mutate(); }}>
        <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={300} />
        <button type="submit" className="btn sm" disabled={!text.trim() || add.isPending}>{t('app.actions.add')}</button>
      </form>
    </div>
  );
}

const KIND_ICON: Record<string, LucideIcon> = {
  note: PenLine, decision: Scale, done: Check, tried: FlaskConical, meeting: Users, ai: Sparkles, resume: Flag, commit: GitCommitHorizontal, trap: TriangleAlert, question: CircleHelp,
};
const WRITE_KINDS = ['note', 'decision', 'done', 'tried', 'meeting'] as const;

/** The journal, by day: what happened, was decided, tried and done. The person adds a line when they wish. */
export function JournalList({ entries, project, showProject = false, canAdd = true, empty }: { entries: readonly Entry[]; project?: string; showProject?: boolean; canAdd?: boolean; empty: string }) {
  const t = useT();
  const refresh = useRefreshDay();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<(typeof WRITE_KINDS)[number]>('note');
  const add = useMutation({
    mutationFn: () => post('/api/entries', { text: text.trim(), kind, ...(project ? { project } : {}) }),
    onSuccess: () => { setText(''); refresh(); }, onError: (e) => toast((e as Error).message, 'err'),
  });
  const days = [...new Set(entries.map((e) => e.day))];
  const time = (iso: string) => new Date(iso).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="journal">
      {canAdd ? (
        <form className="journal-add" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !add.isPending) add.mutate(); }}>
          <select className="select sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t('app.journal.kind')}>
            {WRITE_KINDS.map((k) => <option key={k} value={k}>{t(`app.journal.kind.${k}`)}</option>)}
          </select>
          <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('app.journal.placeholder')} aria-label={t('app.journal.placeholder')} maxLength={600} />
          <button type="submit" className="btn sm" disabled={!text.trim() || add.isPending}>{t('app.journal.add')}</button>
        </form>
      ) : null}
      {entries.length ? days.map((day) => (
        <section key={day}>
          <h3 className="journal-day">{dayLabel(day, t)}</h3>
          <ul className="journal-rows">
            {entries.filter((e) => e.day === day).map((e) => {
              const Icon = KIND_ICON[e.kind] ?? PenLine;
              return (
                <li key={e.id}>
                  <time dateTime={e.at}>{time(e.at)}</time>
                  <span className={`journal-kind ${e.kind}`} title={t(`app.journal.kind.${e.kind}`)}><Icon size={14} aria-hidden="true" /></span>
                  <span className="grow"><span>{e.kind === 'resume' ? t('app.journal.resumeLine', { text: e.text }) : e.text}</span>{showProject && e.project ? <a className="meta" href={hrefFor({ name: 'projects', id: e.project.id })}>{e.project.title}</a> : null}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )) : <p className="muted small">{empty}</p>}
    </div>
  );
}
