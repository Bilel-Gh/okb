import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Network, Wrench } from 'lucide-react';
import { get } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { useArchWords } from './arch-copy';

type Evidence = { repo: string; file: string; line: number };
type Node = { id: string; kind: string; name: string; tech: string };
type Link = { id: string; from: string; to: string; kind: string; confidence: 'sure' | 'probable' | 'to-confirm'; certainty?: 'proved' | 'declared' | 'supposed' | 'confirmed'; calls: { what: string }[]; evidence: Evidence[]; verb: string };
type OffMap = { repo: string; host: string; role: string; evidence: Evidence };
type ArchData = { system: string | null; model?: { nodes: Node[]; links: Link[]; offMap?: OffMap[] } };
const TONE: Record<string, string> = { proved: 'ok', declared: 'info', supposed: 'warn', confirmed: 'accent', sure: 'ok', probable: 'warn', 'to-confirm': 'warn' };

/**
 * On a repository's page (F2.4-18): who it talks to, one line per relation with
 * what passes and how sure OKB is — the same model as the map, so both say the
 * same — and, apart, the tools and links its code mentions (registries, Git
 * host, documentation), which are not relations.
 */
export function RepoRelations({ repo }: { repo: string }) {
  const t = useT();
  const words = useArchWords();
  const q = useQuery({ queryKey: ['arch', '', ''], queryFn: () => get<ArchData>('/api/repos/arch', {}) });
  const model = q.data?.model;
  if (!model) return null;
  const me = `repo:${repo}`;
  const name = (id: string) => (id === me ? words.thisRepo : model.nodes.find((n) => n.id === id)?.name ?? id.replace(/^\w+:/, ''));
  const links = model.links.filter((l) => l.from === me || l.to === me);
  const off = (model.offMap ?? []).filter((o) => o.repo === repo);
  const roles = [...new Set(off.map((o) => o.role))];
  return (
    <>
      <section className="panel" aria-label={t('web.repos.landscapeTitle')}>
        <div className="panel-head"><h2><Network size={17} aria-hidden="true" />{t('web.repos.landscapeTitle')}</h2><a className="link" href={hrefFor({ name: 'repos', tab: 'architecture' })}>{t('app.repos.tab.arch')}</a></div>
        {links.length ? (
          <ul className="rows tight repo-talk">
            {links.map((l) => (
              <li key={l.id} className="repo-talk-row">
                <span className="repo-talk-who">{name(l.from)}</span><ArrowRight size={14} aria-hidden="true" className="muted" /><span className="repo-talk-who">{name(l.to)}</span>
                <span className="small muted grow">{l.verb}{l.calls.length && !l.verb.includes(l.calls[0]!.what) && l.calls[0]!.what !== name(l.to) ? <> · <code>{l.calls.map((c) => c.what).slice(0, 2).join(' · ')}</code></> : null}</span>
                <span className={`pill sm ${TONE[l.certainty ?? l.confidence]}`}>{l.certainty ? words.cert[l.certainty] : t(`arch.conf.${l.confidence}`)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="panel-body small muted">{words.noRelations}</p>}
      </section>
      {roles.length ? (
        <section className="panel" aria-label={words.toolsTitle}>
          <div className="panel-head"><h2><Wrench size={17} aria-hidden="true" />{words.toolsTitle}</h2><span className="small muted">{words.toolsWhy}</span></div>
          <dl className="panel-body repo-tools">
            {roles.map((role) => (
              <div key={role} className="repo-tools-row">
                <dt className="small muted">{words.roles[role]?.[0] ?? role}</dt>
                <dd>{[...new Set(off.filter((o) => o.role === role).map((o) => o.host))].map((h) => <code key={h}>{h}</code>)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </>
  );
}
