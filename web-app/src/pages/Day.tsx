import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { get } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import type { Entry } from './day-parts';

type DayView = { day: string; entries: Entry[]; previous: string; next: string | null };

/** The words a person uses for a day; the server says which day they mean. Checked here so an ordinary search asks nothing more. */
export function looksLikeDay(query: string): boolean {
  const text = query.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'");
  return /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hier|yesterday|aujourd'?hui|today)\b/.test(text)
    || /\b\d{4}-\d{2}-\d{2}\b/.test(text) || /\b\d{1,2}\/\d{1,2}\b/.test(text)
    || /\b\d{1,2}(er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text);
}

export const dayTitle = (day: string, lang: string) => new Date(`${day}T12:00:00`).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** « Ce que j'ai fait mardi »: one day of the journal, the latest line first. */
export default function DayPage({ day, setTitle }: { day: string; setTitle?: (s: string) => void }) {
  const t = useT();
  const r = useQuery({ queryKey: ['day', day], queryFn: () => get<DayView>('/api/day', { day }) });
  const view = r.data;
  if (view && setTitle) setTitle(dayTitle(view.day, t.lang));
  const time = (iso: string) => new Date(iso).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="page">
      <div className="page-head">
        <h2 className="day-title"><CalendarDays size={18} aria-hidden="true" />{t('app.day.title')} · {dayTitle(view?.day ?? day, t.lang)}</h2>
        <span className="spacer" />
        {view ? <a className="btn sm ghost icon" href={hrefFor({ name: 'day', day: view.previous })} aria-label={t('app.day.previous')} title={t('app.day.previous')}><ChevronLeft size={16} aria-hidden="true" /></a> : null}
        {view?.next ? <a className="btn sm ghost icon" href={hrefFor({ name: 'day', day: view.next })} aria-label={t('app.day.next')} title={t('app.day.next')}><ChevronRight size={16} aria-hidden="true" /></a> : null}
      </div>
      <section className="panel">
        {r.isLoading ? <SkeletonRows rows={4} /> : r.error || !view ? <div className="panel-body"><ErrorState error={r.error} retry={() => void r.refetch()} /></div> : view.entries.length ? (
          <ul className="rows tight day-rows">
            {view.entries.map((e) => (
              <li key={e.id}>
                <span className="meta num">{time(e.at)}</span>
                <span className="pill sm">{t(`app.journal.kind.${e.kind}`)}</span>
                <span className="grow"><span>{e.text}</span></span>
                {e.project ? <a className="link small" href={hrefFor({ name: 'projects', id: e.project.id })}>{e.project.title}</a> : null}
              </li>
            ))}
          </ul>
        ) : <Empty icon={<CalendarDays size={22} />} title={t('app.day.nothing')}>{t('app.day.nothingHint')}</Empty>}
      </section>
    </div>
  );
}
