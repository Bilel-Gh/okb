import { Check, Coffee, FileCheck, Flag, Lightbulb, MessageCircleQuestion, NotebookPen, Users, X, type LucideIcon } from 'lucide-react';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';

/** One fact that matters since yesterday (F2.4-25). */
export type Happened = {
  kind: string; text: string; at: string;
  project: { id: string; title: string; ref: string | null; kind: string } | null;
  path?: string; review?: 'pending' | 'validated' | null;
};

const LOOK: Record<string, { icon: LucideIcon; tone: string; fr: string; en: string }> = {
  done: { icon: Check, tone: 'ok', fr: 'Fait', en: 'Done' },
  decision: { icon: Flag, tone: 'acc', fr: 'Décision', en: 'Decision' },
  filed: { icon: FileCheck, tone: 'warn', fr: 'Note rangée', en: 'Note filed' },
  tried: { icon: X, tone: '', fr: 'Essayé sans succès', en: 'Tried, did not work' },
  meeting: { icon: Users, tone: 'info', fr: 'Réunion', en: 'Meeting' },
  question: { icon: MessageCircleQuestion, tone: 'info', fr: 'Question ouverte', en: 'Open question' },
  trap: { icon: Lightbulb, tone: 'warn', fr: 'Piège', en: 'Trap' },
  note: { icon: NotebookPen, tone: '', fr: 'Noté', en: 'Noted' },
};

/** « Ce qui s’est passé »: five facts with their context and a link, or one quiet line. The journal keeps the rest. */
export function HappenedFeed({ items }: { items: readonly Happened[] }) {
  const w = useShareWords(); const t = useT();
  const when = (iso: string) => {
    const d = new Date(iso); const today = new Date();
    return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' }) : w('hier', 'yesterday');
  };
  const journal = hrefFor({ name: 'today', tab: 'focus' });
  return <section className="panel happened">
    <div className="panel-head"><h2>{w('Ce qui s’est passé', 'What happened')}</h2>{items.length ? <span className="muted small">{w('depuis hier', 'since yesterday')}</span> : null}</div>
    {items.length ? <>
      <ul className="hp-list">{items.map((h, i) => {
        const look = LOOK[h.kind] ?? LOOK.note!; const Icon = look.icon;
        const context = h.path ? <a className="link" href={hrefFor({ name: 'brain', path: h.path })}>{h.review === 'pending' ? w('à relire', 'to review') : w('ouvrir', 'open')}</a>
          : h.project ? <a className="link" href={h.project.kind === 'ticket' && h.project.ref ? hrefFor({ name: 'tickets', ref: h.project.ref }) : hrefFor({ name: 'projects', id: h.project.id })}>{h.project.ref ?? h.project.title}</a> : null;
        return <li key={`${h.at}-${i}`}>
          <span className={`hp-ic ${look.tone}`} aria-hidden="true"><Icon size={15} /></span>
          <div className="grow"><div className="hp-t">{w(look.fr, look.en)} : <b>{h.text}</b></div>{context ? <div className="hp-c">{context}</div> : null}</div>
          <span className="hp-w">{when(h.at)}</span>
        </li>;
      })}</ul>
      <a className="link hp-more" href={journal}>{w('Tout le journal', 'The whole journal')}</a>
    </> : <p className="hp-calm"><Coffee size={14} aria-hidden="true" />{w('Rien de marquant depuis hier.', 'Nothing notable since yesterday.')}</p>}
  </section>;
}
