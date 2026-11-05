import { ArrowUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useT } from '../../app/i18n';
import { useShareWords } from '../../app/sharing';
import type { StoryKind, TicketSheet } from '../../app/tickets';
import { Empty } from '../../ui/States';

const KIND: Record<StoryKind, { fr: string; en: string; color: string }> = {
  start: { fr: 'Début', en: 'Start', color: 'var(--ink-3)' },
  explain: { fr: 'Explication', en: 'Explanation', color: 'var(--c-p1)' },
  decision: { fr: 'Décision', en: 'Decision', color: 'var(--c-p4)' },
  trap: { fr: 'Piège', en: 'Trap', color: 'var(--c-p5)' },
  question: { fr: 'Question', en: 'Question', color: 'var(--ink-3)' },
  blocker: { fr: 'Bloqueur', en: 'Blocker', color: 'var(--c-p2)' },
  review: { fr: 'Review', en: 'Review', color: 'var(--c-p5)' },
  fix: { fr: 'Correction', en: 'Fix', color: 'var(--c-p6)' },
  commits: { fr: 'Commits', en: 'Commits', color: 'var(--ink-3)' },
  done: { fr: 'Terminé', en: 'Done', color: 'var(--c-p3)' },
  reopen: { fr: 'Réouvert', en: 'Reopened', color: 'var(--c-p2)' },
};

/** « How I solved it » (chantier 4): a timeline when the road was bumpy, a short explanation when it was not. */
export function Story({ sheet }: { sheet: TicketSheet }) {
  const w = useShareWords(); const { lang } = useT();
  const story = sheet.story;
  const pr = story?.pr ?? null;
  const prLink = pr ? <a className="link" href={pr} target="_blank" rel="noreferrer">{w('Voir la PR', 'See the PR')}<ArrowUpRight size={14} aria-hidden="true" /></a> : null;
  if (!story || story.shape === 'empty') return <section className="tk-card"><div className="tk-card-b"><Empty title={w('Rien à raconter pour l’instant', 'Nothing to tell yet')}>{w('Le greffier remplit cette histoire à partir de tes conversations, une fois le greffier allumé (okb scribe on).', 'The scribe fills this story from your conversations, once it is on (okb scribe on).')}</Empty></div></section>;
  const steps = story.steps.filter((s) => s.kind !== 'start' && (s.text.trim() || s.kind === 'done' || s.kind === 'reopen'));
  return <section className="tk-card" aria-labelledby="tk-story-h">
    <div className="tk-card-h"><h2 id="tk-story-h">{story.shape === 'timeline' ? w('Comment je l’ai résolu', 'How I solved it') : w('Passé du premier coup', 'Went through at once')}</h2>{prLink ? <span style={{ marginLeft: 'auto' }}>{prLink}</span> : null}</div>
    <div className="tk-card-b stack">
      {story.summary ? <p>{story.summary}</p> : null}
      {story.shape === 'timeline' || steps.length > 1 ? <ol className="story">{steps.map((s, i) => <li key={`${s.at}-${i}`} style={{ '--st': KIND[s.kind].color } as CSSProperties}>
        <span className="k">{lang === 'en' ? KIND[s.kind].en : KIND[s.kind].fr}</span> <span className="meta">{new Date(s.at).toLocaleDateString(lang)}</span>
        {s.text ? <span className="x">{s.text}</span> : null}
      </li>)}</ol> : steps[0]?.text && !story.summary ? <p>{steps[0].text}</p> : null}
    </div>
  </section>;
}
