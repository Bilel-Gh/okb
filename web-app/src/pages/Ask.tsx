import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, MessageCircleQuestion, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { TokenUsage } from '../ui/TokenUsage';
import { drawerOf } from './brain-tree';
import { SharedUnavailable } from '../ui/SharedResults';
import { useShareWords, type SharedIssue } from '../app/sharing';

type Passage = { n: number; path: string; title: string; text: string; line: number; secret?: boolean; shared?: { drawer: string; by: string } };
type AskData = { question: string; passages: Passage[]; notes: { path: string; title: string }[]; sharedIssue?: SharedIssue };
type Answer = { ok: true; answer: string; tokens: number; estimated?: boolean; used: number[]; passages?: Passage[]; sharedIssue?: SharedIssue };

/** An answer's citations [n] become links to their passage. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return <p className="ask-answer">{parts.map((p, i) => (/^\[\d+\]$/.test(p) ? <a key={i} href={`#p-${p.slice(1, -1)}`} className="cite" onClick={(e) => { e.preventDefault(); document.getElementById(`p-${p.slice(1, -1)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>{p.slice(1, -1)}</a> : p))}</p>;
}

/** Ask your brain: the passages of your notes that answer, then — on request — an answer written from them. */
export default function AskPage({ route }: { route: Extract<Route, { name: 'ask' }> }) {
  const t = useT();
  const w = useShareWords();
  const [q, setQ] = useState(route.q ?? '');
  useEffect(() => { setQ(route.q ?? ''); }, [route.q]);
  const asked = (route.q ?? '').trim();
  const data = useQuery({ queryKey: ['ask', asked], queryFn: () => get<AskData>('/api/ask', { q: asked }), enabled: asked.length > 1 });
  const answer = useMutation({ mutationFn: () => post<Answer>('/api/ask/answer', { q: asked }) });
  useEffect(() => { answer.reset(); }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps
  // The answer cites its own snapshot, even if the repository changed after the search.
  const passages = answer.data?.passages ?? data.data?.passages ?? [];
  return (
    <div className="page narrow">
      <form className="ask-box" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go({ name: 'ask', q: q.trim() }); }}>
        <label className="ask-q">
          <MessageCircleQuestion size={20} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.ask.placeholder')} aria-label={t('app.ask.placeholder')} autoFocus />
        </label>
        <button type="submit" className="btn primary lg" disabled={!q.trim()}><Search size={16} aria-hidden="true" />{t('app.ask.go')}</button>
      </form>
      {(answer.data?.sharedIssue ?? data.data?.sharedIssue) ? <SharedUnavailable issue={(answer.data?.sharedIssue ?? data.data?.sharedIssue)!} /> : null}
      {asked.length <= 1 ? <p className="page-intro" style={{ textAlign: 'center', margin: '0 auto' }}>{t('app.ask.intro')}</p> : null}
      {asked.length > 1 ? (
        data.isLoading ? <SkeletonRows rows={5} /> : data.error ? <ErrorState error={data.error} retry={() => void data.refetch()} /> : data.data?.passages.length ? (
          <>
            <section className="panel answer" aria-labelledby="answer-h">
              <div className="panel-head"><h2 id="answer-h"><Sparkles size={17} aria-hidden="true" />{t('app.ask.answer')}</h2>
                {!answer.data ? <button type="button" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={answer.isPending} aria-busy={answer.isPending} onClick={() => answer.mutate()}><Sparkles size={14} aria-hidden="true" />{answer.isPending ? t('app.ask.writing') : t('app.ask.write')}</button> : <span className="pill sm" style={{ marginLeft: 'auto' }}><TokenUsage tokens={answer.data.tokens} estimated={answer.data.estimated} /></span>}
              </div>
              <div className="panel-body stack">
                {answer.error ? <ErrorState error={answer.error} /> : null}
                {answer.data ? <Cited text={answer.data.answer} /> : null}
                <p className="xs muted">{t('app.ask.answerNote')}</p>
              </div>
            </section>
            <section className="panel" aria-labelledby="passages-h">
              <div className="panel-head"><h2 id="passages-h">{t('app.ask.passages')}</h2></div>
              <ol className="passages">
                {passages.map((p) => (
                  <li key={p.n} id={`p-${p.n}`} className={answer.data?.used.includes(p.n) ? 'used' : undefined}>
                    <span className="cite num">{p.n}</span>
                    <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                      <p><a className="strong" href={p.shared ? hrefFor({ name: 'sharing', drawer: p.shared.drawer, note: p.path }) : hrefFor({ name: 'brain', path: p.path })}>{p.title}</a> <small className="muted">· {p.shared ? `${w('Partagée par', 'Shared by')} ${p.shared.by}` : p.path.split('/').slice(0, -1).map((x) => drawerOf(x).label).join(' › ')}</small></p>
                      <blockquote>{p.text}</blockquote>
                      {p.secret ? <span className="xs muted row"><Lock size={12} aria-hidden="true" />{t('app.ask.secretShort')}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : <section className="panel"><Empty icon={<MessageCircleQuestion size={22} />} title={t('app.ask.none')} /></section>
      ) : null}
    </div>
  );
}
