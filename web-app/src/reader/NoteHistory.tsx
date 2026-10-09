import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { Prose } from './Prose';

type Version = { n: number; at: string; action: string; path: string };

const when = (iso: string, lang: string) => new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Every version of a note OKB kept (no Git needed): read one, restore it through a proposal. */
export function NoteHistory({ path, setTitle }: { path: string; setTitle: (s: string) => void }) {
  const t = useT();
  const list = useQuery({ queryKey: ['history', path], queryFn: () => get<{ versions: Version[] }>('/api/history', { path }) });
  const [picked, setPicked] = useState<number | null>(null);
  const one = useQuery({ queryKey: ['history', path, picked], queryFn: () => get<{ version: Version; html: string | null }>('/api/history', { path, n: picked! }), enabled: picked !== null });
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  useEffect(() => { setTitle(`${t('web.versions.title')} · ${name}`); }, [name, setTitle, t]);
  useEffect(() => { if (picked === null && list.data?.versions.length) setPicked(list.data.versions[0]!.n); }, [list.data, picked]);

  const restore = async (n: number) => {
    try {
      const r = await post<{ proposalId: string | null }>('/api/history/restore', { path, n });
      if (r.proposalId) { toast(t('history.restoreProposed', { n })); go({ name: 'inbox', tab: 'proposals', id: r.proposalId }); } else toast(t('history.same'));
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="history">
      <a className="btn ghost sm" href={hrefFor({ name: 'brain', path })}><ArrowLeft size={15} aria-hidden="true" />{name}</a>
      <h1 className="note-title">{t('web.versions.title')}</h1>
      {list.isLoading ? <SkeletonRows rows={6} /> : list.error ? <ErrorState error={list.error} retry={() => void list.refetch()} /> : !list.data?.versions.length ? (
        <Empty icon={<History size={22} />} title={t('web.versions.noneTitle')}>{t('history.none')}</Empty>
      ) : (
        <div className="history-grid">
          <ol className="history-list">
            {list.data.versions.map((v) => (
              <li key={v.n}>
                <button type="button" aria-pressed={picked === v.n} onClick={() => setPicked(v.n)}>
                  <span className="history-n num">#{v.n}</span>
                  <span className="grow"><b>{t(`history.action.${v.action}`)}</b><small className="muted">{when(v.at, t.lang)}{v.path !== path ? ` · ${v.path}` : ''}</small></span>
                </button>
              </li>
            ))}
          </ol>
          <section className="panel history-view">
            {picked === null ? <p className="muted">{t('web.versions.pick')}</p> : one.isLoading ? <SkeletonRows rows={8} /> : one.data ? (
              <>
                <div className="panel-head">
                  <h2>#{one.data.version.n} · {t(`history.action.${one.data.version.action}`)}</h2>
                  <span className="spacer" />
                  {one.data.version.action !== 'current' ? <button type="button" className="btn sm primary" onClick={() => void restore(one.data!.version.n)}><RotateCcw size={14} aria-hidden="true" />{t('web.versions.restore')}</button> : null}
                </div>
                <div className="panel-body">{one.data.html ? <Prose html={one.data.html} dropTitle /> : <p className="muted">{t('history.none')}</p>}</div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
