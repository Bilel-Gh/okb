import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { currentSession, get, post, setSession, type Session } from '../app/api';
import type { AgentStatus } from '../app/assistant';
import '../app/desktop';
import type { Translate } from '../app/i18n';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { LogoMark } from '../ui/Logo';
import { readLogo, readLook, readStyle } from '../app/theme';
import { ErrorState } from '../ui/States';
import { FirstChoice } from './Brains';

type Profile = 'dev' | 'consultant' | 'student' | 'other';
type Created = { ok: true; id: string; root: string; project: { id: string; title: string }; steps: { ok: boolean; message?: string }[] };

/** A first useful project, then an optional agent. The core works before any AI connection. */
export default function FirstRun({ t }: { t: Translate }) {
  const w = useShareWords();
  const [profile, setProfile] = useState<Profile>('other');
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [language, setLanguage] = useState<'fr' | 'en'>(t.lang);
  const [folder, setFolder] = useState('');
  const [folderError, setFolderError] = useState<unknown>(null);
  const [checkingAgent, setCheckingAgent] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const create = useMutation({ mutationFn: () => post<Created>('/api/onboarding', { profile, name: name.trim(), project: project.trim(), language, ...(folder.trim() ? { folder: folder.trim() } : {}) }), onSuccess: async (r) => { setCreated(r); try { const session = await get<Session>('/api/session', { kb: '' }); setSession(session, r.id); } catch { const session = currentSession(); if (session) setSession({ ...session, active: r.id }, r.id); } } });
  const agent = useQuery({ queryKey: ['assistant', 'status'], queryFn: () => get<AgentStatus>('/api/assistant/status'), enabled: !!created && checkingAgent, retry: false });
  const profiles: { id: Profile; label: string; hint: string; example: string }[] = [
    { id: 'dev', label: w('Développeur ou DevOps', 'Developer or DevOps'), hint: w('Reprendre mes tickets, comprendre et partager.', 'Resume tickets, understand and share.'), example: w('Livrer ma première amélioration', 'Deliver my first improvement') },
    { id: 'consultant', label: w('Consultant ou commercial', 'Consultant or sales'), hint: w('Mes projets, mes rendez-vous et mes engagements.', 'My projects, meetings and commitments.'), example: w('Préparer mon prochain rendez-vous', 'Prepare my next meeting') },
    { id: 'student', label: w('Étudiant', 'Student'), hint: w('Comprendre mes notes, réviser et préparer un examen.', 'Understand notes, review and prepare for an exam.'), example: w('Préparer mon prochain examen', 'Prepare my next exam') },
    { id: 'other', label: w('Autre', 'Other'), hint: w('Garder mes informations et avancer dans mes projets.', 'Keep information and move my projects forward.'), example: w('Organiser mon premier projet', 'Organise my first project') },
  ];
  const suggested = profiles.find((p) => p.id === profile)!;
  const open = (assistant = false) => { if (!created) return; try { localStorage.setItem('okb-kb', created.id); } catch { /* private window */ } window.location.hash = hrefFor(assistant ? { name: 'assistant' } : { name: 'projects', id: created.project.id }).slice(1); window.location.reload(); };
  const chooseFolder = async () => { setFolderError(null); try { const chosen = await window.okbDesktop?.chooseFolder(); if (chosen) setFolder(chosen); } catch (e) { setFolderError(e); } };
  return <div className="first-run"><div className="panel first-run-card"><div className="panel-body stack lg">
    <header className="row"><LogoMark logo={readLogo()} look={readLook()} style={readStyle()} size={40} /><div><h1>{w('Bienvenue dans OKB', 'Welcome to OKB')}</h1><p className="muted">{w('Vos notes et vos projets, sur votre ordinateur.', 'Your notes and projects, on your computer.')}</p></div></header>
    {created ? <div className="stack lg" aria-live="polite"><p className="notice ok"><Check size={18} aria-hidden="true" />{w('Votre premier projet est prêt.', 'Your first project is ready.')}</p><h2>{created.project.title}</h2><p className="small muted">{w('Commencez par écrire la prochaine petite étape, puis gardez une information utile dans le projet.', 'Start by writing the next small step, then keep a useful piece of information in the project.')}</p><p className="small muted">{w('Vos notes sont dans', 'Your notes are in')} <code>{created.root}</code></p><button type="button" className="btn primary" onClick={() => open()}>{w('Continuer sans IA', 'Continue without AI')}<ArrowRight size={15} aria-hidden="true" /></button><section className="stack onboarding-agent"><h3>{w('L’assistant, si vous en voulez un', 'The assistant, if you want one')}</h3><p className="small muted">{w('OKB peut utiliser Claude Code déjà installé, avec votre abonnement ou le proxy de votre entreprise. Vous pouvez l’ajouter plus tard ; aucun compte IA n’est nécessaire pour commencer.', 'OKB can use an existing Claude Code installation with your subscription or company proxy. Add it later; no AI account is needed to begin.')}</p><span><button type="button" className="btn sm" disabled={agent.isFetching} onClick={() => { setCheckingAgent(true); if (checkingAgent) void agent.refetch(); }}>{w('Vérifier mon agent', 'Check my agent')}</button></span>{agent.error ? <ErrorState error={agent.error} /> : null}{agent.data ? agent.data.agents.some((a) => a.id === 'claude-code' && a.ready) ? <><p className="small">{w('Claude Code est installé. Votre agent reste avec sa configuration habituelle.', 'Claude Code is installed. Your agent keeps its usual configuration.')}</p><span><button className="btn sm" type="button" onClick={() => open(true)}>{w('Ouvrir l’assistant', 'Open the assistant')}</button></span></> : <p className="small"><a className="link" href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">{w('Installer ou connecter Claude Code', 'Install or connect Claude Code')}</a> · {w('Vous pourrez revenir ici après l’installation.', 'Come back here after installation.')}</p> : null}</section></div> : <>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (name.trim() && project.trim() && !create.isPending) create.mutate(); }}>
        <fieldset className="onboarding-profiles"><legend>{w('Pour commencer, je suis…', 'To begin, I am…')}</legend>{profiles.map((p) => <label key={p.id} className={`choice${profile === p.id ? ' on' : ''}`}><input type="radio" name="onboarding-profile" value={p.id} checked={profile === p.id} onChange={() => setProfile(p.id)} aria-label={p.label} /><span className="choice-text"><b>{p.label}</b><small>{p.hint}</small></span></label>)}</fieldset>
        <div className="field"><label htmlFor="onboarding-name">{w('Le nom de mon espace', 'My space’s name')}</label><input id="onboarding-name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={w('Mon travail, mes cours, mon atelier…', 'My work, courses, workshop…')} /></div>
        <div className="field"><label htmlFor="onboarding-project">{w('Mon premier projet', 'My first project')}</label><input id="onboarding-project" className="input" required maxLength={200} value={project} onChange={(e) => setProject(e.target.value)} placeholder={suggested.example} /><small className="muted">{w('Exemple :', 'Example:')} <button type="button" className="link onboarding-example" onClick={() => setProject(suggested.example)}>{suggested.example}</button></small></div>
        <div className="field"><label htmlFor="onboarding-language">{w('La langue de mes notes', 'My notes’ language')}</label><select id="onboarding-language" className="select" value={language} onChange={(e) => setLanguage(e.target.value as 'fr' | 'en')}><option value="fr">Français</option><option value="en">English</option></select></div>
        <details className="stack"><summary>{w('Choisir où garder mes notes', 'Choose where to keep my notes')}</summary><div className="field"><label htmlFor="onboarding-folder">{w('Dossier de mes notes', 'My notes folder')}</label><div className="row"><input id="onboarding-folder" className="input grow" maxLength={1000} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={w('Dossier proposé dans Documents/OKB', 'Suggested folder in Documents/OKB')} />{window.okbDesktop ? <button type="button" className="btn sm" onClick={() => void chooseFolder()}><FolderOpen size={14} aria-hidden="true" />{w('Choisir un dossier', 'Choose a folder')}</button> : null}</div><small className="muted">{w('Un dossier neuf ou vide. Laissez vide pour utiliser le dossier proposé.', 'A new or empty folder. Leave blank to use the suggested folder.')}</small></div>{folderError ? <ErrorState error={folderError} /> : null}</details>
        {create.error ? <ErrorState error={create.error} /> : null}<button type="submit" className="btn primary lg" disabled={!name.trim() || !project.trim() || create.isPending} aria-busy={create.isPending}>{create.isPending ? w('Création en cours…', 'Creating…') : w('Créer mon espace et mon projet', 'Create my space and project')}<ArrowRight size={15} aria-hidden="true" /></button>
      </form><details onToggle={(e) => setAdvanced(e.currentTarget.open)}><summary>{w('J’ai déjà des notes, ou je préfère le réglage détaillé', 'I already have notes, or prefer detailed setup')}</summary>{advanced ? <div className="onboarding-advanced"><FirstChoice /></div> : null}</details>
    </>}
  </div></div></div>;
}
