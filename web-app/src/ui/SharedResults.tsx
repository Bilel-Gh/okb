import { Users } from 'lucide-react';
import { hrefFor } from '../app/router';
import { useShareWords, type SharedHit, type SharedIssue } from '../app/sharing';

export function SharedUnavailable({ issue }: { issue: SharedIssue }) {
  const w = useShareWords();
  return <p className="notice warn small" role="status"><span>{w('La recherche des notes partagées est indisponible.', 'Shared-note search is unavailable')} {issue.message} <a className="link" href={hrefFor({ name: 'sharing' })}>{w('Vérifier le dépôt commun', 'Check the shared repository')}</a></span></p>;
}

/** A drawer remains distinct from personal notes, even for the same title or path. */
export function SharedResults({ hits }: { hits: readonly SharedHit[] }) {
  const w = useShareWords();
  if (!hits.length) return null;
  return <section className="shared-results" aria-label={w('Notes de mes collègues', 'My colleagues’ notes')}>
    <h3 className="small row"><Users size={15} aria-hidden="true" />{w('Notes de mes collègues', 'My colleagues’ notes')}</h3>
    <ul className="rows">{hits.map((h) => <li key={`${h.drawer}:${h.path}`}><div className="grow"><a className="title" href={hrefFor({ name: 'sharing', drawer: h.drawer, note: h.path })}>{h.title}</a><span className="meta">{w('Partagée par', 'Shared by')} {h.by}</span>{h.snippet ? <p className="small muted">{h.snippet}</p> : null}</div></li>)}</ul>
  </section>;
}
