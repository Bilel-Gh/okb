import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Link2, Terminal } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { KnowledgeLine, type Tier } from '../ui/KnowledgeLine';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type Gap = { part: string; points: number; key: string; params: Record<string, string | number> };
type Level = { percent: number; tier: Tier; partial: boolean; parts: { id: string; weight: number; score: number; measured: boolean }[]; next: Gap[] };
type Linked = { id: string; name: string; path: string; product?: string; description: string | null; stack: string[]; level: Level; status: { questions: { state: string }[]; notes: { kind: string; state: string; path: string }[]; stale: number; tickets: number } };
type Unlinked = { name: string; product: string; folder: string; level: Level };
type ReposData = { repos: Linked[]; unlinked: Unlinked[]; tickets: { ref: string; title: string; status: string; repos: { id: string }[] }[] };

/** Each product is a line of the map: a stable colour from its name. */
const LINES = ['#2563eb', '#059669', '#ea580c', '#7c3aed', '#0891b2', '#c026d3', '#ca8a04', '#e11d48', '#4f46e5'];
export function lineOf(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LINES[h % LINES.length]!;
}

function useTiers() {
  const t = useT();
  return { discovery: t('knowledge.tier.discovery'), usable: t('knowledge.tier.usable'), solid: t('knowledge.tier.solid'), expert: t('knowledge.tier.expert'), reference: t('knowledge.tier.reference') };
}

function gapText(t: ReturnType<typeof useT>, g: Gap): string {
  const params: Record<string, string | number> = { ...g.params };
  if (typeof g.params.kind === 'string') params.page = t(`app.page.${g.params.kind}`);
  return t(g.key, params);
}

function RepoCard({ name, product, level, href, linked }: { name: string; product: string; level: Level; href: string; linked: boolean }) {
  const t = useT();
  const tiers = useTiers();
  const color = lineOf(product || name);
  return (
    <li className="repo-card" style={{ '--line': color } as CSSProperties}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <a className="title repo-name" href={href}>{name}</a>
        {product ? <span className="line-badge"><span className="station sm" aria-hidden="true" />{product}</span> : null}
        <span className="spacer" />
        <span className="repo-percent num">{level.percent} %</span>
      </div>
      <KnowledgeLine percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} showLabels={false} />
      <p className="small"><strong>{tiers[level.tier]}</strong></p>
      {level.partial || !linked ? <p className="xs muted">{t('knowledge.partial')}</p> : null}
      {level.next.length ? (
        <ul className="next-steps">
          {level.next.map((g) => <li key={`${g.key}-${JSON.stringify(g.params)}`}><span className="pill num">{t('knowledge.points', { n: Math.max(1, Math.round(g.points)) })}</span>{gapText(t, g)}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

function LinkForm({ folder, name }: { folder: string; name: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const link = useMutation({
    mutationFn: () => post('/api/repos/link', { folder, path }),
    onSuccess: () => { toast(t('app.repos.linked', { name })); void qc.invalidateQueries({ queryKey: ['repos'] }); },
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (path.trim()) link.mutate(); }}>
      <div className="field">
        <label htmlFor="link-path">{t('app.repos.linkLabel', { name })}</label>
        <input id="link-path" className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/dev/…" autoComplete="off" spellCheck={false} />
        <small>{t('app.repos.linkHint')}</small>
      </div>
      {link.error ? <ErrorState error={link.error} /> : null}
      <span><button type="submit" className="btn primary sm" disabled={!path.trim() || link.isPending}><Link2 size={14} aria-hidden="true" />{t('app.repos.link')}</button></span>
    </form>
  );
}

function Detail({ data, id }: { data: ReposData; id: string }) {
  const t = useT();
  const tiers = useTiers();
  const linked = data.repos.find((r) => r.id === id || r.name === id);
  const unlinked = data.unlinked.find((r) => r.name === id);
  const name = linked?.name ?? unlinked?.name ?? id;
  const product = linked?.product ?? unlinked?.product ?? '';
  const level = linked?.level ?? unlinked?.level;
  if (!level) return <Empty title={t('app.repos.unknown', { id })} />;
  const color = lineOf(product || name);
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={hrefFor({ name: 'repos' })}><ArrowLeft size={16} aria-hidden="true" />{t('app.repos.back')}</a>
      <section className="panel" style={{ '--line': color } as CSSProperties}>
        <div className="panel-head"><h2>{name}</h2><span className="spacer" /><span className="repo-percent num">{level.percent} %</span></div>
        <div className="panel-body stack">
          <KnowledgeLine percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} />
          <table className="parts">
            <caption className="sr-only">{t('app.repos.parts')}</caption>
            <tbody>
              {level.parts.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{t(`knowledge.part.${p.id}`)}</th>
                  <td className="num">{p.measured ? `${Math.round(p.score * p.weight)} / ${p.weight}` : t('app.repos.notMeasured')}</td>
                  <td style={{ width: '45%' }}><span className="bar"><span style={{ width: `${p.measured ? p.score * 100 : 0}%` }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {level.next.length ? <><h3 className="small">{t('app.repos.nextTitle')}</h3><ul className="next-steps">{level.next.map((g) => <li key={g.key + JSON.stringify(g.params)}><span className="pill num">{t('knowledge.points', { n: Math.max(1, Math.round(g.points)) })}</span>{gapText(t, g)}</li>)}</ul></> : null}
        </div>
      </section>
      {unlinked ? <section className="panel"><div className="panel-head"><h2>{t('app.repos.linkTitle')}</h2></div><div className="panel-body"><LinkForm folder={unlinked.folder} name={unlinked.name} /></div></section> : null}
      <section className="panel"><div className="panel-head"><h2>{t('app.repos.withClaude')}</h2></div><div className="panel-body stack">
        <p className="small muted">{t('app.repos.withClaudeWhy')}</p>
        <code className="cmd"><Terminal size={14} aria-hidden="true" /> /okb-dev:onboard</code>
      </div></section>
    </div>
  );
}

export default function Repos({ route }: { route: Extract<Route, { name: 'repos' }> }) {
  const t = useT();
  const q = useQuery({ queryKey: ['repos'], queryFn: () => get<ReposData>('/api/repos') });
  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (route.id) return <div className="page"><Detail data={q.data} id={route.id} /></div>;
  const all = [...q.data.repos.map((r) => ({ name: r.name, product: r.product ?? '', level: r.level, href: hrefFor({ name: 'repos', id: r.id }), linked: true })), ...q.data.unlinked.map((r) => ({ name: r.name, product: r.product, level: r.level, href: hrefFor({ name: 'repos', id: r.name }), linked: false }))]
    .sort((a, b) => a.product.localeCompare(b.product) || a.name.localeCompare(b.name));
  return (
    <div className="page">
      <p className="muted" style={{ maxWidth: '72ch' }}>{t('app.repos.intro')}</p>
      {all.length ? <ul className="repo-grid">{all.map((r) => <RepoCard key={r.href} {...r} />)}</ul> : (
        <section className="panel"><Empty title={t('app.repos.emptyTitle')} action={<code className="cmd"><Terminal size={14} aria-hidden="true" /> cd &lt;repo&gt; &amp;&amp; okb repo add</code>}>{t('app.repos.empty')}</Empty></section>
      )}
    </div>
  );
}
