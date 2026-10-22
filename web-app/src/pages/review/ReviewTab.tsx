import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, CheckCheck, ExternalLink, FolderInput, FolderTree, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../../app/api';
import { hrefFor } from '../../app/router';
import { useShareWords } from '../../app/sharing';
import { toast } from '../../app/toast';
import { Prose } from '../../reader/Prose';
import { ConfirmDialog } from '../../ui/Confirm';
import { DiffView } from '../../ui/DiffView';
import { ErrorState, SkeletonRows } from '../../ui/States';
import '../../styles/review.css';

/** « À relire » (F2.0-55, D71): what the agent filed, sorted by the person when they have a moment. */
type PendingNote = { path: string; title: string; type: string; at: string; reason: string | null; by: string };
type WaitingChange = { id: string; createdAt: string; label: string; paths: string[] };
type ReviewList = { notes: PendingNote[]; changes: WaitingChange[]; checks: { id: string; path: string }[]; sortedToday: number };
type Item = { kind: 'note'; key: string; at: string; note: PendingNote } | { kind: 'change'; key: string; at: string; change: WaitingChange };
type Gesture = { ok: boolean; presence?: string };

export type ReviewState = { state: 'pending' | 'validated'; by: string; at: string; reason: string | null } | null;

function useRefresh() {
  const qc = useQueryClient();
  /** `gone`: a note that no longer lives at this path (removed or moved); its view is dropped, not refetched into a 404. */
  return (gone?: string) => {
    if (gone) qc.removeQueries({ queryKey: ['note', gone], exact: true });
    for (const k of ['review', 'status', 'today', 'note', 'notes', 'proposals']) void qc.invalidateQueries({ queryKey: [k], predicate: (q) => !gone || q.queryKey[0] !== 'note' || q.queryKey[1] !== gone });
  };
}

/** A gesture of the person; without the browser's key, the app asks for their confirmation, and says when it could not. */
async function gesture(path: string, body: Record<string, unknown>, w: ReturnType<typeof useShareWords>): Promise<boolean> {
  try {
    const r = await post<Gesture>(path, body);
    if (r.ok) return true;
    toast(r.presence === 'refused' ? w('Annulé.', 'Cancelled.') : w('Ouvre OKB depuis « okb serve » pour valider ici.', 'Open OKB from « okb serve » to validate here.'), 'err');
  } catch (e) { toast((e as Error).message, 'err'); }
  return false;
}

/** The state of a note, always as a word and a colour. */
export function ReviewBadge({ state, verified = false, small = false }: { state: 'pending' | 'validated' | 'change'; verified?: boolean; small?: boolean }) {
  const w = useShareWords();
  const cls = state === 'pending' ? 'todo' : state === 'change' ? 'change' : verified ? 'okv' : 'ok';
  const word = state === 'pending' ? w('À relire', 'To review') : state === 'change' ? w('Modification en attente', 'Change waiting') : verified ? w('Validée et vérifiée', 'Validated and checked') : w('Validée', 'Validated');
  return <span className={`rv-badge ${cls}${small ? ' sm' : ''}`}>{verified && state === 'validated' ? <BadgeCheck size={13} aria-hidden="true" /> : <span className="dot" aria-hidden="true" />}{word}</span>;
}

/** The reader's slim line on a note to review: yes, no, move, where it stands. */
export function ReaderReviewLine({ path, review }: { path: string; review: ReviewState }) {
  const w = useShareWords(); const refresh = useRefresh(); const [moving, setMoving] = useState(false);
  if (!review || review.state !== 'pending') return null;
  return <>
    <div className="rd-line" role="status"><ReviewBadge state="pending" small /><span className="grow">{w('Rangée par l’agent, déjà utilisable.', 'Filed by the agent, already usable.')}{review.reason ? <span className="muted"> · {review.reason}</span> : null}</span>
      <button type="button" className="btn sm ghost" onClick={async () => { if (await gesture('/api/review/validate', { paths: [path] }, w)) { toast(w('Validée.', 'Validated.')); refresh(); } }}><Check size={15} aria-hidden="true" />{w('Oui', 'Yes')}</button>
      <button type="button" className="btn sm ghost" onClick={async () => { if (await gesture('/api/review/reject', { path }, w)) { toast(w('Retirée.', 'Removed.')); history.back(); refresh(path); } }}><X size={15} aria-hidden="true" />{w('Non', 'No')}</button>
      <button type="button" className="btn sm ghost" onClick={() => setMoving(!moving)} aria-expanded={moving}><FolderInput size={15} aria-hidden="true" />{w('Déplacer', 'Move')}</button>
    </div>
    {moving ? <section className="panel"><FolderPicker path={path} current={dirOf(path)} onDone={(to) => { setMoving(false); if (to === dirOf(path)) return; refresh(path); location.hash = hrefFor({ name: 'brain', path: `${to}/${path.split('/').at(-1)}` }).replace(/^[^#]*/, ''); }} /></section> : null}
  </>;
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

function FolderPicker({ path, current, onDone }: { path: string; current: string; onDone: (to: string) => void }) {
  const w = useShareWords();
  const notes = useQuery({ queryKey: ['notes', 'folders'], queryFn: () => get<{ notes: { path: string }[] }>('/api/notes') });
  const [q, setQ] = useState(''); const [pick, setPick] = useState<string | null>(null);
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes.data?.notes ?? []) { const parts = n.path.split('/').slice(0, -1); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); }
    return [...set].filter((f) => !f.startsWith('.') && (!q || f.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.localeCompare(b));
  }, [notes.data, q]);
  if (notes.error) return <ErrorState error={notes.error} />;
  return <div className="rv-tree">
    <label className="rv-tree-search"><Search size={15} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w('Chercher un dossier', 'Search a folder')} aria-label={w('Chercher un dossier', 'Search a folder')} /></label>
    <ul role="listbox" aria-label={w('Dossiers', 'Folders')}>{folders.slice(0, 200).map((f) => {
      const depth = f.split('/').length - 1;
      return <li key={f} role="option" aria-selected={pick === f} tabIndex={0} className={`${pick === f ? 'pick' : ''}${f === current ? ' now' : ''}`} style={{ paddingLeft: 10 + depth * 18 }} onClick={() => setPick(f)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(f); } }}>
        <FolderTree size={15} aria-hidden="true" />{f.split('/').at(-1)}{f === current ? <span className="muted small"> · {w('proposé par l’agent', 'proposed by the agent')}</span> : null}{pick === f ? <span className="small"> · {w('ton choix', 'your choice')}</span> : null}
      </li>;
    })}</ul>
    <div className="rv-tree-foot"><span className="muted small">{w('Les liens vers cette note suivront.', 'Links to this note will follow.')}</span>
      <button type="button" className="btn sm ghost" onClick={() => onDone(current)}>{w('Annuler', 'Cancel')}</button>
      <button type="button" className="btn sm primary" disabled={!pick || pick === current} onClick={async () => { if (pick && await gesture('/api/review/move', { path, folder: pick }, w)) { toast(w('Rangée ici.', 'Filed here.')); onDone(pick); } }}>{w('Ranger ici', 'File here')}</button>
    </div>
  </div>;
}

function NoteDetail({ note, next }: { note: PendingNote; next: () => void }) {
  const w = useShareWords(); const refresh = useRefresh(); const [moving, setMoving] = useState(false);
  const view = useQuery({ queryKey: ['note', note.path], queryFn: () => get<{ html: string; title: string; crumbs: { title: string }[] }>('/api/note', { path: note.path }) });
  const yes = async () => { if (await gesture('/api/review/validate', { paths: [note.path] }, w)) { refresh(); next(); } };
  const no = async () => { if (await gesture('/api/review/reject', { path: note.path }, w)) { toast(w('Retirée.', 'Removed.')); next(); refresh(note.path); } };
  const check = async () => { try { await post('/api/review/check', { path: note.path }); toast(w('Relecture demandée pour ta prochaine session.', 'Check asked for your next session.')); refresh(); } catch (e) { toast((e as Error).message, 'err'); } };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input, textarea')) return; if (e.key === 'o' || e.key === 'O') void yes(); if (e.key === 'n' || e.key === 'N') void no(); };
    addEventListener('keydown', keys); return () => removeEventListener('keydown', keys);
  });
  const crumbs = note.path.split('/').slice(0, -1);
  return <>
    <div className="rv-bar"><ReviewBadge state="pending" /><span className="small muted">{w('Nouvelle note · rangée par l’agent', 'New note · filed by the agent')} · {new Date(note.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
    {moving ? <FolderPicker path={note.path} current={dirOf(note.path)} onDone={(to) => { setMoving(false); if (to !== dirOf(note.path)) refresh(note.path); }} /> : <>
      <div className="rv-place"><FolderTree size={16} aria-hidden="true" className="muted" /><div className="grow"><div className="rv-k">{w('Rangée ici', 'Filed here')}</div><div className="rv-crumbs">{crumbs.map((c, i) => <span key={i}>{i ? ' › ' : ''}{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>)}</div>{note.reason ? <div className="small muted">{w('Pourquoi : ', 'Why: ')}{note.reason}</div> : null}</div>
        <button type="button" className="btn sm" onClick={() => setMoving(true)}><FolderInput size={15} aria-hidden="true" />{w('Changer l’emplacement', 'Change the place')}</button></div>
      <div className="rv-note">{view.isLoading ? <SkeletonRows rows={6} /> : view.error ? <ErrorState error={view.error} /> : <Prose html={view.data!.html} />}</div>
      <div className="rv-actions">
        <button type="button" className="btn primary" onClick={() => void yes()}><Check size={16} aria-hidden="true" />{w('Oui, je la garde', 'Yes, keep it')}</button>
        <button type="button" className="btn" onClick={() => void no()}><X size={16} aria-hidden="true" />{w('Non, la retirer', 'No, remove it')}</button>
        <button type="button" className="btn ghost" onClick={() => void check()}><ShieldCheck size={16} aria-hidden="true" />{w('Faire relire', 'Ask for a check')}</button>
        <a className="btn ghost" href={hrefFor({ name: 'brain', path: note.path })}><ExternalLink size={15} aria-hidden="true" />{w('Ouvrir', 'Open')}</a>
        <span className="rv-keys small muted"><kbd>O</kbd> {w('oui', 'yes')} <kbd>N</kbd> {w('non', 'no')} <kbd>↑</kbd><kbd>↓</kbd> {w('passer', 'move on')}</span>
      </div>
    </>}
  </>;
}

function ChangeDetail({ change, next }: { change: WaitingChange; next: () => void }) {
  const w = useShareWords(); const refresh = useRefresh();
  const p = useQuery({ queryKey: ['proposal', change.id], queryFn: () => get<{ title: string; files: { path: string; diff: string }[] }>('/api/proposal', { id: change.id }) });
  const diff = (p.data?.files ?? []).map((f) => f.diff).join('\n');
  return <>
    <div className="rv-bar"><ReviewBadge state="change" /><span className="small muted">{w('L’agent veut modifier une note validée ; elle ne change pas tant que tu n’as pas dit oui.', 'The agent wants to change a validated note; it does not change until you say yes.')}</span></div>
    <div className="rv-place"><FolderTree size={16} aria-hidden="true" className="muted" /><div className="grow"><div className="rv-k">{w('Notes concernées', 'Notes concerned')}</div><div className="rv-crumbs">{change.paths.join(' · ')}</div></div></div>
    <div className="rv-note">{p.isLoading ? <SkeletonRows rows={6} /> : p.error ? <ErrorState error={p.error} /> : <DiffView text={diff} />}</div>
    <div className="rv-actions">
      <button type="button" className="btn primary" onClick={async () => { if (await gesture('/api/review/change/approve', { proposal: change.id }, w)) { refresh(); next(); } }}><Check size={16} aria-hidden="true" />{w('Oui, appliquer', 'Yes, apply')}</button>
      <button type="button" className="btn" onClick={async () => { if (await gesture('/api/review/change/reject', { proposal: change.id }, w)) { refresh(); next(); } }}><X size={16} aria-hidden="true" />{w('Non, garder ma version', 'No, keep my version')}</button>
      <a className="btn ghost" href={hrefFor({ name: 'inbox', tab: 'proposals', id: change.id })}>{w('Voir le détail', 'See the detail')}</a>
    </div>
  </>;
}

const dayLabel = (iso: string, lang: string, w: ReturnType<typeof useShareWords>) => {
  const d = new Date(iso); const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return diff <= 0 ? w('Aujourd’hui', 'Today') : diff === 1 ? w('Hier', 'Yesterday') : d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
};

export function ReviewTab() {
  const w = useShareWords(); const refresh = useRefresh();
  const q = useQuery({ queryKey: ['review'], queryFn: () => get<ReviewList>('/api/review') });
  const [filter, setFilter] = useState<'all' | 'notes' | 'changes'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const items: Item[] = useMemo(() => [
    ...(q.data?.notes ?? []).map((n): Item => ({ kind: 'note', key: `n:${n.path}`, at: n.at, note: n })),
    ...(q.data?.changes ?? []).map((c): Item => ({ kind: 'change', key: `c:${c.id}`, at: c.createdAt, change: c })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [q.data]);
  const shown = items.filter((i) => filter === 'all' || (filter === 'notes' ? i.kind === 'note' : i.kind === 'change'));
  const current = shown.find((i) => i.key === selected) ?? shown[0];
  const next = () => { const i = shown.findIndex((x) => x.key === current?.key); setSelected(shown[i + 1]?.key ?? shown[i - 1]?.key ?? null); };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || !current) return;
      const i = shown.findIndex((x) => x.key === current.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setSelected(shown[Math.min(i + 1, shown.length - 1)]?.key ?? null); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setSelected(shown[Math.max(i - 1, 0)]?.key ?? null); }
    };
    addEventListener('keydown', keys); return () => removeEventListener('keydown', keys);
  });
  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!items.length) return <section className="panel rv-done"><span className="rv-done-icon"><Check size={24} aria-hidden="true" /></span><h2>{w('Tout est trié', 'Everything is sorted')}</h2><p className="muted">{q.data.sortedToday ? w(`${q.data.sortedToday} notes validées aujourd’hui.`, `${q.data.sortedToday} notes validated today.`) : w('Rien n’attend ta relecture.', 'Nothing waits for your review.')}</p><a className="link" href={hrefFor({ name: 'today' })}>{w('Retour à l’accueil', 'Back to Today')}</a></section>;
  const total = items.length + q.data.sortedToday;
  let lastDay = '';
  return <div className="rv">
    <div className="rv-head">
      <div><p className="page-intro" style={{ margin: 0 }}>{w('Ce que l’agent a rangé pour toi. Trie au calme : rien n’est bloqué en attendant.', 'What the agent filed for you. Sort it when you have a moment: nothing is blocked meanwhile.')}</p>
        <div className="rv-progress" role="img" aria-label={w(`${q.data.sortedToday} triées sur ${total} aujourd’hui`, `${q.data.sortedToday} sorted of ${total} today`)}><span style={{ width: `${total ? Math.round((q.data.sortedToday * 100) / total) : 0}%` }} /></div>
        <span className="small muted">{w(`${q.data.sortedToday} triées sur ${total} aujourd’hui`, `${q.data.sortedToday} sorted of ${total} today`)}</span></div>
      <div className="row wrap" style={{ marginLeft: 'auto' }}>
        <div className="segmented" role="group" aria-label={w('Filtrer', 'Filter')}>{(['all', 'notes', 'changes'] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{({ all: w('Tout', 'All'), notes: w('Nouvelles', 'New'), changes: w('Modifications', 'Changes') })[f]} <b>{f === 'all' ? items.length : f === 'notes' ? q.data!.notes.length : q.data!.changes.length}</b></button>)}</div>
        <button type="button" className="btn sm" onClick={() => setAll(true)}><CheckCheck size={15} aria-hidden="true" />{w('Oui à tout, sauf…', 'Yes to all, except…')}</button>
      </div>
    </div>
    <div className="rv-cols">
      <ul className="rv-list" aria-label={w('À relire', 'To review')}>{shown.map((i) => {
        const day = dayLabel(i.at, 'fr', w); const head = day !== lastDay ? (lastDay = day, <li className="rv-day" aria-hidden="true" key={`d:${day}`}>{day}</li>) : null;
        return [head, <li key={i.key} className={current?.key === i.key ? 'on' : ''} tabIndex={0} aria-current={current?.key === i.key} onClick={() => setSelected(i.key)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(i.key); }}>
          <span className="rv-t">{i.kind === 'note' ? i.note.title : i.change.label}</span>
          <span className="rv-m"><span className={`rv-kind${i.kind === 'change' ? ' change' : ''}`}>{i.kind === 'note' ? w('nouvelle', 'new') : w('modification', 'change')}</span><span>{i.kind === 'note' ? dirOf(i.note.path) : i.change.paths[0]}</span><span>{new Date(i.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></span>
        </li>];
      })}</ul>
      <section className="panel rv-detail" aria-live="polite">{current ? current.kind === 'note' ? <NoteDetail key={current.key} note={current.note} next={next} /> : <ChangeDetail key={current.key} change={current.change} next={next} /> : null}</section>
    </div>
    <ConfirmDialog open={all} onOpenChange={setAll} title={w('Dire oui à tout ce qui reste ?', 'Say yes to everything left?')} confirm={w('Oui à tout', 'Yes to all')} onConfirm={async () => { if (await gesture('/api/review/yes-to-all', { exceptNotes: [], exceptChanges: [] }, w)) { toast(w('Tout est validé.', 'All validated.')); refresh(); } }}>
      <p>{w(`${q.data.notes.length} notes seront validées et ${q.data.changes.length} modifications appliquées. Pour en garder une de côté, traite-la d’abord une par une.`, `${q.data.notes.length} notes will be validated and ${q.data.changes.length} changes applied. To set one aside, handle it first one by one.`)}</p>
    </ConfirmDialog>
  </div>;
}
