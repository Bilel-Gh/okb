import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookOpen, CircleHelp, Copy, Database, EyeOff, GitBranch, Globe, Image as ImageIcon, Lightbulb, Maximize2, Minus, Package, Plus, Server, Terminal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { layoutMap, type MapLayout, type Station } from './arch-layout';
import { lineOf } from './Repos';
import { exploreMap, initialFocus } from './arch-exploration';
import { useArchWords } from './arch-copy';
import { TeamLine } from './RepoTeam';
import '../styles/arch.css';
import { flowView, renderMap } from '../../../src/arch/views';

type Node = { id: string; kind: 'repo' | 'datastore' | 'external' | 'system'; name: string; tech: string; repo?: string };
type Evidence = { repo: string; file: string; line: number };
type Certainty = 'proved' | 'declared' | 'supposed' | 'confirmed';
type Link = { id: string; from: string; to: string; kind: 'http' | 'event' | 'package' | 'service' | 'data' | 'external'; confidence: 'sure' | 'probable' | 'to-confirm'; calls: { what: string; line: number }[]; evidence: Evidence[]; verb: string; certainty?: Certainty; basis?: string; origin?: 'scan' | 'agent' | 'person' };
type OffMap = { repo: string; host: string; role: 'call' | 'endpoint' | 'registry' | 'source-host' | 'doc' | 'asset' | 'platform' | 'unknown'; evidence: Evidence };
type Conflict = { key: string; action: string; target: string | null; reason: string; origin: string; at: string };
type Finding = { code: string; target: string; penalty: number };
type View = { kind: 'containers' | 'context' | 'flow'; boxes: Node[]; arrows: Link[]; mermaid: string; check: { score: number; findings: Finding[] }; groups?: { id: string; members: Node[] }[]; steps?: { from: string; to: string; what: string; verb: string }[] };
type Question = { repo: string; what: string; evidence: Evidence; named?: string };
type ArchData = {
  system: string | null;
  model?: { nodes: Node[]; links: Link[]; questions: Question[]; offMap?: OffMap[]; excluded?: (Link & { reason: string; at: string })[]; stale?: { key: string; action: string; at: string }[]; conflicts?: Conflict[] };
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
const CERTAINTY_TONE: Readonly<Record<Certainty, string>> = { proved: 'ok', declared: 'info', supposed: 'warn', confirmed: 'accent' };
/** The key of a link for the person's corrections: its kind and its two ends, never a line (F2.4-17). */
export const keyOf = (l: Pick<Link, 'kind' | 'from' | 'to'>) => `${l.kind}|${l.from}|${l.to}`;
const uncertain = (l: Link) => (l.certainty ? l.certainty === 'supposed' : l.confidence !== 'sure');

/** The certainty pill: lot D's words when the model has them, else the older confidence. */
function Sure({ link }: { link: Link }) {
  const t = useT();
  const words = useArchWords();
  return link.certainty ? <span className={`pill ${CERTAINTY_TONE[link.certainty]}`}>{words.cert[link.certainty]}</span> : <span className={`pill ${CONFIDENCE_TONE[link.confidence]}`}>{t(`arch.conf.${link.confidence}`)}</span>;
}


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

function SystemMap({ layout, links, nodes, selection, select, colour, label, scale }: {
  layout: MapLayout; links: Map<string, Link>; nodes: Map<string, Node>; selection: Selection; select: (s: Selection) => void; colour: (n: Node) => string | undefined; label: string; scale: number | null;
}) {
  const t = useT();
  const words = useArchWords();
  const drawing = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (selection?.kind !== 'station') return;
    const station = layout.stations.find((s) => s.id === selection.id);
    const scroll = drawing.current?.closest<HTMLDivElement>('.arch-scroll');
    if (!station || !scroll) return;
    const factor = scale ?? 1;
    // Bring the chosen repository into view without shrinking its full label.
    scroll.scrollLeft = Math.max(0, station.x * factor - scroll.clientWidth / 2 + 8);
    scroll.scrollTop = Math.max(0, station.y * factor - scroll.clientHeight / 3 + 48);
  }, [layout, selection, scale]);
  const key = (s: Selection) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(s); } };
  const touches = (id: string) => selection?.kind === 'station' && (links.get(id)?.from === selection.id || links.get(id)?.to === selection.id);
  const lit = (id: string) => !selection || (selection.kind === 'link' ? selection.id === id : touches(id));
  return (
    <svg ref={drawing} className={`arch-map${selection ? ' has-selection' : ''}${scale ? ' zoomed' : ''}`} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width * (scale ?? 1)} height={layout.height * (scale ?? 1)} role="group" aria-label={label}>
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
          <g key={e.id} className={`arch-edge k-${e.kind}${on ? ' on' : ''}${lit(e.id) ? '' : ' dim'}${uncertain(link) ? ' uncertain' : ''}`} role="button" tabIndex={0}
            aria-pressed={on} aria-label={t('app.arch.linkLabel', { from, verb: link.verb, to, confidence: link.certainty ? words.cert[link.certainty]! : t(`arch.conf.${link.confidence}`) })}
            onClick={() => select(on ? null : { kind: 'link', id: e.id })} onKeyDown={key(on ? null : { kind: 'link', id: e.id })}>
            <path className="arch-hit" d={e.d} />
            <path className="arch-line" d={e.d} markerEnd={e.kind === 'package' || e.kind === 'data' ? undefined : 'url(#arch-head)'} />
            {uncertain(link) ? <text className="arch-uncertainty" x={e.lx} y={e.ly - 8} textAnchor="middle">?</text> : null}
            {on && !QUIET.has(e.kind) ? <text className="arch-verb" x={e.lx} y={e.ly - 8} textAnchor="middle">{link.verb}</text> : null}
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
            <text className="arch-name" textAnchor="middle">{s.nameLines.map((line, i) => <tspan key={i} x={0} y={30 + i * 17}>{line}</tspan>)}</text>
            {s.techLines.length ? <text className="arch-tech" textAnchor="middle">{s.techLines.map((line, i) => <tspan key={i} x={0} y={32 + s.nameLines.length * 17 + i * 15}>{line}</tspan>)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5] as const;

/**
 * The map at the size of the page, or zoomed: the buttons, ⌘/Ctrl and the
 * wheel, and a drag to move around once it is larger than the page.
 */
function Zoomable({ width, children }: { width: number; children: (scale: number | null) => ReactNode }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // Readable at 100% by default; a big map scrolls instead of shrinking its text.
  const fit = () => 1;
  void width;
  const step = (dir: 1 | -1) => setScale((cur) => {
    const now = cur ?? fit();
    const next = dir > 0 ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01);
    return next ?? now;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const percent = Math.round((scale ?? fit()) * 100);
  return (
    <div className="arch-zoom">
      <div ref={box} className={`arch-scroll${scale ? ' grab' : ''}`} tabIndex={0}
        onPointerDown={(e) => { if (!scale || (e.target as Element).closest('[role="button"]')) return; drag.current = { x: e.clientX, y: e.clientY, left: box.current!.scrollLeft, top: box.current!.scrollTop }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (!d || !box.current) return; box.current.scrollLeft = d.left - (e.clientX - d.x); box.current.scrollTop = d.top - (e.clientY - d.y); }}
        onPointerUp={() => { drag.current = null; }}>
        {children(scale)}
      </div>
      <div className="arch-zoom-bar" role="group" aria-label={t('app.arch.zoom')}>
        <button type="button" className="btn sm ghost icon" aria-label={t('app.graph.zoomOut')} title={t('app.graph.zoomOut')} onClick={() => step(-1)}><Minus size={15} aria-hidden="true" /></button>
        <span className="num small muted" aria-live="polite">{percent} %</span>
        <button type="button" className="btn sm ghost icon" aria-label={t('app.graph.zoomIn')} title={t('app.graph.zoomIn')} onClick={() => step(1)}><Plus size={15} aria-hidden="true" /></button>
        <button type="button" className="btn sm ghost" disabled={scale === null} onClick={() => setScale(null)}><Maximize2 size={14} aria-hidden="true" />{t('app.arch.fit')}</button>
      </div>
    </div>
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

/** A link: what passes, how sure OKB is and why, its proofs, and the person's gestures (F2.4-16, F2.4-17). */
function LinkDetail({ link, nodes, pages, conflicts, act }: { link: Link; nodes: Map<string, Node>; pages: Record<string, string>; conflicts: Conflict[]; act: (path: string, body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const words = useArchWords();
  const [form, setForm] = useState<'exclude' | 'retarget' | null>(null);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  useEffect(() => { setForm(null); setReason(''); setTarget(''); }, [link.id]);
  const from = nodes.get(link.from);
  const to = nodes.get(link.to);
  const said = [...new Set(link.calls.map((c) => c.what))];
  const key = keyOf(link);
  const conflict = conflicts.find((c) => c.key === key);
  const targets = [...nodes.values()].filter((n) => (n.kind === 'repo' || n.kind === 'external') && n.id !== link.from && n.id !== link.to);
  const mine = link.certainty === 'confirmed' && link.origin === 'person';
  return (
    <div className="stack">
      <h2 className="arch-side-title">{from?.name ?? link.from} <span className="muted">→</span> {to?.name ?? link.to}</h2>
      <p className="arch-side-verb">{link.verb} <Sure link={link} /></p>
      {link.basis ? <p className="arch-basis small"><Lightbulb size={14} aria-hidden="true" /><span><strong>{words.why} : </strong>{link.basis}</span></p> : null}
      {said.length ? <><h3 className="small">{t('app.arch.passes')}</h3><ul className="arch-calls">{said.map((w) => <li key={w}><code>{w}</code></li>)}</ul></> : null}
      <h3 className="small">{t('app.arch.proof')}</h3>
      {link.evidence.length ? <Proofs link={link} /> : <p className="small muted">{t('app.arch.noProof')}</p>}
      {!link.certainty && link.confidence !== 'sure' ? <p className="notice warn small">{t('app.arch.probableWhy')}</p> : null}
      {conflict ? (
        <div className="arch-conflict small" role="group" aria-label={words.conflict(conflict.target ?? conflict.action)}>
          <strong>{words.conflict(conflict.target ? nodes.get(conflict.target)?.name ?? conflict.target : conflict.action)}</strong>{conflict.reason ? <span className="muted"> — {conflict.reason}</span> : null}
          <div className="arch-open"><button type="button" className="btn sm" onClick={() => void act('/api/arch/conflict', { key, keep: 'mine' })}>{words.keepMine}</button><button type="button" className="btn sm" onClick={() => void act('/api/arch/conflict', { key, keep: 'agent' })}>{words.takeAgent}</button></div>
        </div>
      ) : null}
      <div className="arch-open">
        {link.certainty !== 'confirmed' ? <button type="button" className="btn sm primary" onClick={() => void act('/api/arch/link/confirm', { key })}>{words.confirm}</button> : null}
        <button type="button" className="btn sm" aria-expanded={form === 'retarget'} onClick={() => setForm(form === 'retarget' ? null : 'retarget')}>{words.retarget}</button>
        <button type="button" className="btn sm ghost" aria-expanded={form === 'exclude'} onClick={() => setForm(form === 'exclude' ? null : 'exclude')}><EyeOff size={14} aria-hidden="true" />{words.exclude}</button>
        {mine ? <button type="button" className="btn sm ghost" onClick={() => void act('/api/arch/link/reset', { key })}>{words.undo}</button> : null}
      </div>
      {form === 'retarget' ? (
        <form className="arch-form stack" onSubmit={(e) => { e.preventDefault(); if (target) void act('/api/arch/link/retarget', { key, target, reason }).then(() => setForm(null)); }}>
          <label className="small">{words.isActually}<select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="" />{targets.map((n) => <option key={n.id} value={n.id}>{n.name === n.tech ? n.name : `${n.name} · ${n.tech}`}</option>)}</select></label>
          <label className="small">{words.reasonLabel}<input className="input" value={reason} placeholder={words.reasonHint} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="arch-open"><button type="submit" className="btn sm primary" disabled={!target}>{words.save}</button><button type="button" className="btn sm ghost" onClick={() => setForm(null)}>{words.cancel}</button></div>
        </form>
      ) : null}
      {form === 'exclude' ? (
        <form className="arch-form stack" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void act('/api/arch/link/exclude', { key, reason }).then(() => setForm(null)); }}>
          <label className="small">{words.reasonLabel}<input className="input" value={reason} placeholder={words.reasonHint} maxLength={300} required onChange={(e) => setReason(e.target.value)} /></label>
          <div className="arch-open"><button type="submit" className="btn sm primary" disabled={!reason.trim()}>{words.excludeDo}</button><button type="button" className="btn sm ghost" onClick={() => setForm(null)}>{words.cancel}</button></div>
        </form>
      ) : null}
      <p className="xs muted">{words.kept}</p>
      <div className="arch-open">
        {[from, to].filter((n): n is Node => Boolean(n && n.kind === 'repo' && pages[n.id])).map((n) => <a key={n.id} className="btn sm" href={hrefFor({ name: 'repos', id: pages[n.id]! })}>{t('app.arch.open', { name: n.name })}</a>)}
      </div>
    </div>
  );
}

const ROLE_ICON: Readonly<Record<string, ReactNode>> = {
  registry: <Package size={16} aria-hidden="true" />, 'source-host': <GitBranch size={16} aria-hidden="true" />, doc: <BookOpen size={16} aria-hidden="true" />,
  asset: <ImageIcon size={16} aria-hidden="true" />, platform: <Server size={16} aria-hidden="true" />, unknown: <CircleHelp size={16} aria-hidden="true" />,
};

/** What the repositories write that is not a relation, by role; the excluded links; the corrections with no effect (F2.4-18). */
function OffMapPanel({ model, nodes, act }: { model: NonNullable<ArchData['model']>; nodes: Map<string, Node>; act: (path: string, body: Record<string, unknown>) => Promise<void> }) {
  const words = useArchWords();
  const hosts = new Map<string, Map<string, OffMap[]>>();
  for (const o of model.offMap ?? []) {
    const byHost = hosts.get(o.role) ?? new Map<string, OffMap[]>();
    byHost.set(o.host, [...(byHost.get(o.host) ?? []), o]);
    hosts.set(o.role, byHost);
  }
  const roles = ['registry', 'source-host', 'doc', 'asset', 'platform', 'unknown'].filter((r) => hosts.has(r));
  const excluded = model.excluded ?? [];
  const stale = model.stale ?? [];
  if (!roles.length && !excluded.length && !stale.length) return null;
  const name = (id: string) => nodes.get(id)?.name ?? id;
  return (
    <section className="panel arch-off" aria-label={words.offTitle}>
      <div className="panel-head"><h2><EyeOff size={17} aria-hidden="true" />{words.offTitle}</h2><span className="small muted">{words.offWhy}</span></div>
      <div className="panel-body">
        {roles.map((role) => {
          const [title, why] = words.roles[role] ?? [role, ''];
          const list = [...hosts.get(role)!.entries()];
          return (
            <details key={role} className="arch-off-group" open={role === 'unknown'}>
              <summary>{ROLE_ICON[role]}<span className="grow"><span className="arch-off-title">{title}</span><span className="small muted">{why}</span></span><span className="pill sm num">{list.length}</span></summary>
              <ul className="arch-off-hosts">
                {list.map(([host, found]) => (
                  <li key={host}>
                    <code>{host}</code>
                    <span className="xs muted">{[...new Set(found.map((f) => `${f.repo} · ${f.evidence.file}:${f.evidence.line}`))].slice(0, 3).join(' · ')}{found.length > 3 ? ` · ${words.inRepos(new Set(found.map((f) => f.repo)).size)}` : ''}</span>
                    {role === 'unknown' ? (
                      <span className="arch-classify">{Object.entries(words.classifyAs).map(([r, label]) => <button key={r} type="button" className="btn sm" aria-label={`${host} : ${label}`} onClick={() => void act('/api/arch/url/classify', { host, role: r })}>{label}</button>)}</span>
                    ) : <button type="button" className="btn sm ghost" onClick={() => void act('/api/arch/url/classify', { host, role: 'call' })}>{words.isExternal}</button>}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        {excluded.length ? (
          <details className="arch-off-group" open>
            <summary><Ban size={16} aria-hidden="true" /><span className="grow"><span className="arch-off-title">{words.excludedTitle}</span><span className="small muted">{words.excludedWhy}</span></span><span className="pill sm num">{excluded.length}</span></summary>
            <ul className="arch-off-hosts">{excluded.map((l) => <li key={keyOf(l)}><span>{name(l.from)} → {name(l.to)}</span><span className="xs muted">« {l.reason} » · {l.at.slice(0, 10)}</span><button type="button" className="btn sm ghost" onClick={() => void act('/api/arch/link/reset', { key: keyOf(l) })}>{words.putBack}</button></li>)}</ul>
          </details>
        ) : null}
        {stale.length ? (
          <details className="arch-off-group" open>
            <summary><CircleHelp size={16} aria-hidden="true" /><span className="grow"><span className="arch-off-title">{words.staleTitle}</span><span className="small muted">{words.staleWhy}</span></span><span className="pill sm num">{stale.length}</span></summary>
            <ul className="arch-off-hosts">{stale.map((x) => <li key={x.key}><code>{x.key}</code><span className="xs muted">{x.action} · {x.at.slice(0, 10)}</span><button type="button" className="btn sm ghost" onClick={() => void act('/api/arch/link/reset', { key: x.key })}>{words.removeRule}</button></li>)}</ul>
          </details>
        ) : null}
      </div>
    </section>
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
      {node.kind === 'repo' && pages[node.id] ? <TeamLine kind="repo" subject={pages[node.id]!} /> : null}
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

/** Possible reachable dependencies, not a claim about runtime order. */
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
  const words = useArchWords();
  const [anyway, setAnyway] = useState(false);
  const [focus, setFocus] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [allRelations, setAllRelations] = useState(false);
  const [flowLimit, setFlowLimit] = useState(12);
  const [showSupposed, setShowSupposed] = useState(true);
  const [showExternal, setShowExternal] = useState(true);
  const qc = useQueryClient();
  const side = useRef<HTMLElement>(null);
  useEffect(() => { select(null); setAnyway(false); setFocus(''); setExpanded([]); setAllRelations(false); setFlowLimit(12); }, [which, route.from, route.call]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const raw = q.data;
  // The person's filters apply to the map and the list alike (F2.4-18).
  const data = useMemo(() => {
    if (!raw?.model || (showSupposed && showExternal)) return raw;
    const keep = (l: Link) => (showSupposed || !uncertain(l)) && (showExternal || l.kind !== 'external');
    const nodes = raw.model.nodes.filter((n) => showExternal || n.kind !== 'external');
    const views = raw.views ? { ...raw.views, containers: { ...raw.views.containers, boxes: raw.views.containers.boxes.filter((n) => showExternal || n.kind !== 'external'), arrows: raw.views.containers.arrows.filter(keep) } } : raw.views;
    return { ...raw, model: { ...raw.model, nodes, links: raw.model.links.filter(keep) }, ...(views ? { views } : {}) };
  }, [raw, showSupposed, showExternal]);
  const act = async (path: string, body: Record<string, unknown>) => {
    try { await post(path, body); toast(words.kept); } catch (e) { toast((e as Error).message, 'err'); }
    await qc.invalidateQueries({ queryKey: ['arch'] });
  };
  const colour = useColours(data ?? { system: null });
  const view = data?.views ? (which === 'flow' ? data.views.flow : data.views[which]) : null;
  const complete = useMemo(() => {
    if (!view || !data?.model) return null;
    if (which === 'containers') return { boxes: data.model.nodes, arrows: data.model.links };
    if (which === 'context') {
      const system = view.boxes.find((n) => n.kind === 'system');
      if (!system) return view;
      const outside = data.model.nodes.filter((n) => n.kind === 'external');
      return { boxes: [system, ...outside], arrows: outside.map((n) => {
        const into = data.model!.links.filter((l) => l.to === n.id);
        return { id: `context>${n.id}`, from: system.id, to: n.id, kind: 'external' as const, confidence: into.some((l) => l.confidence === 'to-confirm') ? 'to-confirm' as const : into.every((l) => l.confidence === 'sure') ? 'sure' as const : 'probable' as const, calls: into.flatMap((l) => l.calls), evidence: into.flatMap((l) => l.evidence), verb: into[0]?.verb ?? '' };
      }) };
    }
    const first = view.arrows[0];
    if (!first) return view;
    const full = flowView(data.model, first.from, route.call ?? first.calls[0]?.what ?? '', { max: data.model.links.length + 1 });
    return { boxes: [...full.boxes], arrows: [...full.arrows] as Link[] };
  }, [view, data?.model, which, route.call]);
  const currentFocus = focus || (complete && which === 'containers' ? initialFocus(complete.boxes, complete.arrows) : '');
  const exploration = useMemo(() => complete ? exploreMap(complete, { focus: currentFocus, expanded }) : null, [complete, currentFocus, expanded]);
  const layout = useMemo(() => (exploration && view?.kind !== 'flow' ? layoutMap(exploration) : null), [exploration, view?.kind]);

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.error || !data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!data.system || !data.model || !data.views) {
    return <section className="panel"><Empty title={t('app.arch.emptyTitle')} action={<code className="cmd"><Terminal size={14} aria-hidden="true" /> okb workspace add &lt;dossier&gt;</code>}>{t('app.arch.empty')}</Empty></section>;
  }
  const model = data.model;
  const pages = data.pages ?? {};
  const nodes = new Map([...model.nodes, ...(complete?.boxes ?? [])].map((n) => [n.id, n]));
  const links = new Map([...model.links, ...(complete?.arrows ?? [])].map((l) => [l.id, l]));
  const setView = (v: 'containers' | 'context' | 'flow') => go({ name: 'repos', tab: 'architecture', ...(v === 'containers' ? {} : { view: v }), ...(v === 'flow' && route.from ? { from: route.from } : {}), ...(v === 'flow' && route.call ? { call: route.call } : {}) });
  const copy = async () => {
    if (!view) return;
    const diagram = view.kind === 'flow' && view.arrows[0] ? flowView(model, view.arrows[0].from, route.call ?? view.arrows[0].calls[0]?.what ?? '', { max: flowLimit }).mermaid : exploration ? renderMap(exploration) : view.mermaid;
    try { await navigator.clipboard.writeText(diagram); toast(t('app.arch.copied')); } catch { toast(t('app.arch.copyFailed'), 'err'); }
  };
  const label = (id: string) => { const l = links.get(id); return l ? `${nodes.get(l.from)?.name ?? l.from} → ${nodes.get(l.to)?.name ?? l.to}` : nodes.get(id)?.name ?? id; };
  const low = view ? view.check.score < 80 && !anyway : false;
  const choose = (s: Selection) => {
    select(s);
    if (s?.kind === 'station' && nodes.get(s.id)?.kind === 'repo') { setFocus(s.id); setExpanded([]); }
    if (s?.kind === 'link') { const l = links.get(s.id); if (l) setExpanded((ids) => [...new Set([...ids, l.from, l.to])]); }
  };
  const selected = selection?.kind === 'link' ? links.get(selection.id) : undefined;
  const station = selection?.kind === 'station' ? nodes.get(selection.id) : undefined;
  const starts = (data.calls ?? []).filter((c, i, all) => all.findIndex((x) => x.from === c.from && x.call === c.call) === i);
  const current = view?.kind === 'flow' ? `${view.arrows[0]?.from ?? ''}|${view.arrows[0]?.calls.find((c) => c.what === route.call)?.what ?? route.call ?? view.arrows[0]?.calls[0]?.what ?? ''}` : '';

  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <p className="page-intro">{words.intro(data.system)}</p>
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
        {which !== 'flow' ? <><label className="small arch-filter"><input type="checkbox" checked={showSupposed} onChange={(e) => setShowSupposed(e.target.checked)} />{words.supposedOnly}</label><label className="small arch-filter"><input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} />{words.externalOnly}</label></> : null}
        <span className="spacer" />
        {view ? <span className={`pill num ${view.check.score >= 80 ? 'ok' : 'warn'}`} title={words.structureWhy}>{words.structure} {view.check.score}/100</span> : null}
        {view ? <button type="button" className="btn ghost sm" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />{t('app.arch.copy')}</button> : null}
      </div>

      <p className="small muted">{which === 'flow' ? words.flowWhy : words.modelWhy}</p>
      {which === 'containers' ? <label className="arch-focus small"><span>{words.focus}</span><select className="input" value={currentFocus} onChange={(e) => { setFocus(e.target.value); setExpanded([]); select({ kind: 'station', id: e.target.value }); }} >{model.nodes.filter((n) => n.kind === 'repo').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label> : null}

      <div className="arch-grid">
        <section className="panel arch-panel" aria-label={t('app.arch.mapLabel', { name: data.system })}>
          {!view ? <div className="panel-body"><p className="muted">{t('app.arch.noEntry')}</p></div> : low ? (
            <div className="panel-body stack">
              <p className="notice warn">{words.low(view.check.score)}</p>
              <ul className="next-steps">{view.check.findings.map((f) => <li key={f.code + f.target}>{t(`arch.finding.${f.code}`, { target: label(f.target) })}</li>)}</ul>
              <span><button type="button" className="btn sm" onClick={() => setAnyway(true)}>{t('app.arch.showAnyway')}</button></span>
            </div>
          ) : view.kind === 'flow' ? (
            <FlowLine view={{ ...view, boxes: complete?.boxes ?? view.boxes, arrows: (complete?.arrows ?? view.arrows).slice(0, flowLimit) }} links={links} select={choose} selection={selection} />
          ) : layout ? (
            <>
              <Zoomable width={layout.width}>{(scale) => <SystemMap layout={layout} links={links} nodes={nodes} selection={selection} select={choose} colour={colour} label={t('app.arch.mapLabel', { name: data.system ?? '' })} scale={scale} />}</Zoomable>
              <Legend />
            </>
          ) : null}
        </section>
        <aside ref={side} className="panel arch-side" aria-live="polite" tabIndex={-1}>
          <div className="panel-body stack">
            {selection ? <button type="button" className="btn ghost sm icon arch-clear" aria-label={t('app.arch.clear')} onClick={() => select(null)}><X size={16} aria-hidden="true" /></button> : null}
            {selected ? <LinkDetail link={selected} nodes={nodes} pages={pages} conflicts={model.conflicts ?? []} act={act} />
              : station ? <StationDetail node={station} links={model.links} nodes={nodes} pages={pages} select={choose} />
              : <><p className="small muted">{t('app.arch.hint')}</p><Questions questions={model.questions} /></>}
          </div>
        </aside>
      </div>
      {which === 'flow' && complete && complete.arrows.length > flowLimit ? <section className="panel"><div className="panel-body stack"><p className="small muted" role="status">{words.flowHidden(complete.arrows.length - flowLimit)}</p><span><button type="button" className="btn sm" onClick={() => setFlowLimit((n) => n + 12)}>{words.moreFlow}</button></span></div></section> : null}
      {exploration && (exploration.hidden.length || exploration.hiddenRelations) && which !== 'flow' ? <section className="panel arch-hidden">
        <div className="panel-body stack">
          <p className="small muted" role="status">{words.hidden(exploration.hidden.length, exploration.hiddenRelations, exploration.hiddenNeighbours)}</p>
          {exploration.groups.map((group) => <details key={group.kind}>
            <summary>{words.group[group.kind]} · {group.members.length}</summary>
            <ul className="arch-hidden-members">{group.members.map((n) => <li key={n.id}><button type="button" className="btn ghost sm" onClick={() => { setFocus(n.kind === 'repo' ? n.id : currentFocus); setExpanded((ids) => [...new Set([...ids, n.id])]); select({ kind: 'station', id: n.id }); }}>{n.name}</button></li>)}</ul>
          </details>)}
          <div className="arch-open">{exploration.groups.map((group) => <button key={group.kind} type="button" className="btn sm" onClick={() => setExpanded((ids) => [...new Set([...ids, ...group.members.map((n) => n.id)])])}>{words.expand[group.kind]} · {group.members.length}</button>)}</div>
        </div>
      </section> : null}
      {expanded.length ? <span><button type="button" className="btn sm ghost" onClick={() => { setExpanded([]); select(null); }}>{words.reset}</button></span> : null}
      <section className="panel arch-relations" aria-label={words.relations}>
        <div className="panel-body stack">
          <div className="arch-relations-head"><h2 className="panel-title">{words.relations}</h2>{which === 'containers' ? <label className="small"><input type="checkbox" checked={allRelations} onChange={(e) => setAllRelations(e.target.checked)} /> {words.allRelations} · {model.links.length}</label> : null}</div>
          {(() => {
            const rows = which === 'containers' ? model.links.filter((l) => allRelations || l.from === currentFocus || l.to === currentFocus) : complete?.arrows ?? [];
            return rows.length ? <ul className="arch-relation-list">{rows.map((l) => <li key={l.id}><button className="arch-relation-row" type="button" aria-pressed={selection?.kind === 'link' && selection.id === l.id} onClick={() => { choose({ kind: 'link', id: l.id }); side.current?.scrollIntoView({ block: 'nearest' }); side.current?.focus({ preventScroll: true }); }}>
              <span>{nodes.get(l.from)?.name ?? l.from} <span className="muted">→</span> {nodes.get(l.to)?.name ?? l.to}</span>
              <span className="small muted">{l.verb} · {l.calls.map((c) => c.what).join(' · ')}</span>
              <Sure link={l} /><span className="xs muted">{words.sourceCount(l.evidence.length)}</span>
            </button></li>)}</ul> : <p className="small muted">{words.noRelations}</p>;
          })()}
        </div>
      </section>
      {which !== 'flow' ? <OffMapPanel model={raw?.model ?? model} nodes={nodes} act={act} /> : null}
    </div>
  );
}
