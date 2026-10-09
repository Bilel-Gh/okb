import { useQuery } from '@tanstack/react-query';
import { Copy, Database, Globe, Terminal, X } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { get } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { layoutMap, type MapLayout, type Station } from './arch-layout';
import { lineOf } from './Repos';

type Node = { id: string; kind: 'repo' | 'datastore' | 'external' | 'system'; name: string; tech: string; repo?: string };
type Evidence = { repo: string; file: string; line: number };
type Link = { id: string; from: string; to: string; kind: 'http' | 'event' | 'package' | 'service' | 'data' | 'external'; confidence: 'sure' | 'probable' | 'to-confirm'; calls: { what: string; line: number }[]; evidence: Evidence[]; verb: string };
type Finding = { code: string; target: string; penalty: number };
type View = { kind: 'containers' | 'context' | 'flow'; boxes: Node[]; arrows: Link[]; mermaid: string; check: { score: number; findings: Finding[] }; steps?: { from: string; to: string; what: string; verb: string }[] };
type Question = { repo: string; what: string; evidence: Evidence; named?: string };
type ArchData = {
  system: string | null;
  model?: { nodes: Node[]; links: Link[]; questions: Question[] };
  entryPoints?: { repo: string; call: string }[];
  calls?: { from: string; call: string }[];
  views?: { containers: View; context: View; flow: View | null };
  pages?: Record<string, string>;
};
type ReposLite = { repos: { id: string; product?: string }[]; unlinked: { product: string }[] };
type Selection = { kind: 'link' | 'station'; id: string } | null;

/** Lines whose shape already says what they carry get no text on the map (a library, a database). */
const QUIET = new Set<Link['kind']>(['package', 'data']);
const CONFIDENCE_TONE: Readonly<Record<Link['confidence'], string>> = { sure: 'ok', probable: 'warn', 'to-confirm': 'warn' };
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function useColours(data: ArchData) {
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => get<ReposLite>('/api/repos') });
  return (node: Node): string | undefined => {
    if (node.kind !== 'repo' || !repos.data) return undefined;
    const products = [...new Set([...repos.data.repos.map((r) => r.product ?? ''), ...repos.data.unlinked.map((r) => r.product)])];
    const id = data.pages?.[node.id];
    const product = repos.data.repos.find((r) => r.id === id)?.product ?? '';
    return lineOf(product, products);
  };
}

/** One station: a ringed dot for a repository (in its product's colour), a well for a database, a dashed ring for an outside system. */
function StationMark({ s, here, colour }: { s: Station; here: boolean; colour: string | undefined }) {
  if (s.kind === 'datastore') return <g className="arch-store"><circle r={13} /><Database x={-7} y={-7} width={14} height={14} aria-hidden="true" /></g>;
  if (s.kind === 'external') return <g className="arch-ext"><circle r={13} /><Globe x={-7} y={-7} width={14} height={14} aria-hidden="true" /></g>;
  if (s.kind === 'system') return <circle className={`arch-system${here ? ' here' : ''}`} r={16} />;
  return <circle className={`arch-dot${here ? ' here' : ''}`} r={9} style={colour ? ({ '--c': colour } as CSSProperties) : undefined} />;
}

function SystemMap({ layout, links, nodes, selection, select, colour, label }: {
  layout: MapLayout; links: Map<string, Link>; nodes: Map<string, Node>; selection: Selection; select: (s: Selection) => void; colour: (n: Node) => string | undefined; label: string;
}) {
  const t = useT();
  const key = (s: Selection) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(s); } };
  const touches = (id: string) => selection?.kind === 'station' && (links.get(id)?.from === selection.id || links.get(id)?.to === selection.id);
  const lit = (id: string) => !selection || (selection.kind === 'link' ? selection.id === id : touches(id));
  return (
    <svg className={`arch-map${selection ? ' has-selection' : ''}`} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="group" aria-label={label}>
      <defs>
        <marker id="arch-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" className="arch-head" /></marker>
      </defs>
      {layout.edges.map((e) => {
        const link = links.get(e.id);
        if (!link) return null;
        const from = nodes.get(e.from)?.name ?? e.from;
        const to = nodes.get(e.to)?.name ?? e.to;
        const on = selection?.kind === 'link' && selection.id === e.id;
        return (
          <g key={e.id} className={`arch-edge k-${e.kind}${on ? ' on' : ''}${lit(e.id) ? '' : ' dim'}`} role="button" tabIndex={0}
            aria-pressed={on} aria-label={t('app.arch.linkLabel', { from, verb: link.verb, to, confidence: t(`arch.conf.${link.confidence}`) })}
            onClick={() => select(on ? null : { kind: 'link', id: e.id })} onKeyDown={key(on ? null : { kind: 'link', id: e.id })}>
            <path className="arch-hit" d={e.d} />
            <path className="arch-line" d={e.d} markerEnd={e.kind === 'package' || e.kind === 'data' ? undefined : 'url(#arch-head)'} />
            {QUIET.has(e.kind) ? null : <text className="arch-verb" x={e.lx} y={e.ly - 8} textAnchor="middle">{short(link.verb, 22)}{link.calls.length > 1 ? ` +${link.calls.length - 1}` : ''}</text>}
          </g>
        );
      })}
      {layout.stations.map((s) => {
        const node = nodes.get(s.id);
        if (!node) return null;
        const here = selection?.kind === 'station' && selection.id === s.id;
        return (
          <g key={s.id} className={`arch-station${here ? ' on' : ''}`} transform={`translate(${s.x} ${s.y})`} role="button" tabIndex={0} aria-pressed={here}
            aria-label={node.name === node.tech ? node.name : `${node.name} (${node.tech})`}
            onClick={() => select(here ? null : { kind: 'station', id: s.id })} onKeyDown={key(here ? null : { kind: 'station', id: s.id })}>
            <title>{node.name === node.tech ? node.name : `${node.name} — ${node.tech}`}</title>
            <circle className="arch-hit-dot" r={22} />
            <StationMark s={s} here={here} colour={colour(node)} />
            <text className="arch-name" y={s.kind === 'system' ? 36 : 30} textAnchor="middle">{short(node.name)}</text>
            {node.name !== node.tech ? <text className="arch-tech" y={s.kind === 'system' ? 52 : 46} textAnchor="middle">{short(node.tech, 30)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  const t = useT();
  const sample = (cls: string) => <svg width="34" height="10" aria-hidden="true"><path className={`arch-line ${cls}`} d="M 2 5 L 32 5" /></svg>;
  return (
    <ul className="arch-legend" aria-label={t('app.arch.legend')}>
      <li><span className="arch-edge k-http">{sample('')}</span>{t('app.arch.legend.call')}</li>
      <li><span className="arch-edge k-event">{sample('')}</span>{t('app.arch.legend.event')}</li>
      <li><span className="arch-edge k-package">{sample('')}</span>{t('app.arch.legend.lib')}</li>
      <li><Database size={14} aria-hidden="true" />{t('app.arch.legend.data')}</li>
      <li><Globe size={14} aria-hidden="true" />{t('app.arch.legend.ext')}</li>
    </ul>
  );
}

function Proofs({ link }: { link: Link }) {
  return (
    <ul className="arch-proofs">
      {link.evidence.map((e) => <li key={`${e.repo}:${e.file}:${e.line}`}><span className="small">{e.repo}</span><code>{e.file}:{e.line}</code></li>)}
    </ul>
  );
}

function LinkDetail({ link, nodes, pages }: { link: Link; nodes: Map<string, Node>; pages: Record<string, string> }) {
  const t = useT();
  const from = nodes.get(link.from);
  const to = nodes.get(link.to);
  const said = link.calls.map((c) => c.what).filter((w) => !link.verb.includes(w) && w !== to?.name);
  return (
    <div className="stack">
      <h2 className="arch-side-title">{from?.name ?? link.from} <span className="muted">→</span> {to?.name ?? link.to}</h2>
      <p className="arch-side-verb">{link.verb} <span className={`pill ${CONFIDENCE_TONE[link.confidence]}`}>{t(`arch.conf.${link.confidence}`)}</span></p>
      {said.length ? <><h3 className="small">{t('app.arch.passes')}</h3><ul className="arch-calls">{said.map((w) => <li key={w}><code>{w}</code></li>)}</ul></> : null}
      <h3 className="small">{t('app.arch.proof')}</h3>
      {link.evidence.length ? <Proofs link={link} /> : <p className="small muted">{t('app.arch.noProof')}</p>}
      {link.confidence !== 'sure' ? <p className="notice warn small">{t('app.arch.probableWhy')}</p> : null}
      <div className="arch-open">
        {[from, to].filter((n): n is Node => Boolean(n && n.kind === 'repo' && pages[n.id])).map((n) => <a key={n.id} className="btn sm" href={hrefFor({ name: 'repos', id: pages[n.id]! })}>{t('app.arch.open', { name: n.name })}</a>)}
      </div>
    </div>
  );
}

function StationDetail({ node, links, nodes, pages, select }: { node: Node; links: Link[]; nodes: Map<string, Node>; pages: Record<string, string>; select: (s: Selection) => void }) {
  const t = useT();
  const out = links.filter((l) => l.from === node.id);
  const into = links.filter((l) => l.to === node.id);
  const row = (l: Link, other: string, arrow: string) => (
    <li key={l.id}><button type="button" className="arch-link-row" onClick={() => select({ kind: 'link', id: l.id })}><span className="muted" aria-hidden="true">{arrow}</span><span>{nodes.get(other)?.name ?? other}</span><span className="muted small">{l.verb}</span></button></li>
  );
  return (
    <div className="stack">
      <h2 className="arch-side-title">{node.name}</h2>
      {node.name !== node.tech ? <code className="small muted">{node.tech}</code> : null}
      {out.length ? <><h3 className="small">{t('app.arch.out')}</h3><ul className="arch-link-rows">{out.map((l) => row(l, l.to, '→'))}</ul></> : null}
      {into.length ? <><h3 className="small">{t('app.arch.in')}</h3><ul className="arch-link-rows">{into.map((l) => row(l, l.from, '←'))}</ul></> : null}
      {!out.length && !into.length ? <p className="small muted">{t('app.arch.none')}</p> : null}
      {pages[node.id] ? <span><a className="btn sm" href={hrefFor({ name: 'repos', id: pages[node.id]! })}>{t('app.arch.open', { name: node.name })}</a></span> : null}
    </div>
  );
}

function Questions({ questions }: { questions: Question[] }) {
  const t = useT();
  return (
    <div className="stack">
      <h2 className="arch-side-title">{t('app.arch.questions')}</h2>
      <p className="small muted">{questions.length ? t('app.arch.questionsWhy') : t('app.arch.noQuestions')}</p>
      {questions.length ? (
        <ul className="arch-questions">
          {questions.map((q) => (
            <li key={`${q.repo}:${q.what}`}>
              <code>{q.what}</code>
              <span className="small">{q.named ? t('arch.q.noRoute', { repo: q.named }) : t('arch.q.nobody')}</span>
              <span className="xs muted">{q.repo} · <code>{q.evidence.file}:{q.evidence.line}</code></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A flow drawn as a single line: each step a numbered station, in the order the code makes the calls. */
function FlowLine({ view, links, select, selection }: { view: View; links: Map<string, Link>; select: (s: Selection) => void; selection: Selection }) {
  const t = useT();
  const names = new Map(view.boxes.map((b) => [b.id, b.name]));
  return (
    <ol className="arch-flow">
      {view.arrows.map((a, i) => {
        const on = selection?.kind === 'link' && selection.id === a.id;
        const link = links.get(a.id) ?? a;
        return (
          <li key={`${a.id}-${i}`} className={on ? 'on' : undefined}>
            <span className={`step-dot num${a.kind === 'event' ? ' event' : ''}`} aria-hidden="true">{i + 1}</span>
            <button type="button" className="arch-flow-step" aria-pressed={on} onClick={() => select(on ? null : { kind: 'link', id: a.id })}>
              <span className="arch-flow-who"><strong>{names.get(a.from) ?? a.from}</strong> <span className="muted">→</span> <strong>{names.get(a.to) ?? a.to}</strong></span>
              <span className="small">{link.verb}{a.calls[0] && !link.verb.includes(a.calls[0].what) ? <> · <code>{a.calls[0].what}</code></> : null}</span>
              <span className="xs muted">{a.kind === 'event' ? t('app.arch.legend.event') : t('app.arch.legend.call')} · {t(`arch.conf.${a.confidence}`)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function Arch({ route }: { route: Extract<Route, { name: 'repos' }> }) {
  const t = useT();
  const which = route.view ?? 'containers';
  const q = useQuery({
    queryKey: ['arch', route.from ?? '', route.call ?? ''],
    queryFn: () => get<ArchData>('/api/repos/arch', { from: route.from, call: route.call }),
  });
  const [selection, select] = useState<Selection>(null);
  const [anyway, setAnyway] = useState(false);
  useEffect(() => { select(null); setAnyway(false); }, [which, route.from, route.call]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const data = q.data;
  const colour = useColours(data ?? { system: null });
  const view = data?.views ? (which === 'flow' ? data.views.flow : data.views[which]) : null;
  const layout = useMemo(() => (view && view.kind !== 'flow' ? layoutMap(view) : null), [view]);

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.error || !data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!data.system || !data.model || !data.views) {
    return <section className="panel"><Empty title={t('app.arch.emptyTitle')} action={<code className="cmd"><Terminal size={14} aria-hidden="true" /> okb workspace add &lt;dossier&gt;</code>}>{t('app.arch.empty')}</Empty></section>;
  }
  const model = data.model;
  const pages = data.pages ?? {};
  const nodes = new Map([...model.nodes, ...(view?.boxes ?? [])].map((n) => [n.id, n]));
  const links = new Map([...model.links, ...(view?.arrows ?? [])].map((l) => [l.id, l]));
  const setView = (v: 'containers' | 'context' | 'flow') => go({ name: 'repos', tab: 'architecture', ...(v === 'containers' ? {} : { view: v }), ...(v === 'flow' && route.from ? { from: route.from } : {}), ...(v === 'flow' && route.call ? { call: route.call } : {}) });
  const copy = async () => {
    if (!view) return;
    try { await navigator.clipboard.writeText(view.mermaid); toast(t('app.arch.copied')); } catch { toast(t('app.arch.copyFailed'), 'err'); }
  };
  const label = (id: string) => { const l = links.get(id); return l ? `${nodes.get(l.from)?.name ?? l.from} → ${nodes.get(l.to)?.name ?? l.to}` : nodes.get(id)?.name ?? id; };
  const low = view ? view.check.score < 80 && !anyway : false;
  const selected = selection?.kind === 'link' ? links.get(selection.id) : undefined;
  const station = selection?.kind === 'station' ? nodes.get(selection.id) : undefined;
  const starts = (data.calls ?? []).filter((c, i, all) => all.findIndex((x) => x.from === c.from && x.call === c.call) === i);
  const current = view?.kind === 'flow' ? `${view.arrows[0]?.from ?? ''}|${view.arrows[0]?.calls.find((c) => c.what === route.call)?.what ?? route.call ?? view.arrows[0]?.calls[0]?.what ?? ''}` : '';

  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <p className="muted" style={{ maxWidth: '72ch' }}>{t('app.arch.intro', { name: data.system })}</p>
      <div className="arch-bar">
        <div className="segmented" role="group" aria-label={t('app.arch.view')}>
          {(['containers', 'context', 'flow'] as const).map((v) => <button key={v} type="button" aria-pressed={which === v} onClick={() => setView(v)}>{t(`app.arch.view.${v}`)}</button>)}
        </div>
        {which === 'flow' && starts.length ? (
          <label className="arch-from small">
            <span className="muted">{t('app.arch.from')}</span>
            <select className="input" value={current} onChange={(e) => { const [from = '', call = ''] = e.target.value.split('|'); go({ name: 'repos', tab: 'architecture', view: 'flow', from: from.replace(/^repo:/, ''), call }); }}>
              {starts.map((s) => <option key={`${s.from}|${s.call}`} value={`${s.from}|${s.call}`}>{nodes.get(s.from)?.name ?? s.from} · {s.call}</option>)}
            </select>
          </label>
        ) : null}
        <span className="spacer" />
        {view ? <span className={`pill num ${view.check.score >= 80 ? 'ok' : 'warn'}`} title={t('app.arch.scoreWhy')}>{t('app.arch.score', { score: view.check.score })}</span> : null}
        {view ? <button type="button" className="btn ghost sm" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />{t('app.arch.copy')}</button> : null}
      </div>

      <div className="arch-grid">
        <section className="panel arch-panel" aria-label={t('app.arch.mapLabel', { name: data.system })}>
          {!view ? <div className="panel-body"><p className="muted">{t('app.arch.noEntry')}</p></div> : low ? (
            <div className="panel-body stack">
              <p className="notice warn">{t('app.arch.low', { score: view.check.score })}</p>
              <ul className="next-steps">{view.check.findings.map((f) => <li key={f.code + f.target}>{t(`arch.finding.${f.code}`, { target: label(f.target) })}</li>)}</ul>
              <span><button type="button" className="btn sm" onClick={() => setAnyway(true)}>{t('app.arch.showAnyway')}</button></span>
            </div>
          ) : view.kind === 'flow' ? (
            <FlowLine view={view} links={links} select={select} selection={selection} />
          ) : layout ? (
            <>
              <div className="arch-scroll"><SystemMap layout={layout} links={links} nodes={nodes} selection={selection} select={select} colour={colour} label={t('app.arch.mapLabel', { name: data.system })} /></div>
              <Legend />
            </>
          ) : null}
        </section>
        <aside className="panel arch-side" aria-live="polite">
          <div className="panel-body stack">
            {selection ? <button type="button" className="btn ghost sm icon arch-clear" aria-label={t('app.arch.clear')} onClick={() => select(null)}><X size={16} aria-hidden="true" /></button> : null}
            {selected ? <LinkDetail link={selected} nodes={nodes} pages={pages} />
              : station ? <StationDetail node={station} links={model.links} nodes={nodes} pages={pages} select={select} />
              : <><p className="small muted">{t('app.arch.hint')}</p><Questions questions={model.questions} /></>}
          </div>
        </aside>
      </div>
    </div>
  );
}

