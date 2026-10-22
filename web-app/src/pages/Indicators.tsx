import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Clock, GraduationCap, PenLine, type LucideIcon } from 'lucide-react';
import { get } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { ErrorState, SkeletonRows } from '../ui/States';

type Gap = { id: string; count: number; examples: { title: string; path?: string }[]; action: { kind: 'note' | 'route' | 'command'; to: string } };
type Indicator = { id: 'coverage' | 'freshness' | 'quality' | 'understanding'; value: number | null; of: { have: number; total: number }; gaps: Gap[] };

const ICON: Record<Indicator['id'], LucideIcon> = { coverage: BookOpen, freshness: Clock, quality: PenLine, understanding: GraduationCap };

/**
 * Four indicators, apart: one figure for everything would hide a hole. Each
 * says what it is made of, and each gap is a link to what to do. Where there
 * is nothing to measure, there is no figure.
 */
export function Indicators() {
  const t = useT();
  const r = useQuery({ queryKey: ['indicators'], queryFn: () => get<{ indicators: Indicator[] }>('/api/indicators') });
  if (r.isLoading) return <section className="panel"><SkeletonRows rows={4} /></section>;
  if (r.error || !r.data) return <section className="panel"><div className="panel-body"><ErrorState error={r.error} retry={() => void r.refetch()} /></div></section>;
  const href = (g: Gap) => (g.action.kind === 'note' ? hrefFor({ name: 'brain', path: g.action.to }) : g.action.to === 'learn' ? hrefFor({ name: 'learn' }) : g.action.to === 'review' ? hrefFor({ name: 'inbox', tab: 'toreview' }) : null);
  return (
    <section className="panel" aria-labelledby="indicators-h">
      <div className="panel-head"><h2 id="indicators-h">{t('app.indicators.title')}</h2></div>
      <ul className="indicators">
        {r.data.indicators.map((i) => {
          const Icon = ICON[i.id];
          return (
            <li key={i.id} className="indicator">
              <div className="indicator-head">
                <span className="cat sm" aria-hidden="true"><Icon size={14} /></span>
                <h3>{t(`indicator.${i.id}`)}</h3>
                {i.value === null ? null : <b className="num">{i.value}<small>{i.id === 'quality' ? '/100' : ' %'}</small></b>}
              </div>
              <p className="small muted">{i.value === null ? t('indicator.none') : t(`indicator.${i.id}.of`, { have: i.of.have, total: i.of.total })}</p>
              {i.gaps.length ? (
                <ul className="indicator-gaps">
                  {i.gaps.map((g) => {
                    const label = t(`indicator.gap.${g.id}`, { n: g.count });
                    const to = href(g);
                    return (
                      <li key={g.id}>
                        {to ? <a className="link" href={to}>{label}<ArrowRight size={13} aria-hidden="true" /></a> : <span>{label}</span>}
                        {g.examples.length ? <span className="muted small"> {g.examples.slice(0, 3).map((e) => e.title).join(', ')}</span> : null}
                        {g.action.kind === 'command' ? <code className="xs">{g.action.to}</code> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : i.value !== null ? <p className="small indicator-ok">{t('app.indicators.noGap')}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
