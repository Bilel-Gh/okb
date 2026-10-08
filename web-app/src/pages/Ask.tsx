import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type Passage = { n: number; path: string; title: string; text: string; line: number; secret?: boolean };
type AskData = { question: string; passages: Passage[]; notes: { path: string; title: string }[] };
type Answer = { ok: true; answer: string; tokens: number; used: number[] };

/** An answer's citations [n] become links to their passage. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return <p className="ask-answer">{parts.map((p, i) => (/^\[\d+\]$/.test(p) ? <a key={i} href={`#p-${p.slice(1, -1)}`} className="cite" onClick={(e) => { e.preventDefault(); document.getElementById(`p-${p.slice(1, -1)}`)?.scrollIntoView({ block: 'center' }); }}>{p}</a> : p))}</p>;
}

/** Ask your brain: the passages of your notes that answer, then — on request — an answer written from them. */
export default function AskPage({ route }: { route: Extract<Route, { name: 'ask' }> }) {
  const t = useT();
  const [q, setQ] = useState(route.q ?? '');
  useEffect(() => { setQ(route.q ?? ''); }, [route.q]);
  const asked = (route.q ?? '').trim();
  const data = useQuery({ queryKey: ['ask', asked], queryFn: () => get<AskData>('/api/ask', { q: asked }), enabled: asked.length > 1 });
  const answer = useMutation({ mutationFn: () => post<Answer>('/api/ask/answer', { q: asked }) });
  useEffect(() => { answer.reset(); }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <p className="muted">{t('app.ask.intro')}</p>
      <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go({ name: 'ask', q: q.trim() }); }}>
        <div className="search-field" style={{ flex: 1 }}>
          <Search size={16} aria-hidden="true" />
          <input className="input ask-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.ask.placeholder')} aria-label={t('app.ask.placeholder')} autoFocus />
        </div>
        <button type="submit" className="btn">{t('app.ask.go')}</button>
      </form>
      {asked.length > 1 ? (
        data.isLoading ? <SkeletonRows rows={5} /> : data.error ? <ErrorState error={data.error} retry={() => void data.refetch()} /> : data.data?.passages.length ? (
          <>
            <section className="panel" aria-labelledby="answer-h">
              <div className="panel-head"><h2 id="answer-h">{t('app.ask.answer')}</h2><span className="spacer" />
                {!answer.data ? <button type="button" className="btn primary sm" disabled={answer.isPending} aria-busy={answer.isPending} onClick={() => answer.mutate()}><Sparkles size={14} aria-hidden="true" />{answer.isPending ? t('app.ask.writing') : t('app.ask.write')}</button> : null}
              </div>
              <div className="panel-body stack">
                {answer.error ? <ErrorState error={answer.error} /> : null}
                {answer.data ? <><Cited text={answer.data.answer} /><p className="xs muted">{t('app.ask.answerNote')}</p></> : <p className="small muted">{t('app.ask.answerNote')}</p>}
              </div>
            </section>
            <section className="panel" aria-labelledby="passages-h">
              <div className="panel-head"><h2 id="passages-h">{t('app.ask.passages')}</h2></div>
              <ol className="passages">
                {data.data.passages.map((p) => (
                  <li key={p.n} id={`p-${p.n}`} className={answer.data?.used.includes(p.n) ? 'used' : undefined}>
                    <span className="cite-n num">[{p.n}]</span>
                    <div className="stack" style={{ gap: 4 }}>
                      <blockquote>{p.text}</blockquote>
                      <a className="small" href={hrefFor({ name: 'brain', path: p.path })}>{p.title}</a>
                      {p.secret ? <span className="xs muted">{t('app.ask.secret')}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : <section className="panel"><Empty title={t('app.ask.none')} /></section>
      ) : null}
    </div>
  );
}
