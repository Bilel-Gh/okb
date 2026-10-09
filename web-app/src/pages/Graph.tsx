import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, Crosshair, Eye, EyeOff, Layers, Maximize2, Minus, Plus, Search, Settings2, Share2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { get } from '../app/api';
import { useCategories } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { graphCategories, useGraphData, type GraphNode } from '../graph/data';
import { GraphView, shortTitle, type GNode, type GraphOptions } from '../graph/GraphView';
import { CatIcon } from '../ui/CatMark';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { TypeMark } from '../ui/TypeMark';
import { drawerOf } from './brain-tree';

type Prefs = { hidden: string[]; orphans: boolean; labels: GraphOptions['labels']; groupBy: GraphOptions['groupBy']; nav: boolean };
const PREFS = 'okb-graph-prefs-v3';
function loadPrefs(): Prefs {
  const base: Prefs = { hidden: [], orphans: true, labels: 'auto', groupBy: 'theme', nav: false };
  try { return { ...base, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) }; } catch { return base; }
}
function savePrefs(p: Prefs): void { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* private window */ } }

/* ------------------------------------------------------------------ the brain seen from above */

type AboveData = { focus: string; crumbs: { label: string; focus: string }[]; nodes: { id: string; label: string; kind: string; notes: number; drill: string | null; path: string | null }[]; edges: { from: string; to: string; weight: number }[] };
const KINDS: Record<string, { color: string; colorDark: string }> = {
  drawer: { color: '#6366f1', colorDark: '#a5b4fc' }, subject: { color: '#0ea5e9', colorDark: '#7dd3fc' }, side: { color: '#14b8a6', colorDark: '#5eead4' },
  repo: { color: '#8b5cf6', colorDark: '#c4b5fd' }, note: { color: '#64748b', colorDark: '#cbd5e1' }, outside: { color: '#94a3b8', colorDark: '#64748b' },
};

function Above({ focus, modes }: { focus: string; modes: ReactNode }) {
  const t = useT();
  const data = useQuery({ queryKey: ['brain-graph', focus], queryFn: () => get<AboveData>('/api/brain/graph', { focus }) });
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el || !data.data?.nodes.length) return;
    const v = new GraphView(el, {
      nodes: data.data.nodes.map((n) => ({ id: n.id, title: n.kind === 'note' ? n.label : `${n.label} · ${n.notes}`, category: n.kind, weight: n.kind === 'note' ? 0 : n.notes, ...(n.path ? { path: n.path } : {}), ...(n.drill ? { drill: n.drill } : {}) })),
      edges: data.data.edges.map((e) => ({ source: e.from, target: e.to })),
      categories: Object.entries(KINDS).map(([id, c]) => ({ id, ...c, label: t(`web.brain.kind.${id}`) })),
      label: t('web.brain.graph'), insetTop: 56, options: { labels: 'all', groupBy: 'none' },
      onOpen: (n) => { if (n.drill) go({ name: 'graph', brain: true, focus: n.drill }); else if (n.path) go({ name: 'brain', path: n.path }); },
    });
    return () => v.destroy();
  }, [data.data, t]);
  if (data.error) return <div className="page"><ErrorState error={data.error} /></div>;
  return (
    <div className="graph-stage-wrap">
      <div ref={stage} className="graph-stage" />
      {modes}
      <div className="graph-float top-left">
        <nav className="graph-card graph-crumbs" aria-label={t('web.brain.graph')}>
          {(data.data?.crumbs ?? []).map((c, i, all) => (
            <span key={c.focus || 'root'} className="row" style={{ gap: 4 }}>
              {i ? <ChevronRight size={13} className="muted" aria-hidden="true" /> : null}
              {i === all.length - 1 ? <b>{i === 0 ? t('app.brain.everything') : drawerOf(c.label).label}</b> : <a href={hrefFor({ name: 'graph', brain: true, ...(c.focus ? { focus: c.focus } : {}) })}>{i === 0 ? t('app.brain.everything') : drawerOf(c.label).label}</a>}
            </span>
          ))}
        </nav>
      </div>
      <div className="graph-float bottom-left graph-card graph-legend-mini">
        {Object.entries(KINDS).filter(([k]) => data.data?.nodes.some((n) => n.kind === k)).map(([k, c]) => (
          <span key={k}><i style={{ background: c.color }} />{t(`web.brain.kind.${k}`)}</span>
        ))}
        <span className="muted">{t('web.brain.graphHint')}</span>
      </div>
      {data.isLoading ? <div className="graph-loading"><SkeletonRows rows={3} /></div> : null}
      {data.data && !data.data.nodes.length ? <div className="graph-loading"><Empty title={t('web.brain.emptySubject')} /></div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the side: one note, the types, the themes */

function NodeCard({ node, view, all, onClose, onFocus }: { node: GNode; view: GraphView; all: Map<string, GraphNode>; onClose: () => void; onFocus: (id: string) => void }) {
  const t = useT();
  const neighbours = [...(view.adj.get(node.id) ?? [])].map((id) => all.get(id)).filter((n): n is GraphNode => Boolean(n)).sort((a, b) => a.title.localeCompare(b.title));
  const where = node.id.split('/').slice(0, -1).map((p) => drawerOf(p).label).join(' › ');
  return (
    <div className="node-card">
      <div className="row">
        <TypeMark id={node.category} size="sm" />
        <span className="spacer" />
        <button type="button" className="btn ghost sm icon" aria-label={t('app.close')} onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <h2>{node.title}</h2>
      {node.description ? <p className="muted">{node.description}</p> : null}
      {where ? <p className="small muted">{where}</p> : null}
      <p className="small node-links"><span>↩ {tn(t, 'app.graph.in', node.in ?? 0)}</span><span>→ {tn(t, 'app.graph.out', node.out ?? 0)}</span>{node.status === 'draft' ? <span className="pill sm warn">{t('web.graph.draft')}</span> : null}</p>
      <div className="row wrap">
        <a className="btn sm primary" href={hrefFor({ name: 'brain', path: node.id })}>{t('web.graph.open')}<ArrowRight size={14} aria-hidden="true" /></a>
        <button type="button" className="btn sm" onClick={() => onFocus(node.id)}><Crosshair size={14} aria-hidden="true" />{t('web.graph.focus')}</button>
      </div>
      {neighbours.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <p className="side-label">{tn(t, 'web.graph.neighbours', neighbours.length)}</p>
          <ul className="neighbours">
            {neighbours.slice(0, 60).map((m) => (
              <li key={m.id}><button type="button" onClick={() => { view.focusNode(m.id, view.transform.k); view.onSelect(view.nodes.find((x) => x.id === m.id) ?? null); }}><TypeMark id={m.category} size="xs" /><span className="clip">{m.title}</span></button></li>
            ))}
          </ul>
        </div>
      ) : <p className="small muted">{t('web.graph.alone')}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function GraphPage({ route }: { route: Extract<Route, { name: 'graph' }> }) {
  const t = useT();
  const cats = useCategories();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const graph = useGraphData(prefs.nav);
  const stage = useRef<HTMLDivElement>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [view, setView] = useState<GraphView | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [focus, setFocusState] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [tab, setTab] = useState<'types' | 'themes'>('types');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('');
  const [stats, setStats] = useState({ nodes: 0, edges: 0, lonely: 0 });
  const above = route.brain === true;
  const data = graph.data;
  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => { const next = { ...p, ...patch }; savePrefs(next); return next; });
  const count = (v: GraphView) => {
    const linked = new Set(v.edges.flatMap((e) => [e.source.id, e.target.id]));
    setStats({ nodes: v.nodes.length, edges: v.edges.length, lonely: v.nodes.filter((n) => !linked.has(n.id)).length });
  };

  useEffect(() => {
    const el = stage.current;
    if (above || !el || !data?.nodes.length) return;
    const p = loadPrefs();
    const focused = route.focus && data.nodes.some((n) => n.id === route.focus) ? route.focus : null;
    const v = new GraphView(el, {
      nodes: data.nodes, edges: data.edges, categories: graphCategories(data.categories, t.lang), communities: data.communities, label: t('app.nav.graph'), insetTop: 64,
      filter: { hidden: new Set(p.hidden), orphans: p.orphans, focus: focused, depth: 1 }, options: { labels: p.labels, groupBy: p.groupBy },
      onSelect: (n) => setSelected(n),
      onOpen: (n) => go({ name: 'brain', path: n.id }),
    });
    setFocusState(focused);
    if (route.focus) { const n = v.nodes.find((x) => x.id === route.focus); if (n) { v.select(n.id); setSelected(n); } }
    viewRef.current = v;
    setView(v);
    count(v);
    return () => { v.destroy(); viewRef.current = null; setView(null); };
  }, [data, above, route.focus, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (fn: (v: GraphView) => void) => { const v = viewRef.current; if (!v) return; fn(v); count(v); };
  const setFocus = (id: string | null) => apply((v) => { v.setFilter({ focus: id, depth }); setFocusState(id); if (id) { v.select(id); setSelected(v.nodes.find((n) => n.id === id) ?? null); } });
  const toggleType = (id: string) => {
    const hidden = new Set(prefs.hidden);
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    update({ hidden: [...hidden] });
    apply((v) => v.setFilter({ hidden }));
  };

  // Highlight a repository's notes, the shared notes tied to them and the repositories it talks to.
  useEffect(() => {
    const v = viewRef.current;
    const ws = data?.workspace;
    if (!v || !ws) return;
    if (!scope) { v.setHighlight(null); return; }
    const area = `repos/${scope}`;
    const mine = new Set(data!.nodes.filter((n) => n.area === area).map((n) => n.id));
    const tied = new Set(scope === ws.scope.repo ? ws.scope.tied : []);
    for (const e of data!.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id, d = typeof e.target === 'string' ? e.target : e.target.id;
      if (mine.has(s)) tied.add(d);
      if (mine.has(d)) tied.add(s);
    }
    const near = new Set(ws.edges.filter((e) => e.from === scope || e.to === scope).map((e) => `repos/${e.from === scope ? e.to : e.from}`));
    v.setHighlight([...mine, ...tied, ...data!.nodes.filter((n) => near.has(n.area)).map((n) => n.id)]);
  }, [scope, data]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return [];
    return data.nodes.filter((n) => `${n.title} ${n.id}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, data]);
  useEffect(() => { viewRef.current?.setHighlight(hits.length ? hits.map((h) => h.id) : null); }, [hits]);

  const pickHit = (n: GraphNode) => {
    setQ('');
    const v = viewRef.current;
    if (!v) return;
    v.setHighlight(null);
    if (!v.focusNode(n.id)) setFocus(n.id);
    setSelected(v.nodes.find((x) => x.id === n.id) ?? null);
  };

  const groups: GraphOptions['groupBy'][] = ['theme', 'category', 'area', 'none'];
  const presentCats = (data?.categories ?? []).filter((c) => c.count);

  // Which graph: every note, or the brain seen from above.
  const modes = (
    <div className="graph-float top-right">
      <div className="segmented graph-card" role="group" aria-label={t('app.graph.mode')}>
        <a href={hrefFor({ name: 'graph' })} aria-current={!above ? 'page' : undefined}><Share2 size={14} aria-hidden="true" />{t('app.graph.mode.notes')}</a>
        <a href={hrefFor({ name: 'graph', brain: true })} aria-current={above ? 'page' : undefined}><Layers size={14} aria-hidden="true" />{t('app.graph.mode.above')}</a>
      </div>
    </div>
  );

  return (
    <div className="graph-page">
      {above ? <Above focus={route.focus ?? ''} modes={modes} /> : graph.error ? <div className="page"><ErrorState error={graph.error} retry={() => void graph.refetch()} /></div> : (
        <div className="graph-layout">
          <div className="graph-stage-wrap">
            <div ref={stage} className="graph-stage" />
            {modes}
            {graph.isLoading ? <div className="graph-loading"><SkeletonRows rows={3} /></div> : null}
            {data && !data.nodes.length ? <div className="graph-loading"><Empty icon={<Share2 size={22} />} title={t('web.graph.emptyTitle')}>{t('web.graph.emptyText')}</Empty></div> : null}
            <div className="graph-float top-left">
              <div className="graph-card graph-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('web.graph.search')} aria-label={t('web.graph.search')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pickHit(hits[0]); if (e.key === 'Escape') setQ(''); }} />
                {hits.length ? (
                  <ul className="graph-hits">
                    {hits.map((h) => <li key={h.id}><button type="button" onClick={() => pickHit(h)}><TypeMark id={h.category} size="xs" /><span className="clip">{h.title}</span></button></li>)}
                  </ul>
                ) : null}
              </div>
              <div className="graph-card segmented-wrap">
                <div className="segmented" role="group" aria-label={t('web.graph.group')}>
                  {groups.map((g) => <button type="button" key={g} aria-pressed={prefs.groupBy === g} onClick={() => { update({ groupBy: g }); apply((v) => v.setOptions({ groupBy: g })); }}>{t(`app.graph.group.${g}`)}</button>)}
                </div>
              </div>
              <Popover.Root>
                <Popover.Trigger asChild><button type="button" className="graph-card btn icon" aria-label={t('app.graph.options')} title={t('app.graph.options')}><Settings2 size={17} aria-hidden="true" /></button></Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content className="menu graph-options" align="start" sideOffset={8}>
                    <p className="menu-heading">{t('web.graph.labels')}</p>
                    <div className="segmented" role="group" aria-label={t('web.graph.labels')}>
                      {(['auto', 'always', 'never'] as const).map((l) => <button type="button" key={l} aria-pressed={prefs.labels === l} onClick={() => { update({ labels: l }); apply((v) => v.setOptions({ labels: l })); }}>{t(`app.graph.labels.${l}`)}</button>)}
                    </div>
                    <label className="check-row"><input type="checkbox" checked={prefs.orphans} onChange={(e) => { update({ orphans: e.target.checked }); apply((v) => v.setFilter({ orphans: e.target.checked })); }} />{t('web.graph.orphans')}</label>
                    <label className="check-row"><input type="checkbox" checked={prefs.nav} onChange={(e) => update({ nav: e.target.checked })} />{t('web.graph.nav')}</label>
                    {data?.workspace ? (
                      <div className="field">
                        <label htmlFor="graph-scope">{t('web.graph.ws.scope')}</label>
                        <select id="graph-scope" className="select sm" value={scope} onChange={(e) => setScope(e.target.value)} title={t('web.graph.ws.scopeHelp')}>
                          <option value="">{t('web.graph.ws.noScope')}</option>
                          {data.workspace.repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </div>
                    ) : null}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
            {focus ? (
              <div className="graph-float top-center graph-card graph-focus" role="status">
                <Crosshair size={15} aria-hidden="true" />
                <span className="clip">{t('web.graph.focused', { title: byId.get(focus)?.title ?? focus })}</span>
                <div className="segmented mini" role="group" aria-label={t('app.graph.depth')}>
                  {[1, 2, 3].map((d) => <button type="button" key={d} aria-pressed={depth === d} onClick={() => { setDepth(d); apply((v) => v.setFilter({ depth: d })); }}>{d}</button>)}
                </div>
                <button type="button" className="btn sm ghost" onClick={() => setFocus(null)}><X size={14} aria-hidden="true" />{t('web.graph.unfocus')}</button>
              </div>
            ) : null}
            <div className="graph-float bottom-left graph-zoom graph-card">
              <button type="button" aria-label={t('app.graph.zoomIn')} title={t('app.graph.zoomIn')} onClick={() => view?.zoomBy(1.3)}><Plus size={16} aria-hidden="true" /></button>
              <button type="button" aria-label={t('app.graph.zoomOut')} title={t('app.graph.zoomOut')} onClick={() => view?.zoomBy(1 / 1.3)}><Minus size={16} aria-hidden="true" /></button>
              <button type="button" aria-label={t('web.graph.fit')} title={t('web.graph.fit')} onClick={() => { if (!view) return; view.setHighlight(null); view.autoFit = false; view.fit(); }}><Maximize2 size={15} aria-hidden="true" /></button>
            </div>
            <p className="graph-float bottom-right graph-stats">
              {tn(t, 'web.graph.notes', stats.nodes)} · {tn(t, 'web.graph.links', stats.edges)}{stats.lonely ? ` · ${tn(t, 'web.graph.lonely', stats.lonely)}` : ''}
              <span className="hide-narrow"> — {t('web.graph.hint')}</span>
            </p>
          </div>

          <aside className="graph-side" aria-label={t('app.graph.side')}>
            {selected && view ? (
              <NodeCard node={selected} view={view} all={byId} onClose={() => { view.select(null); setSelected(null); }} onFocus={(id) => setFocus(id)} />
            ) : (
              <>
                <div className="segmented" role="tablist" aria-label={t('app.graph.side')}>
                  <button type="button" role="tab" aria-selected={tab === 'types'} aria-pressed={tab === 'types'} onClick={() => setTab('types')}>{t('app.graph.types')}</button>
                  <button type="button" role="tab" aria-selected={tab === 'themes'} aria-pressed={tab === 'themes'} onClick={() => setTab('themes')}>{t('web.graph.themes')} <span className="n">{data?.communities.length ?? 0}</span></button>
                </div>
                {tab === 'types' ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <ul className="legend-list">
                      {presentCats.map((c) => {
                        const off = prefs.hidden.includes(c.id);
                        return (
                          <li key={c.id} style={{ '--c': cats.color(c.id) } as CSSProperties}>
                            <button type="button" className={off ? 'off' : ''} aria-pressed={!off} onClick={() => toggleType(c.id)} title={c.description?.[t.lang]}>
                              <span className="cat xs"><CatIcon id={c.id} emoji={c.emoji} size={11} /></span>
                              <span className="grow clip">{c.label[t.lang]}</span>
                              <span className="num muted">{c.count}</span>
                              {off ? <EyeOff size={14} aria-hidden="true" className="muted" /> : <Eye size={14} aria-hidden="true" className="muted" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="row small" style={{ padding: '6px 8px', gap: 14 }}>
                      {prefs.hidden.length ? <button type="button" className="link-btn" onClick={() => { update({ hidden: [] }); apply((v) => v.setFilter({ hidden: new Set() })); }}>{t('web.graph.showAll')}</button> : null}
                      <a className="link" href={hrefFor({ name: 'tools', tab: 'categories' })}>{t('web.graph.aboutCategories')}</a>
                    </div>
                    {data?.unresolved ? <p className="small muted" style={{ padding: '0 8px' }}>{tn(t, 'web.graph.unresolved', data.unresolved)}</p> : null}
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    <p className="small muted">{t('web.graph.themesIntro')}</p>
                    <ul className="theme-list">
                      {(data?.communities ?? []).slice(0, 16).map((c) => {
                        const members = (data?.nodes ?? []).filter((n) => n.community === c.id);
                        const preview = members.filter((n) => n.id !== c.hub).sort((a, b) => (b.in + b.out) - (a.in + a.out)).slice(0, 4).map((n) => shortTitle(n.title, 40));
                        const counts = new Map<string, number>();
                        for (const n of members) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
                        return (
                          <li key={c.id}>
                            <button type="button" onClick={() => { view?.focusGroup(members.map((n) => n.id)); const hub = c.hub ? view?.nodes.find((n) => n.id === c.hub) : null; if (hub) { view?.select(hub.id); setSelected(hub); } }}
                              title={c.namedBy === 'tag' ? t('web.graph.themeByTag', { tag: c.tag ?? '' }) : t('web.graph.themeByNote', { title: (c.hub && byId.get(c.hub)?.title) || c.label })}>
                              <span className="row" style={{ gap: 8 }}><b className="clip grow">{shortTitle(c.label, 36)}</b><span className="num muted small">{c.size}</span></span>
                              <span className="typebar thin" aria-hidden="true">{[...counts].map(([id, n]) => <span key={id} style={{ '--c': cats.color(id), flex: n } as CSSProperties} />)}</span>
                              {preview.length ? <span className="small muted theme-members">{preview.join(', ')}</span> : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {data ? <p className="small muted">{t(data.modularity >= 0.3 ? 'web.graph.themesClear' : 'web.graph.themesMixed', { q: String(data.modularity).replace('.', t.lang === 'fr' ? ',' : '.') })}</p> : null}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
