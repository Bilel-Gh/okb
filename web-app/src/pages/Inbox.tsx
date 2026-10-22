import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Check, CheckCheck, ChevronRight, CircleAlert, CircleCheck, Eye, FileDiff, GitCompare, Inbox, Plus, Quote, RotateCcw, ScrollText, Sparkles, Trash2, TriangleAlert, FileCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentSession, get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { Prose } from '../reader/Prose';
import { ConfirmDialog } from '../ui/Confirm';
import { PageTabs } from '../ui/PageTabs';
import { ReviewTab } from './review/ReviewTab';
import { useShareWords } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { DiffView } from '../ui/DiffView';
import { TypeMark } from '../ui/TypeMark';
import { drawerOf } from './brain-tree';
import { Evening } from './Evening';
import { Waiting, type Suggestion } from './Today';

type ProposalItem = { id: string; number: number | null; title: string; status: string; createdAt: string; files: number; created: number; updated: number; changes: number };
type ProposalDetail = {
  id: string; number: number | null; title: string; status: string; createdAt: string; approvalCommand: string;
  notes: string[]; contradictions: unknown[];
  guard: { ok: boolean; violations: { message?: string; code?: string }[] };
  files: { path: string; created: boolean; html: string; diff: string; stats: { added: number; removed: number }; noteCategory: string; changeIds?: string[] }[];
  evidence: { id: string; quote: string }[];
};
type Capture = { id: string; title: string; text: string; source?: string; capturedAt: string; status: string; path: string };
type Receipt = { id: string; appliedAt: string; created: number; updated: number; complete: boolean; rolledBack: boolean };

const when = (iso: string, lang: string) => new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string, lang: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const f = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return mins < 60 ? f.format(-mins, 'minute') : mins < 1440 ? f.format(-Math.round(mins / 60), 'hour') : f.format(-Math.round(mins / 1440), 'day');
};
const pathLabel = (p: string) => p.replace(/\.md$/, '').split('/').map((x) => drawerOf(x).label).join(' › ');

/* ================================================================ one proposal */


function ProposalView({ id, setTitle }: { id: string; setTitle?: (s: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['proposal', id], queryFn: () => get<ProposalDetail>('/api/proposal', { id }) });
  const [file, setFile] = useState(0);
  const [view, setView] = useState<'diff' | 'preview'>('diff');
  const [asking, setAsking] = useState(false);
  // Every file is kept until the person unticks it.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const presence = (currentSession() as { presence?: string } | null)?.presence ?? 'none';
  useEffect(() => { if (p.data) setTitle?.(p.data.title); }, [p.data, setTitle]);
  const approve = useMutation({
    mutationFn: (apply: boolean) => {
      const selection = dropped.size ? (p.data?.files ?? []).filter((f) => !dropped.has(f.path)).flatMap((f) => f.changeIds ?? []) : [];
      return post<{ ok: boolean; presence?: string; applied?: boolean; receipt?: { results: { action: string }[] } }>('/api/proposal/approve', { id, apply, ...(selection.length ? { selection } : {}) });
    },
    onSuccess: (r) => {
      if (!r.ok) { toast(r.presence === 'refused' ? t('web.review.refused') : t('web.review.noPresence'), 'err'); return; }
      toast(r.applied ? tn(t, 'app.inbox.applied', r.receipt?.results.length ?? 0) : t('review.approvedShort'));
      void qc.invalidateQueries();
      go({ name: 'inbox', tab: 'proposals' });
    },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const discard = async () => {
    try { await post('/api/proposal/discard', { id }); toast(t('review.discarded')); void qc.invalidateQueries(); go({ name: 'inbox', tab: 'proposals' }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  if (p.isLoading) return <SkeletonRows rows={8} />;
  if (p.error || !p.data) return <ErrorState error={p.error} retry={() => void p.refetch()} />;
  const d = p.data;
  const pending = d.status === 'prepared';
  const created = d.files.filter((f) => f.created).length;
  const kept = d.files.length - dropped.size;
  const canPick = pending && presence !== 'none' && d.files.length > 1 && d.files.every((f) => f.changeIds?.length);
  const f = d.files[Math.min(file, d.files.length - 1)];
  return (
    <div className="stack lg">
      <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={hrefFor({ name: 'inbox', tab: 'proposals' })}><ArrowLeft size={16} aria-hidden="true" />{t('app.inbox.tab.proposals')}</a>
      <section className="panel review-head">
        <div className="grow">
          <h2>{d.title}</h2>
          <p className="muted">{[created ? tn(t, 'app.waiting.created', created) : '', d.files.length - created ? tn(t, 'app.waiting.updated', d.files.length - created) : '', ago(d.createdAt, t.lang)].filter(Boolean).join(' · ')}</p>
        </div>
        {pending ? (presence === 'none' ? null : (
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setAsking(true)}>{t('app.inbox.discard')}</button>
            <button type="button" className="btn" disabled={approve.isPending || !kept} onClick={() => approve.mutate(false)}>{t('app.inbox.approveOnly')}</button>
            <button type="button" className="btn primary" disabled={approve.isPending || !d.guard.ok || !kept} aria-busy={approve.isPending} onClick={() => approve.mutate(true)}><Check size={16} aria-hidden="true" />{approve.isPending ? t('app.inbox.waiting') : t('review.action.apply')}</button>
          </div>
        )) : <span className="pill">{t(`app.inbox.status.${d.status}`)}</span>}
      </section>
      {pending && presence === 'none' ? <div className="notice plain"><CircleAlert size={18} aria-hidden="true" /><div className="stack" style={{ gap: 8 }}><span>{t('web.review.useTerminal')}</span><code className="cmd">{d.approvalCommand}</code></div></div> : null}
      {pending && presence !== 'none' ? <p className="small muted">{t('app.inbox.approveWhy')}{canPick ? ` ${tn(t, 'app.inbox.kept', kept, { total: d.files.length })}` : ''}</p> : null}
      <div className="grid-2">
        <div className="stack">
          <ul className="file-list">
            {d.files.map((x, i) => (
              <li key={x.path} className="file-line">
                {canPick ? <input type="checkbox" className="file-keep" checked={!dropped.has(x.path)} aria-label={`${t('web.review.keepFile')} : ${pathLabel(x.path)}`} title={t('web.review.keepFile')}
                  onChange={(e) => setDropped((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(x.path); else next.add(x.path); return next; })} /> : null}
                <button type="button" className={`file${i === file ? ' on' : ''}${dropped.has(x.path) ? ' dropped' : ''}`} aria-pressed={i === file} onClick={() => setFile(i)}>
                  <TypeMark id={x.noteCategory} size="sm" />
                  <b className="clip">{pathLabel(x.path)}</b>
                  <span className={`pill sm ${x.created ? 'ok' : ''}`}>{x.created ? t('app.inbox.new') : t('app.inbox.changed')}</span>
                  <span className="add num">+{x.stats.added}</span>{x.stats.removed ? <span className="del num">−{x.stats.removed}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {f ? (
            <section className="panel diff">
              <div className="diff-head">
                <GitCompare size={16} aria-hidden="true" /><span className="clip grow">{t('app.inbox.whatChanges', { name: pathLabel(f.path).split(' › ').pop() ?? f.path })}</span>
                <div className="segmented mini" role="group" aria-label={t('app.inbox.view')}>
                  <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}><GitCompare size={13} aria-hidden="true" />{t('app.inbox.diff')}</button>
                  <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}><Eye size={13} aria-hidden="true" />{t('app.inbox.preview')}</button>
                </div>
              </div>
              {view === 'diff' ? <DiffView text={f.diff} /> : <div className="panel-body"><Prose html={f.html} /></div>}
            </section>
          ) : null}
        </div>
        <section className="panel">
          <div className="panel-head"><h2>{t('app.inbox.checks')}</h2></div>
          <div className="panel-body">
            <ul className="checks">
              <li>{d.guard.ok ? <CircleCheck size={17} className="ok-ink" aria-hidden="true" /> : <TriangleAlert size={17} className="warn-ink" aria-hidden="true" />}<span>{d.guard.ok ? t('app.inbox.guardOk') : `${t('app.inbox.guard')} ${d.guard.violations.map((v) => v.message ?? v.code).join(' · ')}`}</span></li>
              <li>{d.contradictions.length ? <TriangleAlert size={17} className="warn-ink" aria-hidden="true" /> : <CircleCheck size={17} className="ok-ink" aria-hidden="true" />}<span>{d.contradictions.length ? tn(t, 'app.inbox.contradictions', d.contradictions.length) : t('app.inbox.noContradiction')}</span></li>
              <li><Quote size={17} className="muted" aria-hidden="true" /><span>{tn(t, 'app.inbox.quotes', d.evidence.length)}</span></li>
              {d.notes.slice(0, 6).map((n) => <li key={n}><CircleAlert size={17} className="muted" aria-hidden="true" /><span>{n}</span></li>)}
            </ul>
          </div>
        </section>
      </div>
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t('app.inbox.discardQ')} confirm={t('app.inbox.discard')} danger onConfirm={discard}>{t('review.discard.q')}</ConfirmDialog>
    </div>
  );
}

/* ================================================================ the tabs */

function Proposals() {
  const t = useT();
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: ProposalItem[] }>('/api/proposals') });
  if (proposals.isLoading) return <SkeletonRows rows={4} />;
  if (proposals.error) return <ErrorState error={proposals.error} retry={() => void proposals.refetch()} />;
  const all = proposals.data?.proposals ?? [];
  const pending = all.filter((p) => p.status === 'prepared');
  const done = all.filter((p) => p.status !== 'prepared').slice(0, 12);
  const row = (p: ProposalItem) => (
    <li key={p.id} className="link-row">
      <a href={hrefFor({ name: 'inbox', tab: 'proposals', id: p.id })}>
        <span className="cat" aria-hidden="true"><FileDiff size={17} /></span>
        <span className="grow"><span className="title">{p.title}</span><span className="meta">{[p.created ? tn(t, 'app.waiting.created', p.created) : '', p.updated ? tn(t, 'app.waiting.updated', p.updated) : '', when(p.createdAt, t.lang)].filter(Boolean).join(' · ')}</span></span>
        {p.status === 'prepared' ? <span className="btn sm primary">{t('app.waiting.read')}</span> : <span className="pill sm">{t(`app.inbox.status.${p.status}`)}</span>}
        <ChevronRight size={16} className="muted" aria-hidden="true" />
      </a>
    </li>
  );
  return (
    <div className="stack lg">
      <section className="panel">
        <div className="panel-head"><h2>{t('app.inbox.toRead')}</h2></div>
        {pending.length ? <ul className="rows">{pending.map(row)}</ul> : <Empty icon={<Check size={22} />} title={t('review.nothingPending')}>{t('web.review.emptyText')}</Empty>}
      </section>
      {done.length ? (
        <section className="panel">
          <div className="panel-head"><h2>{t('app.inbox.history')}</h2></div>
          <ul className="rows">{done.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function Captures({ compose, all }: { compose: boolean; all: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [claude, setClaude] = useState<string | null>(null);
  const [dropping, setDropping] = useState<Capture | null>(null);
  const items = useQuery({ queryKey: ['inbox', all], queryFn: () => get<{ items: Capture[] }>('/api/inbox', { all: all ? 1 : '' }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['inbox'] }); void qc.invalidateQueries({ queryKey: ['status-full'] }); };
  const save = async () => {
    if (!text.trim()) return;
    try { await post('/api/capture', { text, source }); toast(t('web.inbox.captured')); setText(''); setSource(''); refresh(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const settle = async (item: Capture, status: 'done' | 'dropped', reason?: string) => {
    try {
      await post('/api/inbox/settle', { id: item.id, status, ...(reason ? { reason } : {}) });
      toast(status === 'done' ? t('inbox.settledDone', { title: item.title }) : t('inbox.settledDrop', { title: item.title }));
      refresh();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const open = (items.data?.items ?? []).filter((i) => i.status === 'open');
  return (
    <div className="stack lg">
      <section className="panel">
        <div className="panel-head"><h2><Plus size={17} aria-hidden="true" />{t('app.inbox.capture')}</h2></div>
        <div className="panel-body stack">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('capture.placeholder')} aria-label={t('app.inbox.capture')} autoFocus={compose}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save(); }} />
          <div className="row">
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('web.inbox.sourcePlaceholder')} aria-label={t('web.inbox.sourcePlaceholder')} />
            <button type="button" className="btn primary" onClick={() => void save()} disabled={!text.trim()}><Plus size={15} aria-hidden="true" />{t('web.inbox.capture')}</button>
          </div>
          <p className="xs muted">{t('app.inbox.captureWhy')}</p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('web.inbox.waiting')}</h2>
          <span className="pill sm num">{open.length}</span>
          <a className="link" href={hrefFor({ name: 'inbox', tab: 'captures', all: !all })}>{all ? t('web.inbox.onlyOpen') : t('web.inbox.history')}</a>
        </div>
        {items.isLoading ? <SkeletonRows rows={3} /> : !(items.data?.items.length) ? <Empty icon={<Archive size={22} />} title={t('inbox.empty')}>{t('web.inbox.emptyText')}</Empty> : (
          <ul className="captures">
            {items.data.items.map((item) => (
              <li key={item.id} className={item.status !== 'open' ? 'settled' : undefined}>
                <div className="row"><b className="grow">{item.title}</b>{item.status !== 'open' ? <span className="pill sm">{item.status === 'done' ? t('app.inbox.settled') : t('app.inbox.dropped')}</span> : null}<span className="xs muted">{ago(item.capturedAt, t.lang)}</span></div>
                {item.source ? <p className="xs muted">{item.source}</p> : null}
                <p className="capture-text">{item.text}</p>
                {item.status === 'open' ? (
                  <div className="row wrap">
                    <button type="button" className="btn sm primary" onClick={() => setClaude(claude === item.id ? null : item.id)}><Sparkles size={14} aria-hidden="true" />{t('inbox.triage.claude')}</button>
                    <button type="button" className="btn sm" onClick={() => void settle(item, 'done')}><Check size={14} aria-hidden="true" />{t('app.inbox.done')}</button>
                    <button type="button" className="btn sm ghost" onClick={() => setDropping(item)}><Trash2 size={14} aria-hidden="true" />{t('inbox.triage.drop')}</button>
                  </div>
                ) : null}
                {claude === item.id ? <div className="stack" style={{ gap: 6 }}><p className="small muted">{t('web.inbox.claudeHow')}</p><code className="cmd">/okb:ingest {item.path}</code></div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog open={Boolean(dropping)} onOpenChange={(v) => { if (!v) setDropping(null); }} title={t('app.inbox.dropQ', { title: dropping?.title ?? '' })} confirm={t('inbox.triage.drop')} danger
        input={{ label: t('inbox.triage.why'), placeholder: t('inbox.triage.whyPlaceholder') }} onConfirm={(reason) => (dropping ? settle(dropping, 'dropped', reason) : undefined)} />
    </div>
  );
}

function History() {
  const t = useT();
  const qc = useQueryClient();
  const receipts = useQuery({ queryKey: ['receipts'], queryFn: () => get<{ receipts: Receipt[] }>('/api/receipts') });
  const [undoing, setUndoing] = useState<Receipt | null>(null);
  if (receipts.isLoading) return <SkeletonRows rows={4} />;
  if (receipts.error) return <ErrorState error={receipts.error} retry={() => void receipts.refetch()} />;
  const list = receipts.data?.receipts ?? [];
  const last = list.find((r) => r.complete && !r.rolledBack);
  const undo = async (r: Receipt) => {
    try { const out = await post<{ restored: unknown[] }>('/api/undo', { receipt: r.id }); toast(tn(t, 'undo.restored', out.restored.length)); void qc.invalidateQueries(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2><ScrollText size={17} aria-hidden="true" />{t('app.inbox.applied')}</h2></div>
      <div className="panel-body">
        <p className="muted" style={{ marginBottom: 16 }}>{t('web.history.lead')}</p>
        {!list.length ? <Empty icon={<ScrollText size={22} />} title={t('web.history.empty')}>{t('web.history.emptyText')}</Empty> : (
          <ol className="timeline">
            {list.map((r) => (
              <li key={r.id}>
                <div className="row wrap">
                  <b>{when(r.appliedAt, t.lang)}</b>
                  <span className={`pill sm ${r.rolledBack ? '' : r.complete ? 'ok' : 'warn'}`}>{r.rolledBack ? t('undo.undone') : r.complete ? t('undo.applied') : t('undo.interrupted')}</span>
                  <span className="spacer" />
                  {r === last ? <button type="button" className="btn sm" onClick={() => setUndoing(r)}><RotateCcw size={14} aria-hidden="true" />{t('web.history.undo')}</button> : null}
                </div>
                <small className="muted">{t('review.createdUpdated', { created: r.created, updated: r.updated })}</small>
              </li>
            ))}
          </ol>
        )}
      </div>
      <ConfirmDialog open={Boolean(undoing)} onOpenChange={(v) => { if (!v) setUndoing(null); }} title={t('undo.q')} confirm={t('web.history.undo')} danger onConfirm={() => (undoing ? undo(undoing) : undefined)}>
        {undoing ? <>{tn(t, 'app.inbox.undoRemoves', undoing.created)} {tn(t, 'app.inbox.undoRestores', undoing.updated)}</> : null}
      </ConfirmDialog>
    </section>
  );
}

/* ================================================================ the page */

export default function InboxPage({ route, setTitle }: { route: Extract<Route, { name: 'inbox' }>; setTitle?: (s: string) => void }) {
  const t = useT();
  const w = useShareWords();
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<{ suggestions: Suggestion[] }>('/api/suggestions') });
  const p = useQuery({ queryKey: ['proposals'], queryFn: () => get<{ proposals: ProposalItem[] }>('/api/proposals') });
  const c = useQuery({ queryKey: ['inbox', false], queryFn: () => get<{ items: Capture[] }>('/api/inbox') });
  const cards = s.data?.suggestions.filter((x) => x.status === 'pending' || x.status === 'later').length ?? 0;
  const prepared = p.data?.proposals.filter((x) => x.status === 'prepared').length ?? 0;
  const waiting = s.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0;
  const captures = c.data?.items.filter((x) => x.status === 'open').length ?? 0;
  const r = useQuery({ queryKey: ['review'], queryFn: () => get<{ notes: unknown[]; changes: unknown[] }>('/api/review') });
  const toReview = r.data?.notes.length ?? 0;
  // Without a tab: what waits for a yes comes first; the notes to review are sorted when calm (D71).
  const tab = route.tab ?? (route.id ? 'proposals' : waiting + prepared === 0 && toReview ? 'toreview' : 'all');
  if (route.id) return <div className="page"><ProposalView id={route.id} setTitle={setTitle} /></div>;
  return (
    <div className="page">
      <PageTabs label={t('app.nav.inbox')} tabs={[
        { to: { name: 'inbox', tab: 'toreview' }, label: w('À relire', 'To review'), current: tab === 'toreview', count: toReview + (r.data?.changes.length ?? 0), icon: FileCheck },
        { to: { name: 'inbox', tab: 'all' }, label: t('app.inbox.tab.all'), current: tab === 'all', count: waiting + prepared, icon: CheckCheck },
        { to: { name: 'inbox', tab: 'suggestions' }, label: t('app.inbox.tab.suggestions'), current: tab === 'suggestions', count: cards, icon: Sparkles },
        { to: { name: 'inbox', tab: 'proposals' }, label: t('app.inbox.tab.proposals'), current: tab === 'proposals', count: prepared, icon: FileDiff },
        { to: { name: 'inbox', tab: 'captures' }, label: t('app.inbox.tab.captures'), current: tab === 'captures', count: captures, icon: Inbox },
        { to: { name: 'inbox', tab: 'history' }, label: t('app.inbox.tab.history'), current: tab === 'history', icon: ScrollText },
      ]} />
      {tab === 'toreview' ? <ReviewTab /> : tab === 'all' ? <Evening /> : tab === 'suggestions' ? (
        <>
          <p className="page-intro">{t('app.inbox.suggestionsWhy')}</p>
          <section className="panel"><div className="panel-body flush"><Waiting only="cards" /></div></section>
        </>
      ) : tab === 'proposals' ? <Proposals /> : tab === 'captures' ? <Captures compose={route.compose === true} all={route.all === true} /> : <History />}
    </div>
  );
}
