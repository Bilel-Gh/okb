import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, FileText, Globe, Link as LinkIcon, PenLine, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { get } from '../app/api';
import { tn, useT } from '../app/i18n';

export type ProvenanceData = {
  writtenBy: 'ai' | 'person' | 'unknown'; writtenAt: string | null; updatedAt: string | null; approved: { at: string } | null;
  sources: { title: string; resource: string | null; kind: 'local' | 'web' | 'other'; claims: number }[];
  verified: boolean; staleAfter: string | null; stale: boolean;
};
type Freshness = { sources: { resource: string; state: 'unchanged' | 'changed' | 'missing' | 'unknown' }[] };

/**
 * Sources and validity, under every note (F2.0-27): where what it says comes
 * from, who wrote it, when the person approved it, until when it holds. Whether
 * a local source changed since it was read is checked on request, never guessed.
 */
export function Provenance({ path, data }: { path: string; data: ProvenanceData }) {
  const t = useT();
  const [asked, setAsked] = useState(false);
  const fresh = useQuery({ queryKey: ['freshness', path], queryFn: () => get<Freshness>('/api/note/freshness', { path }), enabled: asked });
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.lang, { day: 'numeric', month: 'long', year: 'numeric' });
  const stateOf = (resource: string | null) => fresh.data?.sources.find((s) => s.resource === resource)?.state;
  const changed = fresh.data?.sources.some((s) => s.state === 'changed') ?? false;
  const local = data.sources.some((s) => s.kind === 'local');
  const Author = data.writtenBy === 'person' ? PenLine : Sparkles;
  return (
    <details className="note-sources" id="sources" open={data.stale || changed || undefined}>
      <summary>
        <ShieldCheck size={16} aria-hidden="true" /><b>{t('app.prov.title')}</b>
        <span className="muted small">{tn(t, 'app.note.sources', data.sources.length)}{data.approved ? ` · ${t('app.prov.approvedShort', { date: date(data.approved.at) })}` : ''}</span>
        {data.stale ? <span className="pill sm warn"><TriangleAlert size={12} aria-hidden="true" />{t('app.note.toReview')}</span> : null}
      </summary>
      <div className="note-sources-body">
        <section>
          <h3>{t('app.prov.sources')}</h3>
          {data.sources.length ? (
            <ul>
              {data.sources.map((s) => {
                const state = stateOf(s.resource);
                const Icon = s.kind === 'web' ? Globe : s.kind === 'local' ? FileText : LinkIcon;
                return (
                  <li key={`${s.resource}|${s.title}`}>
                    <Icon size={15} aria-hidden="true" />
                    <span><b>{s.title}</b><small>{t(`app.prov.kind.${s.kind}`)}{s.claims ? ` · ${tn(t, 'app.prov.claims', s.claims)}` : ''}</small></span>
                    {state ? <span className={`pill sm${state === 'changed' || state === 'missing' ? ' warn' : state === 'unchanged' ? ' ok' : ''}`}>{t(`app.prov.state.${state}`)}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted small">{t('app.prov.noSources')}</p>}
          {local ? (
            <p className="row">
              <button type="button" className="btn sm" onClick={() => { if (asked) void fresh.refetch(); else setAsked(true); }} aria-busy={fresh.isFetching || undefined} disabled={fresh.isFetching}><RefreshCw size={14} aria-hidden="true" />{t('app.prov.check')}</button>
            </p>
          ) : null}
          {changed ? <p className="notice warn small"><TriangleAlert size={15} aria-hidden="true" />{t('app.prov.changedHint')}</p> : null}
          {fresh.error ? <p className="notice warn small">{(fresh.error as Error).message}</p> : null}
        </section>
        <section>
          <h3>{t('app.prov.who')}</h3>
          <ul>
            <li><Author size={15} aria-hidden="true" /><span>{t(`app.prov.by.${data.writtenBy}`)}{data.writtenAt ? ` ${t('app.prov.on', { date: date(data.writtenAt) })}` : ''}</span></li>
            {data.approved ? <li><Check size={15} aria-hidden="true" /><span>{t('app.prov.approved', { date: date(data.approved.at) })}</span></li> : data.writtenBy === 'ai' ? <li><TriangleAlert size={15} aria-hidden="true" /><span>{t('app.prov.notApproved')}</span></li> : null}
            {data.verified ? <li><ShieldCheck size={15} aria-hidden="true" /><span>{t('app.prov.verified')}</span></li> : null}
          </ul>
          <h3>{t('app.prov.validity')}</h3>
          <ul>
            <li><CalendarClock size={15} aria-hidden="true" /><span>{data.staleAfter ? t(data.stale ? 'app.prov.stale' : 'app.prov.until', { date: date(data.staleAfter) }) : t('app.prov.noLimit')}</span></li>
          </ul>
        </section>
      </div>
    </details>
  );
}
