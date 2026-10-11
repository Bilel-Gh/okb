import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Check, Clock, GraduationCap, Network, Trophy } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { LEVEL_WORDS, UNDERSTANDING_LEVELS, type LearningPathways, type MeetingBrief, type SubjectLevel, type UnderstandingDebt, type UnderstandingOverview } from '../app/understanding';
import { UnderstandingAct, UnderstandingSources } from '../reader/Understanding';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

export function useUnderstandingOverview() { return useQuery({ queryKey: ['understanding', 'overview'], queryFn: () => get<UnderstandingOverview>('/api/understanding/overview') }); }
const noteLink = (path: string) => hrefFor({ name: 'brain', path, query: { understand: '1' } });

function Debt({ debt, compact = false }: { debt: UnderstandingDebt; compact?: boolean }) {
  const w = useShareWords();
  const [resolve, setResolve] = useState(false);
  return <div className="stack understanding-debt"><div className="row"><b className="grow">{debt.subject}</b><span className="pill sm"><Clock size={12} aria-hidden="true" />{debt.minutes} min</span></div><p className="small">{debt.point || w(`Rencontré ou consulté ${debt.encounters} fois, sans explication enregistrée.`, `Encountered or consulted ${debt.encounters} times, without a recorded explanation.`)}</p><div className="row wrap"><a className="btn sm primary" href={noteLink(debt.path)}>{w('Comprendre en 5 minutes', 'Understand in 5 minutes')}<ArrowRight size={14} aria-hidden="true" /></a>{!compact ? <button type="button" className="btn sm ghost" aria-expanded={resolve} onClick={() => setResolve(!resolve)}>{w('J’ai clarifié ce point', 'I clarified this point')}</button> : null}</div>{resolve ? <UnderstandingAct path={debt.path} initialKind="resolved" initialPoint={debt.point} onSaved={() => setResolve(false)} /> : null}</div>;
}

/** Only one private invitation, with no model call and no manufactured expertise. */
export function UnderstandingToday() {
  const w = useShareWords();
  const q = useUnderstandingOverview();
  if (q.error) return <section className="panel"><div className="panel-body"><ErrorState error={q.error} retry={() => void q.refetch()} /></div></section>;
  if (!q.data?.today) return null;
  return <section className="panel"><div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{w('1 chose à comprendre aujourd’hui', '1 thing to understand today')}</h2><a className="link" href={hrefFor({ name: 'learn', tab: 'understanding' })}>{w('Voir mes points flous', 'See my unclear points')}</a></div><div className="panel-body"><Debt debt={q.data.today} compact /></div></section>;
}

function SkillGraph({ data }: { data: UnderstandingOverview }) {
  const w = useShareWords();
  const [filter, setFilter] = useState('');
  const nodes = data.graph.nodes.filter((n) => !filter.trim() || n.title.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 80);
  const positions = new Map(nodes.map((n, i) => [n.id, { x: 110 + (i % 4) * 210, y: 42 + Math.floor(i / 4) * 70 }]));
  const height = Math.max(120, Math.ceil(nodes.length / 4) * 70 + 18);
  const levelWord = (level: SubjectLevel['level']) => level ? w(...LEVEL_WORDS[level]) : w('Pas de geste enregistré', 'No recorded action');
  return <section className="panel"><div className="panel-head"><h2><Network size={17} aria-hidden="true" />{w('Carte de mes sujets', 'Map of my subjects')}</h2></div><div className="panel-body stack">
    <p className="small muted">{w('La couleur suit les gestes enregistrés ou déclarés. Elle ne mesure pas ce que vous savez réellement.', 'Colour follows recorded or declared actions. It does not measure your actual knowledge.')}</p>
    <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={w('Filtrer les sujets', 'Filter subjects')} placeholder={w('Retrouver un sujet…', 'Find a subject…')} />
    <div className="row wrap xs understanding-legend">{UNDERSTANDING_LEVELS.map((level, i) => <span key={level} style={{ '--level': i } as CSSProperties}><i className={`understanding-dot level-${level}`} aria-hidden="true" />{w(...LEVEL_WORDS[level])}</span>)}</div>
    {nodes.length ? <div className="understanding-graph"><svg viewBox={`0 0 850 ${height}`} role="img" aria-label={w('Carte des sujets par gestes enregistrés', 'Map of subjects by recorded actions')}><g aria-hidden="true">{data.graph.edges.filter((e) => positions.has(e.source) && positions.has(e.target)).map((e, i) => { const a = positions.get(e.source)!; const b = positions.get(e.target)!; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}</g>{nodes.map((n) => { const p = positions.get(n.id)!; return <a key={n.id} href={noteLink(n.id)} aria-label={`${n.title} · ${levelWord(n.level)}`} className={`level-${n.level ?? 'none'}`}><title>{n.title} · {levelWord(n.level)}</title><rect x={p.x - 98} y={p.y - 21} width="196" height="42" rx="8" /><text x={p.x} y={p.y - 2} textAnchor="middle">{n.title.length > 25 ? `${n.title.slice(0, 24)}…` : n.title}</text><text className="level-caption" x={p.x} y={p.y + 13} textAnchor="middle">{levelWord(n.level)}</text></a>; })}</svg></div> : <Empty title={w('Aucun sujet trouvé', 'No subject found')} />}
    {data.graph.nodes.length > 80 ? <p className="xs muted">{w('La carte montre au plus 80 sujets. Filtrez pour retrouver les autres.', 'The map shows up to 80 subjects. Filter to find the others.')}</p> : null}
    <details><summary>{w('Voir les gestes qui expliquent les niveaux', 'See the actions behind these levels')}</summary><ul className="rows">{data.subjects.filter((s) => s.events > 0).map((s) => <li key={s.path}><div className="grow stack"><a className="link" href={noteLink(s.path)}>{s.subject} · {levelWord(s.level)}</a>{s.evidence.map((e) => <p className="xs muted" key={e.id}>{e.kind in LEVEL_WORDS ? w(...LEVEL_WORDS[e.kind as keyof typeof LEVEL_WORDS]) : e.kind === 'unclear' ? w('Point flou', 'Unclear point') : w('Point clarifié', 'Clarified point')} · {e.point || new Date(e.at).toLocaleDateString()}</p>)}</div></li>)}</ul></details>
  </div></section>;
}

export function UnderstandingProgress() {
  const w = useShareWords();
  const qc = useQueryClient();
  const q = useUnderstandingOverview();
  const save = useMutation({ mutationFn: (enabled: boolean) => post('/api/understanding/progress', { enabled }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['understanding'] }); } });
  if (q.isLoading) return <SkeletonRows rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const p = q.data.progress;
  const names = { resolved: w('Points clarifiés', 'Points clarified'), explained: w('Explications données', 'Explanations given'), reused: w('Notes réutilisées', 'Notes reused') };
  return <section className="panel"><div className="panel-head"><h2><Trophy size={17} aria-hidden="true" />{w('Ma progression privée', 'My private progress')}</h2></div><div className="panel-body stack lg"><p className="muted small">{w('Facultative, sur cette machine. Elle récompense les points clarifiés, les explications données et les notes réutilisées.', 'Optional, on this machine. It rewards clarified points, explanations given and notes reused.')}</p><label className="row small"><input type="checkbox" checked={p.enabled} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />{w('Activer ma progression privée', 'Enable my private progress')}</label>{save.error ? <ErrorState error={save.error} /> : null}{p.enabled ? <><div className="row"><span className="level-badge num">{p.level.level}</span><span className="grow"><b>{p.xp} XP</b><span className="bar" aria-label={w('Vers le prochain niveau', 'Towards the next level')} role="meter" aria-valuemin={p.level.from} aria-valuemax={p.level.to} aria-valuenow={p.xp}><span style={{ width: `${Math.max(0, Math.min(100, ((p.xp - p.level.from) / Math.max(1, p.level.to - p.level.from)) * 100))}%` }} /></span></span></div><ul className="badge-grid">{p.badges.map((b) => <li className={`badge-tile tier-${b.tier}`} key={b.id}><b>{names[b.id as keyof typeof names] ?? b.id}</b><span className="num">{b.count}{b.next ? ` / ${b.next}` : ''}</span><small className="muted">{b.tier === 'none' ? w('Premier geste à venir', 'First action ahead') : b.tier}</small></li>)}</ul></> : <p className="small muted">{w('Vos gestes et vos points flous restent disponibles même sans XP.', 'Your actions and unclear points remain available without XP.')}</p>}</div></section>;
}

function Meeting() {
  const w = useShareWords();
  const projects = useQuery({ queryKey: ['projects', 'understanding'], queryFn: () => get<{ projects: { id: string; title: string }[] }>('/api/projects', { status: 'all' }) });
  const [projectId, setProjectId] = useState('');
  const [query, setQuery] = useState('');
  const prepare = useMutation({ mutationFn: () => post<MeetingBrief>('/api/understanding/meeting', { ...(projectId ? { projectId } : {}), ...(query.trim() ? { query: query.trim() } : {}) }) });
  const d = prepare.data;
  return <section className="panel"><div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{w('Prépare ma réunion', 'Prepare my meeting')}</h2><span className="pill sm">{w('Sans IA', 'Without AI')}</span></div><div className="panel-body stack lg"><p className="muted small">{w('Rassemblez les notes reliées au projet, les points ouverts et les questions déjà enregistrées.', 'Gather notes related to the project, open points and already recorded questions.')}</p><form className="stack" onSubmit={(e) => { e.preventDefault(); if (!prepare.isPending && (projectId || query.trim())) prepare.mutate(); }}><div className="field"><label htmlFor="meeting-project">{w('Projet de la réunion', 'Meeting project')}</label><select id="meeting-project" className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); prepare.reset(); }}><option value="">{w('Choisir un projet', 'Choose a project')}</option>{projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div><div className="field"><label htmlFor="meeting-query">{w('Sujet de la réunion', 'Meeting subject')}</label><input id="meeting-query" className="input" value={query} onChange={(e) => { setQuery(e.target.value); prepare.reset(); }} placeholder={w('Facultatif si le projet a un dossier de notes', 'Optional if the project has a note folder')} /></div><span><button className="btn primary sm" type="submit" disabled={prepare.isPending || (!projectId && !query.trim())}>{w('Préparer ma réunion', 'Prepare my meeting')}</button></span></form>{projects.error ? <ErrorState error={projects.error} /> : null}{prepare.error ? <ErrorState error={prepare.error} /> : null}{d ? <div className="stack lg">{d.project ? <div><h3>{d.project.title}</h3><p>{d.project.where}</p><p>{d.project.next}</p></div> : null}<h3>{w('Ce que mes notes documentent', 'What my notes document')}</h3>{d.known.length ? <ul className="stack">{d.known.map((n) => <li key={n.path}><a className="link" href={noteLink(n.path)}>{n.title}</a><p className="small muted">{n.description}</p><UnderstandingSources sources={n.sources} /></li>)}</ul> : <p className="muted small">{w('Aucune note reliée à ce sujet.', 'No notes related to this subject.')}</p>}<h3>{w('Ce qui reste ouvert', 'What remains open')}</h3>{d.open.length ? <ul>{d.open.map((o) => <li key={o.id}>{o.text}</li>)}</ul> : <p className="muted small">{w('Aucun point ouvert enregistré.', 'No recorded open point.')}</p>}<h3>{w('Les questions à préparer', 'Questions to prepare')}</h3>{d.questions.length ? <ul>{d.questions.map((q, i) => <li key={i}>{q.source.path ? <a className="link" href={noteLink(q.source.path)}>{q.text}</a> : q.text}</li>)}</ul> : <p className="muted small">{w('Aucune question enregistrée.', 'No recorded question.')}</p>}<p className="xs muted">{d.limitations.join(' ')}</p></div> : null}</div></section>;
}

function Pathways() {
  const w = useShareWords();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['understanding', 'learning'], queryFn: () => get<LearningPathways>('/api/understanding/learning') });
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const save = useMutation({ mutationFn: () => post('/api/understanding/objective/add', { text: text.trim(), ...(subject.trim() ? { subject: subject.trim() } : {}) }), onSuccess: () => { setText(''); setSubject(''); void qc.invalidateQueries({ queryKey: ['understanding', 'learning'] }); } });
  const done = useMutation({ mutationFn: (id: string) => post('/api/understanding/objective/done', { id }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['understanding', 'learning'] }); } });
  const verbs = { consult: w('Consulter', 'Read'), explain: w('Expliquer avec mes mots', 'Explain in my own words'), review: w('Réviser', 'Review'), reuse: w('Réutiliser puis enregistrer mon geste', 'Reuse and record my action') };
  return <section className="panel"><div className="panel-head"><h2><GraduationCap size={17} aria-hidden="true" />{w('Mes petits parcours', 'My short pathways')}</h2></div><div className="panel-body stack lg"><form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !save.isPending) save.mutate(); }}><div className="field"><label htmlFor="learning-objective">{w('Ce que je choisis d’apprendre', 'What I choose to learn')}</label><input id="learning-objective" className="input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></div><div className="field"><label htmlFor="learning-subject">{w('Sujet des cartes de révision, si connu', 'Review-card subject, if known')}</label><input id="learning-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div><span><button className="btn sm" type="submit" disabled={!text.trim() || save.isPending}>{w('Créer mon parcours', 'Create my pathway')}</button></span></form>{save.error || done.error ? <ErrorState error={save.error ?? done.error} /> : null}{q.isLoading ? <SkeletonRows rows={3} /> : q.error ? <ErrorState error={q.error} retry={() => void q.refetch()} /> : q.data?.pathways.length ? q.data.pathways.map((p) => <div className="stack understanding-pathway" key={p.id}><div className="row"><b className="grow">{p.text}</b>{p.doneAt ? <span className="pill ok sm">{w('Terminé', 'Done')}</span> : <button type="button" className="btn sm ghost" disabled={done.isPending} onClick={() => done.mutate(p.id)}><Check size={14} aria-hidden="true" />{w('Objectif atteint', 'Objective reached')}</button>}</div>{p.steps.length ? <ol className="stack small">{p.steps.map((s, i) => <li key={`${s.kind}:${s.path}:${i}`} className={s.done ? 'muted' : undefined}>{s.done ? <Check size={12} aria-hidden="true" /> : null}<a href={s.kind === 'review' ? hrefFor({ name: 'learn' }) : noteLink(s.path)}>{verbs[s.kind]} · {s.title}</a></li>)}</ol> : <p className="small muted">{w('Aucune note reliée pour le moment. Ajoutez des notes sur cet objectif.', 'No related note yet. Add notes about this objective.')}</p>}</div>) : <p className="small muted">{w('Choisissez un objectif pour partir des notes présentes. Les révisions gardent leur calendrier existant.', 'Choose an objective to work from existing notes. Reviews keep their existing schedule.')}</p>}{q.data?.limitations.length ? <p className="xs muted">{q.data.limitations.join(' ')}</p> : null}</div></section>;
}

export default function UnderstandingPage() {
  const w = useShareWords();
  const q = useUnderstandingOverview();
  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  return <div className="stack lg"><section className="panel"><div className="panel-head"><h2><Clock size={17} aria-hidden="true" />{w('Mes points à éclaircir', 'My points to clarify')}</h2></div><div className="panel-body stack lg">{d.debts.length ? d.debts.map((debt) => <Debt key={debt.id} debt={debt} />) : <Empty title={w('Pas de point flou signalé', 'No unclear point recorded')}>{w('La fiche Comprendre permet de signaler un point ou d’expliquer un sujet avec vos mots.', 'The understanding card lets you flag a point or explain a subject in your own words.')}</Empty>}</div></section><SkillGraph data={d} /><div className="grid-2"><Meeting /><Pathways /></div><p className="xs muted">{d.limitations.join(' ')}</p></div>;
}
