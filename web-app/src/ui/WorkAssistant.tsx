import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import '../styles/work.css';

/** Preparing a question never starts an agent. The selected work is resolved in the current space. */
export function WorkAssistant({ project, kind, refId, title }: { project?: string; kind?: string; refId?: string; title: string }) {
  const w = useShareWords();
  const context = project ? { project } : kind && refId ? { workKind: kind, workRef: refId } : {};
  const actions = [
    { label: w('Où j’en étais', 'Where I left off'), prompt: w('Où j’en étais ? Donne la prochaine action et les blocages connus.', 'Where did I leave off? Give the next action and known blockers.'), mode: 'resume' as const },
    { label: w('Pourquoi cette décision ?', 'Why this decision?'), prompt: w('Pourquoi cette décision ? Retrouve les raisons et les preuves ; signale ce qui manque.', 'Why this decision? Find the reasons and evidence; identify what is missing.'), mode: 'ask' as const },
    { label: w('A-t-on déjà rencontré cette erreur ?', 'Have we seen this error before?'), prompt: w('A-t-on déjà rencontré cette erreur ? Je précise le message : ', 'Have we seen this error before? I will specify the message: '), mode: 'find' as const },
  ];
  return <nav className="work-assistant row wrap" aria-label={w('Aide pour ce travail', 'Help with this work')}>{actions.map((a) => <a className="btn sm" key={a.mode} href={hrefFor({ name: 'assistant', ...context, prompt: `${a.prompt}\n${title}`, mode: a.mode })}>{a.label}</a>)}</nav>;
}
