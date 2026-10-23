import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, GitCompare, Hourglass, Sparkles, Users, X } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { toast } from '../app/toast';

type Value = { value: string; origin: string; url: string | null; at: string; manual: boolean };
type Team = {
  kind: 'repo' | 'product'; subject: string; registered?: boolean; value: Value | null; inherited: { product: string; value: Value } | null; notApplicable: string | null;
  conflicts: { value: string; origin: string; url: string | null; at: string }[]; suggestion: { value: string; origin: string; file: string; line: number } | null;
  request: { id: string; createdAt: string } | null;
};

const words = {
  fr: { section: 'Qui est responsable', label: 'Équipe responsable', slot: 'Équipe · Renseigner', ask: 'Demander à l’agent', save: 'Enregistrer', cancel: 'Annuler', change: 'Changer', ownForRepo: 'Changer pour ce repo', fromProduct: (p: string) => `(du produit ${p})`, says: (o: string, v: string) => `${o} dit : ${v}`, keepMine: 'Garder la mienne', takeIt: 'Prendre celle-ci', use: (v: string) => `Utiliser ${v}`, dismiss: (v: string) => `Écarter ${v}`, cites: 'CODEOWNERS cite', onlyHint: 'Seulement une suggestion : qui relit le code n’est pas toujours l’équipe responsable.', asked: (d: string) => `Équipe · demandée à l’agent le ${d}`, paste: 'Ton agent la verra au début de sa prochaine session. Ou colle ceci dans une session ouverte :', copy: 'Copier', copied: 'Copié', cancelAsk: 'Annuler la demande', na: (r: string) => `Non applicable : ${r}`, productTeam: (p: string) => `Équipe du produit ${p}`, you: 'toi' },
  en: { section: 'Who is responsible', label: 'Team responsible', slot: 'Team · Fill in', ask: 'Ask the agent', save: 'Save', cancel: 'Cancel', change: 'Change', ownForRepo: 'Change for this repository', fromProduct: (p: string) => `(from product ${p})`, says: (o: string, v: string) => `${o} says: ${v}`, keepMine: 'Keep mine', takeIt: 'Take this one', use: (v: string) => `Use ${v}`, dismiss: (v: string) => `Dismiss ${v}`, cites: 'CODEOWNERS names', onlyHint: 'Only a suggestion: who reviews the code is not always the team responsible.', asked: (d: string) => `Team · asked to the agent on ${d}`, paste: 'Your agent will see it at the start of its next session. Or paste this in an open session:', copy: 'Copy', copied: 'Copied', cancelAsk: 'Cancel the request', na: (r: string) => `Not applicable: ${r}`, productTeam: (p: string) => `Team of product ${p}`, you: 'you' },
};
const ORIGIN: Record<string, string> = { person: '', agent: 'Agent', jira: 'Jira', servicenow: 'ServiceNow', wiki: 'Wiki', github: 'GitHub', other: '' };

/** One subject's team: its value and origin, or a discreet slot; conflicts, suggestion and the open request (F2.4-19, F2.4-20). */
export function TeamLine({ kind, subject, label }: { kind: 'repo' | 'product'; subject: string; label?: string }) {
  const t = useT();
  const w = words[t.lang];
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['team', kind, subject], queryFn: () => get<Team>('/api/team', { kind, subject }) });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const team = q.data;
  const prompt = useQuery({ queryKey: ['team', 'prompt', team?.request?.id ?? ''], enabled: Boolean(team?.request), queryFn: () => get<{ prompt: string }>('/api/team/prompt', { id: team!.request!.id, lang: t.lang }) });
  if (!team || !Array.isArray(team.conflicts) || team.registered === false) return null;
  const act = async (path: string, body: Record<string, unknown>) => {
    try { await post(path, { kind, subject, ...body }); } catch (e) { toast((e as Error).message, 'err'); }
    await qc.invalidateQueries({ queryKey: ['team'] });
  };
  const origin = (v: { origin: string; at: string }) => `${ORIGIN[v.origin] || (v.origin === 'person' ? w.you : v.origin)} · ${v.at.slice(0, 10)}`;
  const editor = (
    <form className="team-edit row" onSubmit={(e) => { e.preventDefault(); if (value.trim()) void act('/api/team', { value }).then(() => setEditing(false)); }}>
      <label className="sr-only" htmlFor={`team-${kind}-${subject}`}>{w.label}</label>
      <input id={`team-${kind}-${subject}`} className="input" value={value} maxLength={120} autoFocus onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="btn sm primary" disabled={!value.trim()}>{w.save}</button>
      <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>{w.cancel}</button>
    </form>
  );
  return (
    <div className="team-line stack">
      <div className="row wrap">
        {label ? <span className="small muted">{label}</span> : null}
        {editing ? editor : team.value ? (
          <>
            <span className="team-pill"><Users size={14} aria-hidden="true" /><span>{team.value.value}</span><span className="xs muted">{origin(team.value)}</span></span>
            {team.value.url ? <a className="link small" href={team.value.url} target="_blank" rel="noreferrer">{ORIGIN[team.value.origin] || team.value.url}</a> : null}
            <button type="button" className="btn sm ghost" onClick={() => { setValue(team.value!.value); setEditing(true); }}>{w.change}</button>
          </>
        ) : team.notApplicable ? <span className="small muted">{w.na(team.notApplicable)}</span> : team.request ? (
          <span className="team-slot asked"><Hourglass size={14} aria-hidden="true" />{w.asked(team.request.createdAt.slice(0, 10))}</span>
        ) : team.inherited ? (
          <>
            <span className="team-pill inherit"><Users size={14} aria-hidden="true" /><span>{team.inherited.value.value}</span><span className="xs muted">{w.fromProduct(team.inherited.product)}</span></span>
            <button type="button" className="btn sm ghost" onClick={() => { setValue(''); setEditing(true); }}>{w.ownForRepo}</button>
          </>
        ) : (
          <>
            <button type="button" className="team-slot" onClick={() => { setValue(''); setEditing(true); }}><Users size={14} aria-hidden="true" />{w.slot}</button>
            <button type="button" className="btn sm ghost icon" aria-label={w.ask} title={w.ask} onClick={() => void act('/api/team/ask', {})}><Sparkles size={14} aria-hidden="true" /></button>
          </>
        )}
      </div>
      {team.conflicts.map((c) => (
        <div key={c.origin} className="team-conflict small" role="group">
          <strong><GitCompare size={14} aria-hidden="true" /> {w.says(ORIGIN[c.origin] || c.origin, c.value)}</strong>
          <div className="row wrap">
            <button type="button" className="btn sm" onClick={() => void act('/api/team/conflict', { keep: 'mine' })}>{w.keepMine}</button>
            <button type="button" className="btn sm" onClick={() => void act('/api/team/conflict', { keep: c.origin })}>{w.takeIt} · {c.value}</button>
          </div>
        </div>
      ))}
      {team.suggestion && !team.value ? (
        <div className="team-sugg small">
          <span className="grow">{w.cites} <strong>{team.suggestion.value}</strong> <span className="xs muted">· {w.onlyHint}</span></span>
          <button type="button" className="btn sm" aria-label={w.use(team.suggestion.value)} onClick={() => void act('/api/team', { value: team.suggestion!.value, origin: 'github' })}>{w.use('').trim()}</button>
          <button type="button" className="btn sm ghost icon" aria-label={w.dismiss(team.suggestion.value)} onClick={() => void act('/api/team/dismiss', { value: team.suggestion!.value })}><X size={14} aria-hidden="true" /></button>
        </div>
      ) : null}
      {team.request && prompt.data ? (
        <div className="team-ask small stack">
          <span className="muted">{w.paste}</span>
          <pre className="team-prompt">{prompt.data.prompt}</pre>
          <div className="row wrap">
            <button type="button" className="btn sm" onClick={() => { void navigator.clipboard?.writeText(prompt.data!.prompt).then(() => toast(w.copied), () => undefined); }}><Copy size={14} aria-hidden="true" />{w.copy}</button>
            <button type="button" className="btn sm ghost" onClick={() => void act('/api/team/ask/cancel', { id: team.request!.id })}>{w.cancelAsk}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** On a repository's page: its team, and its product's (the default of its repositories). */
export function RepoTeam({ repo, product }: { repo: string; product: string | null }) {
  const t = useT();
  const w = words[t.lang];
  return (
    <section className="panel repo-team" aria-label={w.section}>
      <div className="panel-body stack">
        <TeamLine kind="repo" subject={repo} />
        {product ? <TeamLine kind="product" subject={product} label={w.productTeam(product)} /> : null}
      </div>
    </section>
  );
}
