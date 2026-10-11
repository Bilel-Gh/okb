import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, MessageCircle, Mic, Plus, Send, Square } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { get, post } from '../app/api';
import { type AgentStatus, type AgentUsage, type UsageSummary, type AssistantAction, type AssistantMessage, type AssistantMode, type AssistantSource, type ConversationState, type ConversationSummary } from '../app/assistant';
import { hrefFor, type Route } from '../app/router';
import { useShareWords } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

function Usage({ usage }: { usage: AgentUsage }) {
  const w = useShareWords();
  return <span className="xs muted num">{usage.input === null || usage.output === null ? w('Tokens non communiqués', 'Token usage unavailable') : `${(usage.input + usage.output).toLocaleString()} tokens · ${usage.input.toLocaleString()} ${w('entrée', 'input')} / ${usage.output.toLocaleString()} ${w('sortie', 'output')}`}</span>;
}

function ConversationUsage({ usage, summary }: { usage: AgentUsage; summary?: UsageSummary }) {
  const w = useShareWords();
  if (!summary) return <Usage usage={usage} />;
  return <span className="xs muted num">{summary.total === null ? w('Tokens non communiqués', 'Token usage unavailable') : `${summary.total.toLocaleString()} tokens`} · {summary.calls} {w('appels', 'calls')}{summary.failed ? ` · ${summary.failed} ${w('échoués ou arrêtés', 'failed or stopped')}` : ''}{summary.total === null && summary.knownTotal ? ` · ${w('part mesurée', 'measured portion')} : ${summary.knownTotal.toLocaleString()}` : ''}</span>;
}

function SourceLink({ source }: { source: AssistantSource }) {
  const w = useShareWords();
  const href = source.kind === 'shared' && source.drawer ? hrefFor({ name: 'sharing', drawer: source.drawer, note: source.path }) : source.kind === 'document' ? hrefFor({ name: 'documents', q: source.title }) : hrefFor({ name: 'brain', path: source.path });
  return <a className="link" href={href}>{source.title}{source.author ? ` · ${w('Partagée par', 'Shared by')} ${source.author}` : ''}</a>;
}

function ActionCard({ action, conversation, message, index, prefill }: { action: AssistantAction; conversation: string; message: string; index: number; prefill: (question: string, mode: AssistantMode) => void }) {
  const w = useShareWords();
  const qc = useQueryClient();
  const perform = useMutation({ mutationFn: () => post<{ action?: { id: string }; id?: string }>('/api/assistant/action', { conversation, message, index }), onSuccess: () => { for (const k of ['suggestions', 'actions', 'today', 'status']) void qc.invalidateQueries({ queryKey: [k] }); } });
  const labels = { note: w('Garder cette information', 'Keep this information'), action: w('Créer cette action', 'Create this action'), meeting: w('Préparer ma réunion', 'Prepare my meeting'), explain: w('Explique autrement', 'Explain differently'), find: w('Retrouver ce document', 'Find this document'), resume: w('Où j’en étais', 'Where I left off') };
  const invoke = () => { if (action.kind === 'note' || action.kind === 'action') perform.mutate(); else prefill(action.text, action.kind); };
  return <li className="stack assistant-action"><p className="small">{action.text}</p>{perform.error ? <ErrorState error={perform.error} /> : null}{perform.data ? action.kind === 'action' ? <p className="small notice ok" role="status"><Check size={14} aria-hidden="true" />{w('Action créée.', 'Action created.')} <a className="link" href={hrefFor({ name: 'today' })}>{w('Voir Aujourd’hui', 'See Today')}</a></p> : <a className="btn sm" href={hrefFor({ name: 'inbox', tab: 'suggestions' })}>{w('Voir la carte à valider', 'See the card to review')}<ArrowRight size={14} aria-hidden="true" /></a> : <span><button type="button" className="btn sm" disabled={perform.isPending} onClick={invoke}>{labels[action.kind]}</button></span>}</li>;
}

function Message({ message, conversation, prefill }: { message: AssistantMessage; conversation: string; prefill: (q: string, mode: AssistantMode) => void }) {
  const w = useShareWords();
  const answer = message.answer;
  return <article className={`assistant-message ${message.role}`} aria-label={message.role === 'user' ? w('Mon message', 'My message') : w('Réponse de mon agent', 'My agent’s answer')}><p className="xs muted strong">{message.role === 'user' ? w('Moi', 'Me') : w('Assistant', 'Assistant')}</p>{!answer ? <p className="assistant-text">{message.text}</p> : <>
    <div className="stack lg">{answer.statements.map((s, i) => <div key={i} className="assistant-statement"><p className="assistant-text">{s.text}</p>{s.kind === 'general' ? <span className="pill sm warn">{w('Ceci ne vient pas de vos notes', 'This does not come from your notes')}</span> : s.kind === 'unknown' ? <span className="pill sm">{w('Je ne sais pas', 'I don’t know')}</span> : <details><summary>{w('Voir les preuves de cette phrase', 'See evidence for this statement')} · {s.evidence.length}</summary><ul className="stack assistant-proofs">{s.evidence.map((e, j) => { const source = answer.sources.find((x) => x.id === e.source); return <li key={j}>{source ? <SourceLink source={source} /> : <span className="muted">{w('Source indisponible', 'Source unavailable')}</span>}<blockquote>{e.quote}</blockquote></li>; })}</ul></details>}</div>)}</div>
    {answer.actions.length ? <div className="stack assistant-suggestions"><h3>{w('À vous de décider', 'Your decision')}</h3><ul className="stack">{answer.actions.map((a, i) => <ActionCard key={`${message.id}:${i}`} action={a} conversation={conversation} message={message.id} index={i} prefill={prefill} />)}</ul></div> : null}<Usage usage={answer.usage} />
  </>}</article>;
}

/** The same conversation surface is used in its screen and the keyboard-accessible panel. */
export function AssistantChat({ initialId, context, compact = false, onConversation }: { initialId?: string; context?: string; compact?: boolean; onConversation?: (id: string) => void }) {
  const w = useShareWords();
  const qc = useQueryClient();
  const uid = useId();
  const [id, setId] = useState(initialId ?? '');
  const idRef = useRef(id);
  useEffect(() => { onConversation?.(id); }, [id, onConversation]);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [prepared, setPrepared] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: () => get<AgentStatus>('/api/assistant/status'), staleTime: 30_000 });
  const history = useQuery({ queryKey: ['assistant', 'conversations'], queryFn: () => get<{ conversations: ConversationSummary[] }>('/api/assistant/conversations') });
  const conversation = useQuery({ queryKey: ['assistant', 'conversation', id], queryFn: () => get<ConversationState>('/api/assistant/conversation', { id }), enabled: !!id, staleTime: 15_000, refetchInterval: (q) => q.state.data?.busy ? 1500 : false });
  const configure = useMutation({ mutationFn: (agent: string) => post('/api/assistant/config', { agent }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assistant', 'status'] }); } });
  const choose = (next: string) => { idRef.current = next; setId(next); setPrepared(false); setQuestion(''); setMode('ask'); ask.reset(); cancel.reset(); end.reset(); };
  useEffect(() => { if (initialId !== undefined) { idRef.current = initialId; setId(initialId); } }, [initialId]);
  const ask = useMutation({
    mutationFn: async (input: { question: string; mode: AssistantMode }) => {
      let current = idRef.current;
      if (!current) { const started = await post<ConversationState>('/api/assistant/start'); current = started.conversation.id; idRef.current = current; qc.setQueryData(['assistant', 'conversation', current], started); setId(current); }
      return post<ConversationState>('/api/assistant/ask', { ...input, conversation: current });
    },
    onSuccess: (r) => { qc.setQueryData(['assistant', 'conversation', r.conversation.id], r); idRef.current = r.conversation.id; setId(r.conversation.id); setQuestion(''); setMode('ask'); setPrepared(false); void qc.invalidateQueries({ queryKey: ['assistant', 'conversations'] }); void qc.invalidateQueries({ queryKey: ['suggestions'] }); },
    onError: () => { void qc.invalidateQueries({ queryKey: ['assistant', 'conversation', idRef.current] }); void qc.invalidateQueries({ queryKey: ['assistant', 'conversations'] }); },
  });
  const cancel = useMutation({ mutationFn: () => post('/api/assistant/cancel', { conversation: idRef.current }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assistant', 'conversation', idRef.current] }); } });
  const end = useMutation({ mutationFn: (later: boolean) => post<{ offer: { cards: { id: string; title: string; why: string }[]; toName: { kind: string; hint: string }[] } | null }>('/api/assistant/end', { conversation: idRef.current, later }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['suggestions'] }); } });
  const prefill = (text: string, next: AssistantMode) => { setQuestion(text); setMode(next); setPrepared(true); field.current?.focus(); };
  const d = conversation.data?.conversation;
  const busy = ask.isPending || !!conversation.data?.busy;
  const selected = status.data?.agents.find((a) => a.id === status.data.selected);
  const canAsk = selected?.ready && !configure.isPending && !busy;
  useEffect(() => { tail.current?.scrollIntoView?.({ block: 'nearest' }); }, [d?.messages.length]);
  const send = () => { if (canAsk && question.trim()) { end.reset(); cancel.reset(); ask.mutate({ question: question.trim(), mode }); } };
  return <div className={`assistant-chat${compact ? ' compact' : ''}`}>
    <div className="assistant-settings stack"><div className="row wrap"><div className="field grow"><label htmlFor={`agent-${uid}`}>{w('Mon agent installé', 'My installed agent')}</label><select id={`agent-${uid}`} className="select sm" value={status.data?.selected ?? 'claude-code'} disabled={busy || configure.isPending || !status.data} onChange={(e) => configure.mutate(e.target.value)}>{(status.data?.agents ?? [{ id: 'claude-code', ready: false }]).map((a) => <option key={a.id} value={a.id} disabled={!a.ready}>{a.id === 'claude-code' ? 'Claude Code' : `Codex · ${w('expérimental', 'experimental')}`}</option>)}</select></div>{selected?.version ? <span className="xs muted">{selected.version}</span> : null}</div><p className="xs muted">{w('L’agent utilise votre configuration et votre abonnement ou proxy. Les notes protégées sont exclues. La dictée du clavier de votre ordinateur fonctionne ici.', 'The agent uses your configuration and your subscription or proxy. Protected notes are excluded. Your computer’s keyboard dictation works here.')}</p>{status.error || configure.error ? <ErrorState error={status.error ?? configure.error} retry={() => void status.refetch()} /> : null}{status.data && !selected?.ready ? <p className="notice warn small">{selected?.installed ? w('Cet agent n’est pas encore validé pour l’assistant. Utilisez la recherche sans IA.', 'This agent is not yet validated for the assistant. Use search without AI.') : w('Claude Code est absent de cette machine.', 'Claude Code is not installed on this machine.')}</p> : null}<a className="link small" href={hrefFor({ name: 'ask' })}>{w('Chercher dans mes notes sans IA', 'Search my notes without AI')}</a>{status.data?.terms.length ? <details><summary className="xs muted">{w('Mode de connexion et conditions', 'Connection and terms')}</summary>{status.data.terms.map((term) => <p className="xs muted" key={term.agent}><a className="link" href={term.url} target="_blank" rel="noreferrer">{term.agent === 'claude-code' ? 'Claude Code' : 'Codex'}</a> · {term.checkedAt ? `${w('Documentation vérifiée le', 'Documentation checked on')} ${term.checkedAt}` : w('Adaptateur expérimental à valider', 'Experimental adapter pending validation')}</p>)}</details> : null}</div>
    <div className="row wrap assistant-history"><div className="field grow"><label htmlFor={`history-${uid}`}>{w('Mes conversations sur cette machine', 'My conversations on this machine')}</label><select id={`history-${uid}`} className="select sm" value={id} disabled={busy} onChange={(e) => choose(e.target.value)}><option value="">{w('Nouvelle conversation', 'New conversation')}</option>{id && !history.data?.conversations.some((c) => c.id === id) ? <option value={id}>{d?.title ?? w('Conversation en cours', 'Current conversation')}</option> : null}{history.data?.conversations.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div><button type="button" className="btn sm ghost" disabled={busy} onClick={() => { choose(''); ask.reset(); setQuestion(''); setMode('ask'); }}><Plus size={14} aria-hidden="true" />{w('Nouvelle', 'New')}</button></div>{history.error ? <ErrorState error={history.error} retry={() => void history.refetch()} /> : null}
    <div className="assistant-messages" aria-live="polite" aria-busy={busy}>{conversation.isLoading && id ? <SkeletonRows rows={4} /> : conversation.error ? <ErrorState error={conversation.error} retry={() => void conversation.refetch()} /> : d?.messages.length ? d.messages.map((m) => <Message key={m.id} message={m} conversation={d.id} prefill={prefill} />) : <Empty icon={<MessageCircle size={22} aria-hidden="true" />} title={w('Parlez à votre cerveau', 'Talk to your brain')}>{w('Retrouver une décision, préparer une réunion, comprendre une note ou reprendre un projet.', 'Find a decision, prepare a meeting, understand a note or resume a project.')}</Empty>}{busy ? <p className="small muted" role="status">{w('Votre agent prépare sa réponse…', 'Your agent is preparing its answer…')}</p> : null}<div ref={tail} /></div>
    {d && (d.messages.length || d.usageSummary?.calls) ? <div className="row wrap assistant-conversation-foot"><ConversationUsage usage={d.usage} summary={d.usageSummary} /><span className="spacer" /><button type="button" className="btn sm ghost" disabled={busy || end.isPending} onClick={() => end.mutate(false)}>{w('Terminer cette conversation', 'End this conversation')}</button></div> : null}
    {end.error ? <ErrorState error={end.error} /> : null}{end.data ? <section className="notice info small stack" aria-label={w('À garder après cette conversation', 'Keep from this conversation')}><b>{w('À garder après cette conversation', 'Keep from this conversation')}</b>{end.data.offer?.cards.length ? <ul>{end.data.offer.cards.slice(0, 3).map((c) => <li key={c.id}>{c.title}</li>)}</ul> : <p>{w('Aucune nouvelle carte proposée.', 'No new card suggested.')}</p>}{end.data.offer?.cards.length ? <a className="link" href={hrefFor({ name: 'inbox', tab: 'suggestions' })}>{w('Relire les cartes à valider', 'Review the suggested cards')}</a> : null}{end.data.offer?.toName.length ? <p>{w('Quelques moments restent à nommer dans vos cartes.', 'Some moments still need naming in your cards.')}</p> : null}<button type="button" className="btn sm ghost" disabled={end.isPending} onClick={() => end.mutate(true)}>{w('Pas maintenant', 'Not now')}</button></section> : null}
    <form className="assistant-compose stack" onSubmit={(e) => { e.preventDefault(); send(); }}><label className="sr-only" htmlFor={`assistant-question-${uid}`}>{w('Mon message à l’assistant', 'My message to the assistant')}</label><textarea ref={field} id={`assistant-question-${uid}`} className="textarea" rows={compact ? 3 : 4} value={question} maxLength={4000} disabled={busy} onChange={(e) => { setQuestion(e.target.value); setPrepared(false); }} placeholder={w('Qu’a-t-on décidé ? Où j’en étais ? Explique-moi…', 'What did we decide? Where was I? Explain…')} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />{prepared ? <p className="small muted" role="status">{w('Question prête. Relisez puis envoyez.', 'Question ready. Review and send.')}</p> : null}{ask.error ? <ErrorState error={ask.error} /> : null}{cancel.error ? <ErrorState error={cancel.error} /> : null}<div className="row wrap">{context ? <button type="button" className="btn sm ghost" disabled={busy} onClick={() => prefill(`${w('Aide-moi à comprendre', 'Help me understand')} : ${context}`, 'explain')}>{w('À propos de cet écran', 'About this screen')}</button> : <span className="xs muted row"><Mic size={13} aria-hidden="true" />{w('Dictée de l’ordinateur', 'Computer dictation')}</span>}<span className="spacer" />{busy ? <button type="button" className="btn sm" disabled={!id || cancel.isPending} onClick={() => cancel.mutate()}><Square size={13} aria-hidden="true" />{w('Arrêter la réponse', 'Stop the reply')}</button> : <button type="submit" className="btn primary" disabled={!canAsk || !question.trim()} aria-keyshortcuts="Meta+Enter Control+Enter"><Send size={15} aria-hidden="true" />{w('Envoyer à mon agent', 'Send to my agent')}</button>}</div></form>
  </div>;
}

export default function Assistant({ route }: { route: Extract<Route, { name: 'assistant' }> }) { return <div className="page narrow assistant-page"><AssistantChat initialId={route.id} /></div>; }
