import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeft, BookOpen, Check, Eye, FolderGit2, Lock, Network, Package, Send, Share2, Trash2, Users } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, currentKb, currentSession, get, post } from '../app/api';
import { useNotes } from '../app/data';
import { hrefFor, type Route } from '../app/router';
import { useShareWords, type BrainMap, type CommonTerm, type SharedNote, type SharePreview, type ShareStatus } from '../app/sharing';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import Packs from './Share';
import { normalizeNoteHeadings, wireLinks } from '../reader/enhance';

type SharingRoute = Extract<Route, { name: 'sharing' }>;
type Sent = { written: number; removed: number; kept: number; held: number; unknown: string[]; committed: boolean; pushed: boolean };

function useRefreshSharing() {
  const qc = useQueryClient();
  return () => { for (const key of ['share', 'shared', 'find', 'ask']) void qc.invalidateQueries({ queryKey: [key] }); };
}

function Setup({ status, onDone }: { status?: Extract<ShareStatus, { ready: true }>; onDone: () => void }) {
  const w = useShareWords();
  const id = useId();
  const [folder, setFolder] = useState(status?.folder ?? '');
  const [drawer, setDrawer] = useState(status?.drawer ?? '');
  const [allowed, setAllowed] = useState(false);
  const setup = useMutation({ mutationFn: () => post('/api/share/setup', { folder: folder.trim(), drawer: drawer.trim(), allowed }), onSuccess: onDone });
  return (
    <section className="panel">
      <div className="panel-head"><h2><FolderGit2 size={17} aria-hidden="true" />{w('Relier le dépôt commun', 'Connect the shared repository')}</h2></div>
      <form className="panel-body stack" onSubmit={(e) => { e.preventDefault(); if (allowed && folder.trim() && drawer.trim() && !setup.isPending) setup.mutate(); }}>
        <p className="small muted">{w('Clone le dépôt autorisé par ton entreprise, puis indique sa copie locale. OKB écrit uniquement dans ton tiroir.', 'Clone the repository allowed by your company, then choose its local copy. OKB writes only in your drawer.')}</p>
        <label className="field" htmlFor={`${id}-folder`}><span className="label">{w('Copie locale du dépôt commun', 'Local copy of the shared repository')}</span><input id={`${id}-folder`} className="input" value={folder} onChange={(e) => { setFolder(e.target.value); setAllowed(false); }} placeholder="~/dev/team-knowledge" autoComplete="off" spellCheck={false} required maxLength={1000} /></label>
        <label className="field" htmlFor={`${id}-drawer`}><span className="label">{w('Mon tiroir', 'My drawer')}</span><input id={`${id}-drawer`} className="input" value={drawer} onChange={(e) => setDrawer(e.target.value)} placeholder="alex" autoComplete="off" required maxLength={60} /></label>
        <label className="row small share-check"><input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />{w('Cet emplacement est autorisé par les règles de mon entreprise pour ces notes.', 'My company allows this location for these notes.')}</label>
        {setup.error ? <ErrorState error={setup.error} /> : null}
        <div className="row"><button type="submit" className="btn primary" disabled={!allowed || !folder.trim() || !drawer.trim() || setup.isPending} aria-busy={setup.isPending}>{w('Relier ce dépôt', 'Connect this repository')}</button>{status ? <button type="button" className="btn ghost" onClick={onDone}>{w('Annuler', 'Cancel')}</button> : null}</div>
      </form>
    </section>
  );
}

function Drawers({ status, path }: { status: Extract<ShareStatus, { ready: true }>; path?: string }) {
  const w = useShareWords();
  const refresh = useRefreshSharing();
  const notes = useNotes();
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => get<{ projects: { id: string; title: string; folder: string | null }[] }>('/api/projects', { status: 'all' }) });
  const [scope, setScope] = useState<'note' | 'project'>('note');
  const [chosen, setChosen] = useState(path ?? '');
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (path) setChosen(path); }, [path]);
  const reset = () => { setPreview(null); setReviewed(false); setSent(null); setError(null); };
  const mark = useMutation({
    mutationFn: (v: { path: string; remove: boolean }) => post(v.remove ? '/api/share/unmark' : '/api/share/mark', { paths: [v.path] }),
    onSuccess: () => { reset(); setChosen(''); refresh(); }, onError: setError,
  });
  const inspect = useMutation({ mutationFn: () => get<SharePreview>('/api/share/preview'), onSuccess: (p) => { setPreview(p); setReviewed(false); setError(null); setSent(null); }, onError: setError });
  const send = useMutation({
    mutationFn: (push: boolean) => post<Sent>('/api/share/send', { push, previewHash: preview!.previewHash }),
    onSuccess: (r) => { setSent(r); setPreview(null); setReviewed(false); refresh(); },
    onError: (e) => { setError(e); if (e instanceof ApiError && e.key === 'sharePreviewChanged') { setPreview(null); setReviewed(false); } },
  });
  const receive = useMutation({ mutationFn: () => post<{ changed: boolean }>('/api/share/receive'), onSuccess: refresh, onError: setError });
  const busy = mark.isPending || inspect.isPending || send.isPending || receive.isPending;
  const heldReason = (reason: SharePreview['held'][number]['reason']) => ({
    secret: w('Note verrouillée', 'Locked note'), private: w('Note privée', 'Private note'), career: w('Carrière personnelle', 'Personal career'), 'holds-secret': w('Secret détecté dans le texte', 'Secret detected in the text'),
  })[reason];
  return (
    <div className="stack lg">
      <section className="panel">
        <div className="panel-head"><h2><Share2 size={17} aria-hidden="true" />{w('Ce que je partage', 'What I share')}</h2></div>
        <div className="panel-body stack">
          <p className="small muted">{w('Marquer une note ou un projet ne l’envoie pas. Le dossier d’un projet inclut ses notes, pas ses actions ni son journal personnel.', 'Marking a note or project does not send it. A project folder includes its notes, not its actions or personal journal.')}</p>
          <div className="segmented" role="group" aria-label={w('Choisir ce qui est partageable', 'Choose what can be shared')}>
            <button type="button" aria-pressed={scope === 'note'} onClick={() => { setScope('note'); setChosen(''); }}>{w('Une note', 'One note')}</button>
            <button type="button" aria-pressed={scope === 'project'} onClick={() => { setScope('project'); setChosen(''); }}>{w('Un projet', 'One project')}</button>
          </div>
          <label className="field"><span className="label">{w('À rendre partageable', 'Make shareable')}</span><select className="select" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
            <option value="">{w('Choisir…', 'Choose…')}</option>
            {scope === 'note' ? (notes.data?.notes ?? []).map((n) => <option key={n.path} value={n.path} disabled={n.secret}>{n.secret ? '🔒 ' : ''}{n.title} · {n.path}</option>) : (projects.data?.projects ?? []).filter((p) => p.folder).map((p) => <option key={p.id} value={p.folder!}>{p.title}</option>)}
            {chosen && !(notes.data?.notes ?? []).some((n) => n.path === chosen) && !(projects.data?.projects ?? []).some((p) => p.folder === chosen) ? <option value={chosen}>{chosen}</option> : null}
          </select></label>
          {notes.error || projects.error ? <ErrorState error={notes.error ?? projects.error} retry={() => { void notes.refetch(); void projects.refetch(); }} /> : null}
          <span><button type="button" className="btn sm" disabled={!chosen || busy} onClick={() => mark.mutate({ path: chosen, remove: false })}>{w('Marquer comme partageable', 'Mark as shareable')}</button></span>
          {status.marked.length ? <ul className="rows share-marks">{status.marked.map((p) => <li key={p}><span className="grow path">{p}</span><button type="button" className="btn sm ghost" disabled={busy} onClick={() => mark.mutate({ path: p, remove: true })}><Trash2 size={14} aria-hidden="true" />{w('Ne plus partager', 'Stop sharing')}</button></li>)}</ul> : <p className="small muted">{w('Aucune note n’est marquée. Choisis ce qui peut aider ton collègue.', 'No note is marked. Choose what can help your colleague.')}</p>}
          <p className="small muted row"><Lock size={14} aria-hidden="true" />{w('Le verrou, les notes privées, les secrets, le bagage et la carrière restent personnels.', 'Locked notes, private notes, secrets, baggage and career stay personal.')}</p>
          <span><button type="button" className="btn primary" disabled={busy} aria-busy={inspect.isPending} onClick={() => { reset(); inspect.mutate(); }}><Eye size={16} aria-hidden="true" />{w('Voir ce qui sera partagé', 'Preview what will be shared')}</button></span>
        </div>
      </section>
      {error ? <ErrorState error={error} /> : null}
      {preview ? <section className="panel" aria-labelledby="share-preview">
        <div className="panel-head"><h2 id="share-preview"><Eye size={17} aria-hidden="true" />{w('Aperçu avant partage', 'Preview before sharing')}</h2></div>
        <div className="panel-body stack">
          <p className="small">{w('Destination', 'Destination')} : <code className="path">{status.folder}/{status.drawer}</code></p>
          <h3 className="small">{w('Ces notes seront copiées', 'These notes will be copied')} · {preview.leaving.length}</h3>
          {preview.leaving.length ? preview.leaving.map((n) => <details className="share-note-preview" key={n.path} open={preview.leaving.length === 1}><summary>{n.title}<span className="meta path">{n.path}</span></summary><pre>{n.markdown}</pre></details>) : <p className="small muted">{w('Aucune note ne partira.', 'No note will leave.')}</p>}
          {preview.held.length ? <div className="stack"><h3 className="small">{w('Ces notes restent ici', 'These notes stay here')}</h3><ul className="rows">{preview.held.map((n) => <li key={n.path}><Lock size={14} aria-hidden="true" /><span className="grow">{n.title}<span className="meta">{heldReason(n.reason)}</span></span></li>)}</ul></div> : null}
          {preview.removed.length ? <div className="notice warn"><div><h3 className="small">{w('Retirées de mon tiroir commun', 'Removed from my shared drawer')}</h3><p className="small">{w('Les originaux restent dans mon cerveau.', 'The originals stay in my brain.')}</p><ul>{preview.removed.map((n) => <li key={n.path}>{n.title}</li>)}</ul></div></div> : null}
          <label className="row small share-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(e) => setReviewed(e.target.checked)} />{w('J’ai relu cet aperçu et la destination.', 'I reviewed this preview and the destination.')}</label>
          <div className="row wrap"><button type="button" className="btn primary" disabled={!reviewed || busy} aria-busy={send.isPending} onClick={() => send.mutate(false)}><Check size={15} aria-hidden="true" />{w('Préparer dans la copie locale', 'Prepare in the local copy')}</button>
            <button type="button" className="btn" disabled={!reviewed || busy || !status.git || !status.remote} onClick={() => send.mutate(true)}><Send size={15} aria-hidden="true" />{w('Préparer et envoyer au dépôt commun', 'Prepare and send to the shared repository')}</button></div>
          <p className="xs muted">{w('Préparer copie seulement dans ton tiroir local. Envoyer crée un commit de ton tiroir et pousse vers', 'Preparing only copies into your local drawer. Sending commits your drawer and pushes to')} <code className="path">{status.remote ?? w('aucun dépôt distant configuré', 'no configured remote repository')}</code>.</p>
        </div>
      </section> : null}
      {sent ? <div className="notice ok" role="status"><div><strong>{sent.pushed ? w('Partage envoyé', 'Sharing sent') : w('Copie locale préparée', 'Local copy prepared')}</strong><p className="small">{sent.written} {w('copiée(s)', 'copied')} · {sent.kept} {w('inchangée(s)', 'unchanged')} · {sent.removed} {w('retirée(s) du tiroir', 'removed from drawer')} · {sent.held} {w('retenue(s)', 'held back')}</p>{sent.unknown.length ? <p className="small">{w('Fichiers ajoutés à la main laissés intacts', 'Manually added files left untouched')} : {sent.unknown.join(', ')}</p> : null}</div></div> : null}
      <section className="panel">
        <div className="panel-head"><h2><Users size={17} aria-hidden="true" />{w('Les tiroirs de mes collègues', 'My colleagues’ drawers')}</h2><button type="button" className="btn sm" disabled={busy || !status.git || !status.remote} aria-busy={receive.isPending} onClick={() => receive.mutate()}><ArrowDownToLine size={14} aria-hidden="true" />{w('Recevoir les nouveautés', 'Receive updates')}</button></div>
        <div className="panel-body stack"><p className="small muted">{w('Recevoir met à jour la copie du dépôt commun. Rien n’entre automatiquement dans ton cerveau.', 'Receiving updates the shared repository copy. Nothing enters your brain automatically.')}</p>
          {receive.isSuccess ? <p className="small" role="status">{receive.data.changed ? w('Copie mise à jour.', 'Copy updated.') : w('La copie était déjà à jour.', 'The copy was already up to date.')}</p> : null}
          {status.drawers.filter((d) => !d.mine).length ? <ul className="rows">{status.drawers.filter((d) => !d.mine).map((d) => <li key={d.drawer}><Users size={16} aria-hidden="true" /><span className="grow">{d.name}<span className="meta">{d.notes} {w('notes partagées', 'shared notes')}</span></span><a className="btn sm" href={hrefFor({ name: 'sharing', tab: 'map' })}>{w('Voir ce qu’il partage', 'See what they share')}</a></li>)}</ul> : <p className="small muted">{w('Aucun autre tiroir reçu. Ton collègue doit d’abord partager, puis tu peux recevoir ses nouveautés.', 'No other drawer received. Your colleague first shares, then you can receive their updates.')}</p>}
        </div>
      </section>
    </div>
  );
}

function Maps() {
  const w = useShareWords();
  const q = useQuery({ queryKey: ['shared', 'map'], queryFn: () => get<{ maps: BrainMap[] }>('/api/shared/map') });
  if (q.isLoading) return <SkeletonRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data.maps.length) return <Empty title={w('Une carte dès le premier tiroir reçu', 'A map when the first drawer arrives')}>{w('Reçois les nouveautés du dépôt pour comparer vos notes.', 'Receive repository updates to compare your notes.')}</Empty>;
  return <div className="stack lg"><p className="small muted">{w('La carte compare les titres des notes, pas les connaissances d’une personne. Un collègue peut savoir bien plus que ce qu’il partage.', 'The map compares note titles, not a person’s knowledge. A colleague may know much more than they share.')}</p>{q.data.maps.map((m) => <section className="panel" key={m.drawer}>
    <div className="panel-head"><h2>{w('Mon cerveau et', 'My brain and')} {m.by}</h2></div>
    <div className="panel-body stack">
      <svg className="sharing-map" viewBox="0 0 660 130" role="img" aria-label={`${w('Moi', 'Me')} : ${m.mine.length} · ${w('En commun', 'In common')} : ${m.both.length} · ${m.by} : ${m.theirs.length}`}>
        <path d="M 170 64 H 278 M 382 64 H 490" /><g><circle cx="115" cy="64" r="50" /><text x="115" y="57">{w('Moi', 'Me')}</text><text x="115" y="79" className="num">{m.mine.length}</text></g><g><circle cx="330" cy="64" r="50" /><text x="330" y="57">{w('En commun', 'In common')}</text><text x="330" y="79" className="num">{m.both.length}</text></g><g><circle cx="545" cy="64" r="50" /><text x="545" y="57">{m.by.slice(0, 13)}</text><text x="545" y="79" className="num">{m.theirs.length}</text></g>
      </svg>
      <div className="sharing-columns">{(['mine', 'both', 'theirs'] as const).map((side) => <details key={side}><summary>{side === 'mine' ? w('Seulement dans mon cerveau', 'Only in my brain') : side === 'both' ? w('Des notes de même titre', 'Notes with matching titles') : `${w('Partagées par', 'Shared by')} ${m.by}`} · {m[side].length}</summary><ul className="sharing-links">{m[side].map((n) => <li key={n.path}><a href={side === 'theirs' ? hrefFor({ name: 'sharing', drawer: m.drawer, note: n.path }) : hrefFor({ name: 'brain', path: n.path })}>{n.title}</a></li>)}</ul></details>)}</div>
      {m.holes.length ? <div><h3 className="small">{w('Termes sans fiche des deux côtés', 'Terms without a card on either side')}</h3><p className="small muted">{m.holes.map((h) => h.term).join(' · ')}</p></div> : null}
      {m.fromThem.length ? <div><h3 className="small">{w('Ton collègue explique ces termes', 'Your colleague explains these terms')}</h3><ul className="sharing-links">{m.fromThem.map((term) => <li key={term.term}><a href={hrefFor({ name: 'sharing', drawer: m.drawer, note: term.path })}>{term.term}</a></li>)}</ul></div> : null}
    </div>
  </section>)}</div>;
}

function Glossary() {
  const w = useShareWords();
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['shared', 'glossary'], queryFn: () => get<{ terms: CommonTerm[] }>('/api/shared/glossary') });
  if (q.isLoading) return <SkeletonRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const shown = q.data.terms.filter((term) => term.term.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="panel"><div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{w('Glossaire commun', 'Common glossary')}</h2></div><div className="panel-body stack">
    <label className="field"><span className="label">{w('Trouver un terme', 'Find a term')}</span><input type="search" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
    {shown.length ? <dl className="sharing-glossary">{shown.map((term) => <div key={term.term}><dt>{term.term}</dt>{term.definitions.map((d) => <dd key={`${d.drawer ?? 'mine'}:${d.path}`}><p>{d.definition}</p><a className="small" href={d.drawer ? hrefFor({ name: 'sharing', drawer: d.drawer, note: d.path }) : hrefFor({ name: 'brain', path: d.path })}>{d.by ? `${w('Partagée par', 'Shared by')} ${d.by}` : w('Dans mon cerveau', 'In my brain')}</a></dd>)}</div>)}</dl> : <Empty title={w('Aucun terme ici pour le moment', 'No terms here yet')}>{w('Les fiches de concept apparaissent après réception des tiroirs.', 'Concept cards appear after receiving drawers.')}</Empty>}
  </div></section>;
}

export function SharedReader({ drawer, path, setTitle }: { drawer: string; path: string; setTitle?: (s: string) => void }) {
  const w = useShareWords();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['shared', 'note', drawer, path], queryFn: () => get<SharedNote>('/api/shared/note', { drawer, path }) });
  const article = useRef<HTMLElement>(null);
  const keep = useMutation({ mutationFn: () => post<{ proposal: string }>('/api/shared/keep', { drawer, path }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['proposals'] }); void qc.invalidateQueries({ queryKey: ['status'] }); } });
  useEffect(() => { if (q.data) setTitle?.(q.data.title); }, [q.data, setTitle]);
  useLayoutEffect(() => {
    const el = article.current;
    if (!el || !q.data) return;
    normalizeNoteHeadings(el);
    wireLinks(el);
    // A link in a colleague's text stays in their drawer even when ours has the same path.
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href^="#/note/"]')) {
      try { a.href = hrefFor({ name: 'sharing', drawer, note: decodeURIComponent(a.getAttribute('href')!.slice('#/note/'.length).split('#')[0]!) }); } catch { a.removeAttribute('href'); }
    }
  }, [q.data, drawer]);
  if (q.isLoading) return <SkeletonRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const n = q.data;
  return <div className="stack lg"><span><a className="btn ghost sm" href={hrefFor({ name: 'sharing' })}><ArrowLeft size={15} aria-hidden="true" />{w('Retour au partage', 'Back to sharing')}</a></span>
    <section className="panel"><div className="panel-body stack"><p className="pill"><Users size={14} aria-hidden="true" />{w('Partagée par', 'Shared by')} {n.by}</p><h1>{n.title}</h1>{n.description ? <p className="muted">{n.description}</p> : null}<p className="small muted">{w('Cette note reste dans le tiroir de ton collègue. Pour l’ajouter à ton cerveau, relis la proposition.', 'This note stays in your colleague’s drawer. To add it to your brain, review the proposal.')}</p>
      <article ref={article} className="prose" dangerouslySetInnerHTML={{ __html: n.html }} />
      {keep.error ? <ErrorState error={keep.error} /> : null}
      {keep.data ? <div className="notice ok" role="status"><div><p>{w('Proposition prête. Rien n’a encore été ajouté à ton cerveau.', 'Proposal ready. Nothing has been added to your brain yet.')}</p><a className="btn sm" href={hrefFor({ name: 'inbox', tab: 'proposals', id: keep.data.proposal })}>{w('Relire la proposition', 'Review the proposal')}</a></div></div> : <span><button type="button" className="btn primary" disabled={keep.isPending} aria-busy={keep.isPending} onClick={() => keep.mutate()}>{w('Garder dans mon cerveau', 'Keep in my brain')}</button></span>}
    </div></section></div>;
}

export default function Sharing({ route = { name: 'sharing' }, setTitle }: { route?: SharingRoute; setTitle?: (s: string) => void }) {
  const w = useShareWords();
  const refresh = useRefreshSharing();
  const baggage = currentSession()?.kbs.find((k) => k.id === currentKb())?.space === 'baggage';
  const q = useQuery({ queryKey: ['share'], queryFn: () => get<ShareStatus>('/api/share'), enabled: !baggage });
  const [configuring, setConfiguring] = useState(false);
  if (baggage) return <div className="page"><section className="panel"><Empty icon={<Lock size={24} />} title={w('Mon bagage reste personnel', 'My baggage stays personal')}>{w('Pour partager avec tes collègues, ouvre ton espace de travail.', 'To share with colleagues, open your work space.')}</Empty></section></div>;
  if (q.isLoading) return <div className="page"><SkeletonRows /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (route.drawer && route.note) return <div className="page narrow"><SharedReader key={`${route.drawer}:${route.note}`} drawer={route.drawer} path={route.note} setTitle={setTitle} /></div>;
  const status = q.data;
  const tab = route.tab ?? 'drawers';
  const tabs = [{ id: 'drawers', title: w('Dépôt commun', 'Shared repository'), icon: FolderGit2 }, { id: 'map', title: w('Nos cerveaux', 'Our brains'), icon: Network }, { id: 'glossary', title: w('Glossaire commun', 'Common glossary'), icon: BookOpen }, { id: 'packs', title: w('Packs ponctuels', 'One-off packs'), icon: Package }] as const;
  return <div className="page sharing"><p className="page-intro">{w('Ce que je sais peut aider mon collègue, et inversement. Je choisis ce qui part, je relis, puis j’envoie.', 'What I know can help my colleague, and vice versa. I choose what leaves, review it, then send.')}</p>
    <nav className="segmented" aria-label={w('Pages du partage', 'Sharing pages')}>{tabs.map((item) => <a key={item.id} href={hrefFor({ name: 'sharing', ...(item.id === 'drawers' ? {} : { tab: item.id }) })} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={15} aria-hidden="true" />{item.title}</a>)}</nav>
    {tab === 'packs' ? <Packs /> : !status.ready || configuring ? <Setup status={status.ready ? status : undefined} onDone={() => { setConfiguring(false); refresh(); }} /> : <>
      <section className="panel"><div className="panel-body share-location"><FolderGit2 size={18} aria-hidden="true" /><div className="grow"><p className="strong path">{status.folder} / {status.drawer}</p><p className="meta">{status.remote ?? w('Dossier local sans dépôt distant', 'Local folder without a remote repository')} · {w('Emplacement confirmé le', 'Location confirmed on')} {new Date(status.allowedAt).toLocaleDateString()}</p></div><button type="button" className="btn sm ghost" onClick={() => setConfiguring(true)}>{w('Changer', 'Change')}</button></div></section>
      {tab === 'map' ? <Maps /> : tab === 'glossary' ? <Glossary /> : <Drawers status={status} path={route.path} />}
    </>}
  </div>;
}
