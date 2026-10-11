import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Save, Sparkles } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { get, post } from '../app/api';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { LEVEL_WORDS, READING_WORDS, understandingEventId, type Reading, type ReadingMode, type Readiness, type UnderstandingKind, type UnderstandingSource } from '../app/understanding';
import { ErrorState } from '../ui/States';
import { TokenUsage } from '../ui/TokenUsage';

export function UnderstandingSources({ sources }: { sources: UnderstandingSource[] }) {
  const w = useShareWords();
  return <details className="understanding-sources"><summary>{w('Sources à vérifier', 'Sources to verify')} · {sources.length}</summary><ol className="stack">{sources.map((s, i) => <li key={`${s.path}:${i}`}><a className="link" href={hrefFor({ name: 'brain', path: s.path })}>{s.title}</a><blockquote>{s.quote}</blockquote></li>)}</ol></details>;
}

/** An observed level is only a recorded act. This form never infers one from a model answer. */
export function UnderstandingAct({ path, initialKind = 'practiced', initialPoint = '', onSaved }: { path: string; initialKind?: UnderstandingKind; initialPoint?: string; onSaved?: () => void }) {
  const w = useShareWords();
  const id = useId();
  const qc = useQueryClient();
  const [kind, setKind] = useState<UnderstandingKind>(initialKind);
  const [point, setPoint] = useState(initialPoint);
  const event = useRef(understandingEventId());
  const save = useMutation({ mutationFn: () => post('/api/understanding/record', { path, kind, point: point.trim(), eventId: event.current }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['understanding'] }); onSaved?.(); } });
  const edit = () => { event.current = understandingEventId(); save.reset(); };
  return <form className="stack understanding-act" onSubmit={(e) => { e.preventDefault(); if ((point.trim() || kind === 'resolved') && !save.isPending) save.mutate(); }}>
    <div className="field"><label htmlFor={`act-${id}`}>{w('Geste réalisé', 'Action taken')}</label><select id={`act-${id}`} className="select" value={kind} disabled={save.isPending || initialKind === 'resolved'} onChange={(e) => { setKind(e.target.value as UnderstandingKind); edit(); }}>{(['practiced', 'explained', 'reused'] as const).map((k) => <option key={k} value={k}>{w(...LEVEL_WORDS[k])}</option>)}{initialKind === 'unclear' ? <option value="unclear">{w('Un point reste flou', 'A point remains unclear')}</option> : null}{initialKind === 'resolved' ? <option value="resolved">{w('Ce point est compris', 'This point is understood')}</option> : null}</select></div>
    <div className="field"><label htmlFor={`point-${id}`}>{kind === 'unclear' ? w('Le point qui reste flou', 'The unclear point') : w('Ce que j’ai fait', 'What I did')}</label><textarea id={`point-${id}`} className="textarea" rows={2} value={point} maxLength={4000} onChange={(e) => { setPoint(e.target.value); edit(); }} disabled={kind === 'resolved' || save.isPending} /></div>
    <p className="xs muted">{w('Ces gestes restent privés et ne certifient pas une compétence.', 'These actions stay private and do not certify a skill.')}</p>
    {save.error ? <ErrorState error={save.error} /> : null}
    {save.isSuccess ? <p className="small notice ok" role="status"><Check size={15} aria-hidden="true" />{w('Geste enregistré.', 'Action recorded.')}</p> : <span><button type="submit" className="btn sm" disabled={(!point.trim() && kind !== 'resolved') || save.isPending}>{w('Enregistrer ce geste', 'Record this action')}</button></span>}
  </form>;
}

function UnderstandingContent({ path }: { path: string }) {
  const w = useShareWords();
  const [mode, setMode] = useState<ReadingMode>('auto');
  const [projectId, setProjectId] = useState('');
  const [quiz, setQuiz] = useState(false);
  const [unclear, setUnclear] = useState(false);
  const [answer, setAnswer] = useState('');
  const projects = useQuery({ queryKey: ['projects', 'understanding'], queryFn: () => get<{ projects: { id: string; title: string }[] }>('/api/projects', { status: 'all' }), enabled: mode === 'project-example' });
  const read = useMutation({ mutationFn: (next: ReadingMode) => post<Reading>('/api/understanding/read', { path, mode: next, ...(next === 'project-example' && projectId ? { projectId } : {}) }), onMutate: () => { keep.reset(); readiness.reset(); setQuiz(false); setUnclear(false); } });
  const keep = useMutation({ mutationFn: () => post<{ id: string }>('/api/understanding/keep', { readingId: read.data!.id }) });
  const readiness = useMutation({ mutationFn: () => post<Readiness>('/api/understanding/readiness', { path, answer: answer.trim() }) });
  const run = (next = mode) => { if (!read.isPending) { setMode(next); read.mutate(next); } };
  const r = read.data;
  return <section className="panel understanding-panel" aria-label={w('Fiche de compréhension', 'Understanding card')}>
    <div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{w('Fiche de compréhension', 'Understanding card')}</h2>{r ? <span className="pill sm">{w(...READING_WORDS[r.mode])}</span> : null}</div>
    <div className="panel-body stack lg">
      <p className="small muted">{w('Une lecture part de cette note et de ses sources. Elle est calculée à votre demande puis gardée en cache ; rien ne remplace la note sans une proposition relue.', 'A reading uses this note and its sources. It is calculated on request and cached; replacing the note requires a reviewed proposal.')}</p>
      <div className="row wrap understanding-controls"><div className="field grow"><label htmlFor={`reading-mode-${path}`}>{w('Ma lecture', 'My reading')}</label><select id={`reading-mode-${path}`} className="select" value={mode} disabled={read.isPending} onChange={(e) => setMode(e.target.value as ReadingMode)}>{Object.entries(READING_WORDS).map(([key, words]) => <option key={key} value={key}>{w(...words)}</option>)}</select></div>{mode === 'project-example' ? <div className="field grow"><label htmlFor={`reading-project-${path}`}>{w('Mon projet', 'My project')}</label><select id={`reading-project-${path}`} className="select" value={projectId} disabled={read.isPending} onChange={(e) => setProjectId(e.target.value)}><option value="">{w('Choisir un projet', 'Choose a project')}</option>{projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{projects.error ? <ErrorState error={projects.error} /> : null}</div> : null}<button type="button" className="btn primary" disabled={read.isPending || (mode === 'project-example' && !projectId)} aria-busy={read.isPending} onClick={() => run()}><Sparkles size={15} aria-hidden="true" />{read.isPending ? w('Lecture en préparation…', 'Preparing a reading…') : w('Lire autrement', 'Read differently')}</button></div>
      {read.error ? <ErrorState error={read.error} /> : null}
      {r ? <>
        <div className="stack"><h3>{w('L’explication', 'The explanation')}</h3><p className="understanding-text">{r.explanation}</p><h3>{w('Un exemple', 'An example')}</h3><p className="understanding-text">{r.example}</p></div>
        <div className="grid-2"><div className="stack"><h3>{w('Quand l’utiliser', 'When to use it')}</h3>{r.conditions.length ? <ul>{r.conditions.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted small">{w('Aucune condition précisée dans cette lecture.', 'No conditions specified in this reading.')}</p>}</div><div className="stack"><h3>{w('Ce qui reste flou', 'What remains unclear')}</h3>{r.unclear.length ? <ul>{r.unclear.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted small">{w('Aucun point signalé ; les sources restent à vérifier.', 'No points flagged; the sources still need checking.')}</p>}</div></div>
        <UnderstandingSources sources={r.sources} />
        <div className="row wrap" role="group" aria-label={w('Approfondir', 'Go further')}><button type="button" className="btn sm" disabled={read.isPending} onClick={() => run(r.mode === 'simple' ? 'analogy' : 'simple')}>{w('Explique autrement', 'Explain differently')}</button><button type="button" className="btn sm" disabled={read.isPending} onClick={() => setMode('project-example')}>{w('Montre un exemple', 'Show an example')}</button><button type="button" className="btn sm" aria-expanded={unclear} onClick={() => setUnclear(!unclear)}>{w('Je n’ai pas compris ce point', 'I did not understand this point')}</button><button type="button" className="btn sm" aria-expanded={quiz} onClick={() => setQuiz(!quiz)}><CircleHelp size={14} aria-hidden="true" />{w('Vérifie ma compréhension', 'Check my understanding')}</button></div>
        {unclear ? <UnderstandingAct key="unclear" path={path} initialKind="unclear" /> : null}
        {quiz ? <form className="stack understanding-quiz" onSubmit={(e) => { e.preventDefault(); if (answer.trim() && !readiness.isPending) readiness.mutate(); }}><div className="field"><label htmlFor={`readiness-${path}`}>{w('Avec mes mots', 'In my own words')}</label><textarea id={`readiness-${path}`} className="textarea" rows={3} maxLength={8000} value={answer} onChange={(e) => { setAnswer(e.target.value); readiness.reset(); }} placeholder={w('Expliquez ce sujet et quand vous l’utiliseriez.', 'Explain this subject and when you would use it.')} /></div><span><button type="submit" className="btn sm primary" disabled={!answer.trim() || readiness.isPending}>{w('Vérifier avec mes notes', 'Check against my notes')}</button></span>{readiness.error ? <ErrorState error={readiness.error} /> : null}{readiness.data ? <div className="stack" role="status"><span className={`pill sm ${readiness.data.grade === 'right' ? 'ok' : 'warn'}`}>{readiness.data.grade === 'right' ? w('Appuyé par les notes', 'Supported by notes') : readiness.data.grade === 'partial' ? w('À préciser', 'Needs clarification') : readiness.data.grade === 'ungraded' ? w('Les notes ne suffisent pas', 'Insufficient notes') : w('Non appuyé par les notes', 'Unsupported by notes')}</span><p>{readiness.data.feedback}</p>{readiness.data.missing.length ? <ul>{readiness.data.missing.map((x) => <li key={x}>{x}</li>)}</ul> : null}<UnderstandingSources sources={readiness.data.sources} /><p className="xs muted"><TokenUsage tokens={readiness.data.tokens} estimated={readiness.data.estimated} /></p><p className="xs muted">{readiness.data.limitations.join(' ')}</p></div> : null}</form> : null}
        <details className="understanding-rewrite"><summary>{w('Nouvelle rédaction proposée', 'Proposed new wording')}</summary><pre>{r.markdown}</pre></details>
        {keep.error ? <ErrorState error={keep.error} /> : null}<div className="row wrap"><span className="small muted grow">{r.cached ? w('Lecture gardée en cache', 'Cached reading') : <TokenUsage tokens={r.tokens} estimated={r.estimated} />}</span>{keep.data ? <a className="btn sm primary" href={hrefFor({ name: 'inbox', tab: 'proposals', id: keep.data.id })}>{w('Relire la proposition', 'Review the proposal')}<ArrowRight size={14} aria-hidden="true" /></a> : <button type="button" className="btn sm" disabled={read.isPending || keep.isPending} onClick={() => keep.mutate()}><Save size={14} aria-hidden="true" />{w('Garder cette version', 'Keep this version')}</button>}</div><p className="xs muted">{r.limitations.join(' ')}</p>
      </> : null}
      <details><summary>{w('J’ai pratiqué, expliqué ou réutilisé ce sujet', 'I practiced, explained or reused this subject')}</summary><UnderstandingAct path={path} /></details>
    </div>
  </section>;
}

/** Opening the card is free of model calls; calculating any reading needs its own click. */
export function Understanding({ path, initiallyOpen = false }: { path: string; initiallyOpen?: boolean }) {
  const w = useShareWords();
  const [open, setOpen] = useState(initiallyOpen);
  return <div className="understanding" id="understanding"><button type="button" className="btn sm" aria-expanded={open} aria-controls="understanding-card" onClick={() => setOpen(!open)}><BookOpen size={15} aria-hidden="true" />{w('Comprendre', 'Understand')}<ChevronDown size={14} aria-hidden="true" /></button>{open ? <div id="understanding-card"><UnderstandingContent key={path} path={path} /></div> : null}</div>;
}
