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

/** Each product is a line of the map: a stable colour from its name, never the reserved signal yellow. */
const LINES: readonly (readonly [string, string])[] = [
  ['#2563eb', '#6b9bff'], ['#059669', '#34d399'], ['#ea580c', '#fb923c'], ['#7c3aed', '#a78bfa'], ['#0891b2', '#22d3ee'],
  ['#c026d3', '#e879f9'], ['#e11d48', '#fb7185'], ['#4f46e5', '#818cf8'], ['#0d9488', '#2dd4bf'],
];
/** Products take the lines in order, so two products never share a colour (up to nine). */
export function lineOf(product: string, products: readonly string[]): string {
  const i = Math.max(0, [...products].sort((a, b) => a.localeCompare(b)).indexOf(product));
  const pair = LINES[i % LINES.length]!;
  return document.documentElement.dataset.theme === 'dark' ? pair[1] : pair[0];
}

function productsOf(data: ReposData): string[] {
  return [...new Set([...data.repos.map((r) => r.product ?? ''), ...data.unlinked.map((r) => r.product)])];
}

/** The terminus the line heads for: the next tier and where it starts. */
const NEXT_TIER: Readonly<Record<Tier, readonly [Tier, number] | null>> = { discovery: ['usable', 20], usable: ['solid', 45], solid: ['expert', 70], expert: ['reference', 90], reference: null };

function useTiers() {
  const t = useT();
  return { discovery: t('knowledge.tier.discovery'), usable: t('knowledge.tier.usable'), solid: t('knowledge.tier.solid'), expert: t('knowledge.tier.expert'), reference: t('knowledge.tier.reference') };
}

function gapText(t: ReturnType<typeof useT>, g: Gap): string {
  const params: Record<string, string | number> = { ...g.params };
  if (typeof g.params.kind === 'string') params.page = t(`app.page.${g.params.kind}`);
  return t(g.key, params);
}

/** One repository on its product's line: name, the knowledge line across the row, the percentage at its end. */
function RepoRow({ name, level, href, color }: { name: string; level: Level; href: string; color: string }) {
  const t = useT();
  const tiers = useTiers();
  const first = level.next[0];
  return (
    <li className="repo-row" style={{ '--line': color } as CSSProperties}>
      <div className="repo-row-name">
        <a className="title" href={href}>{name}</a>
        <span className="xs muted">{tiers[level.tier]}</span>
      </div>
      <div className="repo-row-line">
        <KnowledgeLine percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} showLabels={false} />
        {first ? <span className="xs muted">{t('knowledge.points', { n: Math.max(1, Math.round(first.points)) })} · {gapText(t, first)}</span> : null}
      </div>
      <span className="repo-percent num">{level.percent} %</span>
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
  const color = lineOf(product, productsOf(data));
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={hrefFor({ name: 'repos' })}><ArrowLeft size={16} aria-hidden="true" />{t('app.repos.back')}</a>
      <section className="panel" style={{ '--line': color } as CSSProperties}>
        <div className="panel-head"><h2>{name}</h2><span className="spacer" /><span className="repo-percent num">{level.percent} %</span></div>
        <div className="panel-body stack">
          <KnowledgeLine percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} />
          {NEXT_TIER[level.tier] ? <p className="small"><span className="muted">{t('app.repos.direction')} </span><strong>{tiers[NEXT_TIER[level.tier]![0]]}</strong><span className="muted"> · {t('app.repos.at', { n: NEXT_TIER[level.tier]![1] })}</span></p> : null}
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
  const all = [
    ...q.data.repos.map((r) => ({ name: r.name, product: r.product ?? '', level: r.level, href: hrefFor({ name: 'repos', id: r.id }), linked: true })),
    ...q.data.unlinked.map((r) => ({ name: r.name, product: r.product, level: r.level, href: hrefFor({ name: 'repos', id: r.name }), linked: false })),
  ];
  const products = [...new Set(all.map((r) => r.product))].sort((a, b) => a.localeCompare(b));
  const unlinked = all.filter((r) => !r.linked).length;
  return (
    <div className="page">
      <p className="muted" style={{ maxWidth: '72ch' }}>{t('app.repos.intro')}</p>
      {unlinked ? <p className="notice info small">{t('app.repos.unlinkedNotice')}</p> : null}
      {all.length ? products.map((product) => {
        const color = lineOf(product, products);
        const rows = all.filter((r) => r.product === product).sort((a, b) => b.level.percent - a.level.percent || a.name.localeCompare(b.name));
        return (
          <section key={product || '-'} className="panel repo-line" style={{ '--line': color } as CSSProperties} aria-labelledby={`p-${product}`}>
            <div className="panel-head"><span className="roundel" aria-hidden="true">{(product || '?').slice(0, 1)}</span><h2 id={`p-${product}`}>{product || t('app.repos.noProduct')}</h2><span className="muted small">{rows.length}</span></div>
            <ul className="repo-rows">{rows.map((r) => <RepoRow key={r.href} name={r.name} level={r.level} href={r.href} color={color} />)}</ul>
          </section>
        );
      }) : (
        <section className="panel"><Empty title={t('app.repos.emptyTitle')} action={<code className="cmd"><Terminal size={14} aria-hidden="true" /> cd &lt;repo&gt; &amp;&amp; okb repo add</code>}>{t('app.repos.empty')}</Empty></section>
      )}
    </div>
  );
}
