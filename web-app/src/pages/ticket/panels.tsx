import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, GitCompareArrows, Hourglass, Link as LinkIcon, Pencil, Pin, PinOff, Plus, Sparkles, Trash2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { get } from '../../app/api';
import { useT } from '../../app/i18n';
import { hrefFor } from '../../app/router';
import { useShareWords } from '../../app/sharing';
import { ORIGIN_WORDS, RUBRIC_WORDS, STATE_WORDS, type FieldName, type Origin, type Importance, type SheetAction, type TicketSheet } from '../../app/tickets';
import { toast } from '../../app/toast';
import { AgentMarks, Editable, FieldLine, ImportanceBars, Prov, removeTodo, Slot, useSheetWrite } from './parts';

const LIMIT: Record<FieldName, number> = { title: 200, summary: 600, description: 8000, sourceStatus: 80, team: 120, product: 120, done: 1000, blocker: 600 };

/** Ask the agent (F2.4-10): one open request per ticket, and the prompt copied to paste now. */
export function useAsk(ref: string) {
  const write = useSheetWrite(ref); const w = useShareWords(); const { lang } = useT();
  return async (fields: string[]) => {
    const req = await write.mutateAsync({ path: '/api/ticket/requests', body: { fields } }) as { id: string };
    const { prompt } = await get<{ prompt: string }>('/api/ticket/requests/prompt', { id: req.id, lang: lang === 'en' ? 'en' : 'fr' });
    await navigator.clipboard?.writeText(prompt).catch(() => undefined);
    toast(w('Demande enregistrée : l’agent la traitera à ta prochaine session. Le prompt est copié.', 'Request saved: the agent handles it at your next session. The prompt is copied.'));
  };
}

function setFieldOf(write: ReturnType<typeof useSheetWrite>, field: FieldName) {
  return (value: string) => write.mutateAsync({ path: '/api/ticket/field', body: { field, value } });
}

export function Brief30({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const ask = useAsk(sheet.ref);
  const [more, setMore] = useState(false);
  const f = sheet.fields;
  const summaryStrong = (v: string) => { const i = v.search(/(Objectif|Goal)\s*:/i); return i > 0 ? <>{v.slice(0, i)}<span className="tk-strong">{v.slice(i)}</span></> : v; };
  return <section className="tk-card" aria-labelledby="tk-brief-h">
    <div className="tk-card-h"><h2 id="tk-brief-h">{w('En 30 secondes', 'In 30 seconds')}</h2><span className="aside">{w('Clique sur un texte pour le modifier', 'Click a text to edit it')}</span></div>
    <div className="tk-card-b tk-brief">
      <div className="tk-q"><span className="k">{w('Le problème', 'The problem')}</span><div className="v">
        <FieldLine field="summary" label={w('Le problème', 'The problem')} value={f.summary} maxLength={LIMIT.summary} multiline onSave={setFieldOf(write, 'summary')} onAsk={() => void ask(['summary'])} strong={summaryStrong} />
        {f.description ? <>{more ? <FieldLine field="description" label="Description" value={f.description} maxLength={LIMIT.description} multiline onSave={setFieldOf(write, 'description')} /> : null}<button type="button" className="tk-link-btn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? w('Replier la description', 'Fold the description') : w('Description complète', 'Full description')}<ChevronDown size={14} aria-hidden="true" /></button></> : null}
      </div></div>
      <div className="tk-q"><span className="k">{w('Déjà fait', 'Already done')}</span><div className="v"><FieldLine field="done" label={w('Déjà fait', 'Already done')} value={f.done} maxLength={LIMIT.done} multiline onSave={setFieldOf(write, 'done')} onAsk={() => void ask(['done'])} /></div></div>
      <div className="tk-q"><span className="k">{w('Ce qui reste', 'What remains')}</span><div className={`v${sheet.next ? ' todo' : ''}`}>{sheet.next ? <>{sheet.next.text}<span className="tk-prov">{w('d’après tes todos', 'from your todos')}</span></> : <span className="meta">{w('Pas encore de prochaine étape : ajoute une todo ci-dessous.', 'No next step yet: add a todo below.')}</span>}</div></div>
      <div className="tk-q"><span className="k">{w('Ce qui bloque', 'What blocks')}</span><div className={`v${f.blocker && !/^(aucun|none|no|pas de)\b/i.test(f.blocker.value) ? ' block' : ''}`}>
        {f.blocker ? <FieldLine field="blocker" label={w('Ce qui bloque', 'What blocks')} value={f.blocker} maxLength={LIMIT.blocker} onSave={setFieldOf(write, 'blocker')} />
          : <span className="tk-slot-row"><FieldLine field="blocker" label={w('Ce qui bloque', 'What blocks')} value={undefined} maxLength={LIMIT.blocker} onSave={setFieldOf(write, 'blocker')} onAsk={() => void ask(['blocker'])} /><button type="button" className="tk-link-btn quiet" onClick={() => void setFieldOf(write, 'blocker')(w('Aucun blocage', 'No blocker'))}>{w('Aucun blocage', 'No blocker')}</button></span>}
      </div></div>
    </div>
  </section>;
}

function TodoRow({ todo, refId }: { todo: SheetAction; refId: string }) {
  const w = useShareWords(); const write = useSheetWrite(refId); const [editing, setEditing] = useState(false);
  const qc = useQueryClient(); const refresh = () => { void qc.invalidateQueries(); };
  const update = (body: Record<string, unknown>) => write.mutate({ path: '/api/action/update', body: { id: todo.id, ...body } });
  const done = todo.status !== 'open';
  return <li className={done ? 'done' : ''}>
    <input type="checkbox" checked={done} onChange={() => update({ status: done ? 'open' : 'done' })} aria-label={done ? `${w('Rouvrir', 'Reopen')} : ${todo.text}` : `${w('Terminer', 'Finish')} : ${todo.text}`} />
    <ImportanceBars value={todo.importance} {...(done ? {} : { onChange: (v: Importance) => update({ importance: v }) })} />
    <div>{editing ? <Editable value={todo.text} label={w('Texte de la todo', 'Todo text')} maxLength={300} startOpen onClose={() => setEditing(false)} onSave={(text) => { update({ text }); }} /> : <><div className="t">{todo.text}</div><div className="c">{done ? `${w('faite', 'done')} · ${new Date(todo.doneAt ?? todo.createdAt).toLocaleDateString()}` : `${todo.source === 'ai' ? '' : `${w('ajoutée par toi', 'added by you')} · `}${new Date(todo.createdAt).toLocaleDateString()}`}<AgentMarks todo={todo} /></div></>}</div>
    <div className="tk-tools">
      {done ? null : <button type="button" className="tk-ib" onClick={() => update({ pinned: !todo.pinned })} aria-label={todo.pinned ? w('Désépingler', 'Unpin') : w('Épingler comme prochaine étape', 'Pin as next step')}>{todo.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}</button>}
      {done ? null : <button type="button" className="tk-ib" onClick={() => setEditing(true)} aria-label={`${w('Modifier', 'Edit')} : ${todo.text}`}><Pencil size={16} aria-hidden="true" /></button>}
      <button type="button" className="tk-ib" onClick={() => void removeTodo(todo, w, refresh)} aria-label={`${w('Supprimer', 'Delete')} : ${todo.text}`}><Trash2 size={16} aria-hidden="true" /></button>
    </div>
  </li>;
}

/** The next step is the first open todo (D70): finishing it lets the next one rise. */
export function Todos({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const [text, setText] = useState('');
  const open = sheet.todos.filter((t) => t.status === 'open' && t.id !== sheet.next?.id);
  const done = sheet.todos.filter((t) => t.status === 'done').slice(0, 3);
  const add = () => {
    const raw = text.trim(); if (!raw) return;
    const high = raw.startsWith('!');
    write.mutate({ path: '/api/actions', body: { text: high ? raw.slice(1).trim() : raw, workRef: sheet.ref, importance: high ? 'high' : 'medium' } }, { onSuccess: () => setText('') });
  };
  const count = sheet.todos.filter((t) => t.status === 'open').length;
  return <section className="tk-card" aria-labelledby="tk-todo-h">
    <div className="tk-card-h"><h2 id="tk-todo-h">{w('À faire', 'To do')}</h2><span className="aside">{count} {w(count > 1 ? 'ouvertes' : 'ouverte', 'open')}</span></div>
    {sheet.next ? <div className="tk-next"><button type="button" className="chk" onClick={() => write.mutate({ path: '/api/action/update', body: { id: sheet.next!.id, status: 'done' } })} aria-label={`${w('Terminer la prochaine étape', 'Finish the next step')} : ${sheet.next.text}`} /><div className="grow"><small>{w('Prochaine étape', 'Next step')}</small><span className="txt">{sheet.next.text}</span></div><ImportanceBars value={sheet.next.importance} onChange={(v) => write.mutate({ path: '/api/action/update', body: { id: sheet.next!.id, importance: v } })} />{sheet.next.pinned ? <Pin size={16} aria-label={w('épinglée', 'pinned')} style={{ color: 'var(--accent-text)' }} /> : null}</div>
      : <p className="meta" style={{ margin: '4px 18px 8px' }}>{w('Pas encore de prochaine étape : ajoute une todo, la plus importante deviendra la prochaine étape.', 'No next step yet: add a todo, the most important one becomes the next step.')}</p>}
    {open.length || done.length ? <ul className="tk-todos">{[...open, ...done].map((t) => <TodoRow key={t.id} todo={t} refId={sheet.ref} />)}</ul> : null}
    <form className="tk-add" onSubmit={(e) => { e.preventDefault(); add(); }}><Plus size={16} aria-hidden="true" className="muted" /><input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={w('Ajouter une chose à faire, ou ! devant pour importance haute', 'Add something to do, or ! first for high importance')} aria-label={w('Ajouter une todo à ce ticket', 'Add a todo to this ticket')} /><kbd aria-hidden="true">↵</kbd></form>
  </section>;
}

export function LinkedNotes({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const [linking, setLinking] = useState(false); const [path, setPath] = useState('');
  const confirmed = sheet.links.filter((l) => l.state === 'confirmed');
  const suggested = sheet.links.filter((l) => l.state === 'suggested');
  const set = (p: string, state: 'confirmed' | 'dismissed') => write.mutate({ path: '/api/ticket/links', body: { path: p, state } });
  const why = { metadata: w('déclarée dans la note', 'declared in the note'), folder: w('rangée sous le ticket', 'filed under the ticket'), manual: w('liée à la main', 'linked by hand'), mention: w('cite la référence', 'mentions the reference') } as const;
  return <section className="tk-card" aria-labelledby="tk-notes-h">
    <div className="tk-card-h"><h2 id="tk-notes-h">{w('Notes liées', 'Linked notes')}</h2><button type="button" className="btn sm ghost" style={{ marginLeft: 'auto' }} aria-expanded={linking} onClick={() => setLinking(!linking)}><LinkIcon size={16} aria-hidden="true" />{w('Lier une note', 'Link a note')}</button></div>
    {linking ? <form className="tk-add" onSubmit={(e) => { e.preventDefault(); if (path.trim()) set(path.trim(), 'confirmed'); setPath(''); setLinking(false); }}><input value={path} onChange={(e) => setPath(e.target.value)} placeholder={w('Chemin de la note, par exemple methodo/cas-remises.md', 'Note path, for example methodo/case.md')} aria-label={w('Chemin de la note à lier', 'Path of the note to link')} /><button className="btn sm" type="submit">{w('Lier', 'Link')}</button></form> : null}
    {confirmed.length ? <ul className="tk-notes">{confirmed.map((l) => <li key={l.path}><span className="mark" aria-hidden="true" /><div className="grow">{l.missing ? <span className="nt muted">{l.path}</span> : <a className="nt" href={hrefFor({ name: 'brain', path: l.path })}>{l.title ?? l.path}</a>}<div className="nm">{l.missing ? w('note introuvable : déplacée ou supprimée', 'note not found: moved or deleted') : why[l.why]}</div></div><button type="button" className="tk-ib" onClick={() => set(l.path, 'dismissed')} aria-label={`${w('Délier', 'Unlink')} : ${l.title ?? l.path}`}><Unlink size={16} aria-hidden="true" /></button></li>)}</ul>
      : <p className="meta" style={{ margin: '4px 18px 0' }}>{w('Aucune note liée. Quand l’agent écrit une note sur ce ticket, elle arrive ici après ton oui.', 'No linked note. When the agent writes a note on this ticket, it lands here after your yes.')}</p>}
    {suggested.map((l) => <div className="tk-tray" key={l.path}><Sparkles size={16} aria-hidden="true" style={{ color: 'var(--accent-text)' }} /><div className="grow"><span className="t14">{l.title ?? l.path}</span><br /><span className="meta">{w('Suggérée : ', 'Suggested: ')}{why.mention}</span></div><button type="button" className="tk-link-btn" onClick={() => set(l.path, 'confirmed')}>{w('Lier', 'Link')}</button><button type="button" className="tk-link-btn quiet" onClick={() => set(l.path, 'dismissed')}>{w('Écarter', 'Dismiss')}</button></div>)}
    <div style={{ height: 14 }} />
  </section>;
}

/** The criteria live in « More details » below: open it and bring it into view. */
function openMore(): void { const more = document.getElementById('tk-more'); more?.setAttribute('open', ''); more?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function Prop({ k, children }: { k: string; children: React.ReactNode }) { return <div className="tk-prop"><span className="k">{k}</span><span className="v">{children}</span></div>; }

export function Details({ sheet, declare }: { sheet: TicketSheet; declare: (dimension: string) => void }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const ask = useAsk(sheet.ref);
  const f = sheet.fields;
  const line = (field: FieldName, label: string) => <FieldLine field={field} label={label} value={f[field]} maxLength={LIMIT[field]} onSave={setFieldOf(write, field)} onAsk={() => void ask([field])} />;
  const pr = sheet.states.find((s) => s.dimension === 'pr');
  const criteria = sheet.criteria.filter((c) => c.text !== c.kind);
  return <section className="tk-card" aria-labelledby="tk-details-h">
    <div className="tk-card-h"><h2 id="tk-details-h">{w('Détails', 'Details')}</h2></div>
    <div className="tk-card-b tk-props">
      <Prop k={w('Statut source', 'Source status')}>{line('sourceStatus', w('Statut source', 'Source status'))}</Prop>
      {sheet.conflicts.map((c) => <div className="tk-conflict" key={`${c.field}:${c.origin}`} role="group" aria-label={w('Écart à arbitrer', 'Conflict to settle')}>
        <div className="h"><GitCompareArrows size={14} aria-hidden="true" />{w(...ORIGIN_WORDS[c.origin])} {w('dit autre chose', 'says otherwise')} · {w(...(RUBRIC_WORDS[c.field] ?? [c.field, c.field]))}</div>
        <div className="tk-choice"><button type="button" onClick={() => write.mutate({ path: '/api/ticket/conflict', body: { field: c.field, keep: 'mine' } })}><span>{f[c.field]?.value}</span><small>{w('garder la mienne', 'keep mine')}</small></button><button type="button" onClick={() => write.mutate({ path: '/api/ticket/conflict', body: { field: c.field, keep: c.origin } })}><span>{c.value}</span><small>{w('prendre celle de ', 'take ')}{w(...ORIGIN_WORDS[c.origin])} · {new Date(c.at).toLocaleDateString()}</small></button></div>
      </div>)}
      <Prop k={w('Équipe', 'Team')}>{line('team', w('Équipe', 'Team'))}</Prop>
      <Prop k={w('Produit', 'Product')}>{line('product', w('Produit', 'Product'))}</Prop>
      <div className="tk-sep" />
      <Prop k={w('Repos', 'Repositories')}>{sheet.repos.map((r) => <span key={r.id} className="tk-slot-row"><a className="link" href={hrefFor({ name: 'repos', id: r.id })}>{r.id}</a>{sheet.repos.length > 1 ? <button type="button" className="tk-ib" onClick={() => write.mutate({ path: '/api/ticket/repos/detach', body: { repo: r.id } })} aria-label={`${w('Retirer le repo', 'Remove repository')} ${r.id}`}><Trash2 size={14} aria-hidden="true" /></button> : null}</span>)}</Prop>
      {sheet.repos.some((r) => r.branch) ? <Prop k={w('Branche', 'Branch')}><code>{sheet.repos.find((r) => r.branch)!.branch}</code></Prop> : null}
      <Prop k="PR">{pr && pr.status !== 'unknown' ? <>{w(...(STATE_WORDS[pr.status] ?? [pr.status, pr.status]))}{pr.url ? <a className="tk-prov" href={pr.url} target="_blank" rel="noreferrer">{w('ouvrir', 'open')}</a> : null}</> : <Slot label={w('Déclarer la PR', 'Declare the PR')} onAdd={() => declare('pr')} />}</Prop>
      <Prop k={w('Critères', 'Criteria')}>{criteria.length ? <button type="button" className="tk-link-btn" onClick={openMore}>{criteria.length} {w(criteria.length > 1 ? 'critères' : 'critère', criteria.length > 1 ? 'criteria' : 'criterion')}</button> : sheet.notApplicable.criteria ? <span className="meta">{w('non applicable', 'not applicable')} · {sheet.notApplicable.criteria}</span> : <Slot label={w('Ajouter', 'Add')} onAdd={openMore} onAsk={() => void ask(['criteria'])} />}</Prop>
    </div>
  </section>;
}

export function Pending({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const write = useSheetWrite(sheet.ref); const { lang } = useT();
  if (!sheet.requests.length) return null;
  const words = (fields: string[]) => fields.map((f) => w(...({ title: ['titre', 'title'], summary: ['résumé', 'summary'], description: ['description', 'description'], criteria: ['critères', 'criteria'], sourceStatus: ['statut source', 'source status'], team: ['équipe', 'team'], product: ['produit', 'product'], done: ['ce qui est fait', 'what is done'], blocker: ['blocage', 'blocker'] } as Record<string, [string, string]>)[f] ?? [f, f])).join(', ');
  const copy = async (id: string) => { const { prompt } = await get<{ prompt: string }>('/api/ticket/requests/prompt', { id, lang: lang === 'en' ? 'en' : 'fr' }); await navigator.clipboard?.writeText(prompt).catch(() => undefined); toast(w('Prompt copié.', 'Prompt copied.')); };
  return <>{sheet.requests.map((r) => <div className="tk-pending" key={r.id} role="status"><Hourglass size={16} aria-hidden="true" /><div className="grow"><b style={{ color: 'var(--ink)' }}>{w('Demande à l’agent en attente', 'Request to the agent pending')}</b><br />{words(r.fields)} · {w('traitée à ta prochaine session', 'handled at your next session')}<br /><button type="button" className="tk-link-btn" onClick={() => void copy(r.id)}>{w('Copier le prompt', 'Copy the prompt')}</button><button type="button" className="tk-link-btn quiet" onClick={() => write.mutate({ path: '/api/ticket/requests/cancel', body: { id: r.id } })}>{w('Annuler', 'Cancel')}</button></div></div>)}</>;
}

export function History({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const [all, setAll] = useState(false);
  const shown = all ? sheet.history : sheet.history.slice(0, 6);
  // A field change reads « Équipe : A → B » with its origin, never the stored field name (D70).
  const head = (text: string) => {
    const f = text.match(/^(\w+) : (.*?)(?: \((\w+)(?:, [^)]*)?\))?$/s);
    if (f && RUBRIC_WORDS[f[1]!]) return <><b>{w(...RUBRIC_WORDS[f[1]!]!)}</b> : {f[2]}{f[3] && ORIGIN_WORDS[f[3] as Origin] ? <span className="tk-prov"><span className={`d ${f[3]}`} />{w(...ORIGIN_WORDS[f[3] as Origin])}</span> : null}</>;
    const m = text.match(/^([^:]{1,30}) : (.*)$/s); return m ? <><b>{m[1]}</b> : {m[2]}</> : text;
  };
  const kind = (k: string) => ({ decision: w('Décision', 'Decision'), trap: w('Piège', 'Trap'), question: w('Question', 'Question'), commit: 'Commit', start: w('Suivi commencé', 'Follow-up started'), done: w('Travail terminé', 'Work done'), reopen: w('Rouvert', 'Reopened'), repo: 'Repo' } as Record<string, string>)[k];
  return <section className="tk-card" aria-labelledby="tk-hist-h">
    <div className="tk-card-h"><h2 id="tk-hist-h">{w('Historique', 'History')}</h2>{sheet.history.length > 6 ? <button type="button" className="tk-link-btn" style={{ marginLeft: 'auto' }} onClick={() => setAll(!all)}>{all ? w('Moins', 'Less') : w('Tout voir', 'See all')}</button> : null}</div>
    <div className="tk-card-b"><ul className="tk-tl">{shown.map((h, i) => <li key={`${h.at}${i}`}><span className={`p ${h.kind}`} aria-hidden="true" /><div><div className="x">{kind(h.kind) ? <><b>{kind(h.kind)}</b>{h.text ? ` : ${h.text}` : ''}</> : head(h.text)}</div><div className="w">{new Date(h.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></li>)}</ul></div>
  </section>;
}

