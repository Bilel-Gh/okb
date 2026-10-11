import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, FileDiff, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type View = {
  cards: { id: string; title: string; type: string; where: string; why: string; tokens: number }[];
  changes: { id: string; title: string; files: number; created: number; updated: number }[];
  apart: { id: string; title: string; reason: string }[];
  tokens: number; budget: { daily: number; spent: number };
};
type Done = { presence: 'confirmed' | 'refused' | 'unavailable' | 'not-needed'; changes: { id: string; ok: boolean; key?: string }[]; cards: { id: string; ok: boolean; reason?: string }[] };

/**
 * « Oui à tout, sauf… »: what an assistant prepared waits here, all ticked.
 * The person unticks what they do not want and says yes to the rest at once;
 * the changes are confirmed once on their screen, by the local server.
 */
export function Evening() {
  const t = useT();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['evening'], queryFn: () => get<View>('/api/evening') });
  const [out, setOut] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Done | null>(null);
  const data = view.data;
  const ids = data ? [...data.changes.map((c) => c.id), ...data.cards.map((c) => c.id)] : [];
  // What was unticked and is gone (decided elsewhere) is forgotten.
  useEffect(() => { setOut((prev) => new Set([...prev].filter((id) => ids.includes(id)))); }, [ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const yes = useMutation({
    mutationFn: () => post<Done>('/api/evening/yes', { changes: data!.changes.filter((c) => !out.has(c.id)).map((c) => c.id), cards: data!.cards.filter((c) => !out.has(c.id)).map((c) => c.id) }),
    onSuccess: (r) => { setDone(r); for (const key of ['evening', 'suggestions', 'proposals', 'status', 'status-full', 'today', 'notes']) void qc.invalidateQueries({ queryKey: [key] }); },
  });
  if (view.isLoading) return <section className="panel"><SkeletonRows rows={4} /></section>;
  if (view.error || !data) return <section className="panel"><div className="panel-body"><ErrorState error={view.error} retry={() => void view.refetch()} /></div></section>;

  const toggle = (id: string) => setOut((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const picked = ids.filter((id) => !out.has(id)).length;
  const tokens = data.cards.filter((c) => !out.has(c.id)).reduce((n, c) => n + c.tokens, 0);
  const number = (n: number) => n.toLocaleString(t.lang);
  const applied = done?.changes.filter((c) => c.ok).length ?? 0;
  const accepted = done?.cards.filter((c) => c.ok).length ?? 0;
  const unconfirmed = done?.changes.filter((c) => c.key === 'presenceUnavailable').length ?? 0;
  const failed = (done?.changes.filter((c) => !c.ok).length ?? 0) - unconfirmed;
  const overBudget = done?.cards.filter((c) => c.reason === 'budget').length ?? 0;
  const row = (id: string, title: string, meta: string, icon: 'change' | 'card', href?: string) => (
    <li key={id}>
      <input type="checkbox" className="check" checked={!out.has(id)} onChange={() => toggle(id)} aria-label={title} />
      <span className="cat sm" style={{ '--c': 'var(--accent)' } as CSSProperties} aria-hidden="true">{icon === 'change' ? <FileDiff size={14} /> : <Sparkles size={14} />}</span>
      <span className="grow"><span className="title">{title}</span><span className="meta">{meta}</span></span>
      {href ? <span className="actions"><a className="btn sm ghost" href={href}>{t('app.evening.read')}</a></span> : null}
    </li>
  );
  return (
    <>
      <p className="page-intro">{t('app.evening.intro')}</p>
      {done && done.presence === 'refused' ? <p className="notice plain" role="status">{t('app.evening.refused')}</p> : null}
      {done && done.presence !== 'refused' && (applied || accepted) ? <p className="notice ok" role="status"><Check size={16} aria-hidden="true" />{[applied ? tn(t, 'app.evening.doneChanges', applied) : '', accepted ? tn(t, 'app.evening.doneCards', accepted) : ''].filter(Boolean).join(' ')}</p> : null}
      {unconfirmed || failed > 0 || overBudget ? (
        <div className="notice warn" role="alert">
          <span>{[unconfirmed ? t('app.evening.noPresence', { n: unconfirmed }) : '', failed > 0 ? t('app.evening.failed', { n: failed }) : '', overBudget ? t('app.evening.overBudget', { n: overBudget }) : ''].filter(Boolean).join(' ')}</span>
        </div>
      ) : null}
      {yes.error ? <p className="notice err" role="alert">{(yes.error as Error).message}</p> : null}
      {ids.length ? (
        <section className="panel evening">
          {data.changes.length ? (
            <>
              <div className="panel-head"><h2><FileDiff size={17} aria-hidden="true" />{t('app.evening.changes')}</h2></div>
              <ul className="rows">{data.changes.map((c) => row(c.id, c.title, tn(t, 'app.evening.change', c.files), 'change', hrefFor({ name: 'inbox', tab: 'proposals', id: c.id })))}</ul>
            </>
          ) : null}
          {data.cards.length ? (
            <>
              <div className="panel-head"><h2><Sparkles size={17} aria-hidden="true" />{t('app.evening.cards')}</h2></div>
              <ul className="rows">{data.cards.map((c) => row(c.id, c.title, `${c.where} · ≈ ${Math.round(c.tokens / 1000)}k tokens`, 'card'))}</ul>
            </>
          ) : null}
          <div className="evening-foot">
            <span className="small muted">{tokens ? t('app.evening.cost', { tokens: number(tokens), spent: number(data.budget.spent), daily: number(data.budget.daily) }) : ''}</span>
            <button type="button" className="btn primary" disabled={!picked || yes.isPending} aria-busy={yes.isPending || undefined} onClick={() => { setDone(null); yes.mutate(); }}>
              <CheckCheck size={16} aria-hidden="true" />{picked ? tn(t, 'app.evening.yes', picked) : t('app.evening.none')}
            </button>
          </div>
        </section>
      ) : !data.apart.length ? <section className="panel"><Empty icon={<Check size={22} />} title={t('app.evening.emptyTitle')}>{t('app.evening.empty')}</Empty></section> : null}
      {data.apart.length ? (
        <section className="panel">
          <div className="panel-head"><h2>{t('app.evening.apart')}</h2></div>
          <p className="muted small action-empty">{t('app.evening.apartWhy')}</p>
          <ul className="rows">{data.apart.map((p) => <li key={p.id}><span className="grow"><a className="title" href={hrefFor({ name: 'inbox', tab: 'proposals', id: p.id })}>{p.title}</a><span className="meta">{p.reason}</span></span></li>)}</ul>
        </section>
      ) : null}
    </>
  );
}
