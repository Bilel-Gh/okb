import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';

/**
 * The brain as a living graph: notes as dots in their type's colour, links as
 * lines, on a canvas. Pan, zoom, drag, pinch, hover, focus on a note and its
 * neighbourhood. Used full page (Graphe) and small (around a note in the reader).
 *
 * Layout: the groups (detected themes, types or areas) are placed first, then
 * each note settles around its group, with ForceAtlas2-like forces; computed
 * before the first frame, so the graph appears settled.
 */
export type GraphCategory = { id: string; color: string; colorDark: string; label: string; emoji?: string };
export type GraphNodeIn = {
  id: string; title: string; category: string; area?: string; community?: number; in?: number; out?: number;
  description?: string; status?: string; weight?: number; path?: string; drill?: string; reserved?: boolean;
};
export type GraphEdgeIn = { source: string | { id: string }; target: string | { id: string }; kind?: string; label?: string };
export type GraphTheme = { id: number; label: string; size: number; hub?: string; namedBy?: string; tag?: string };
export type GNode = GraphNodeIn & SimulationNodeDatum & { r: number; degree: number; group: string | null; x: number; y: number };
type GEdge = { source: GNode; target: GNode; kind?: string };
type GGroup = SimulationNodeDatum & { key: string; size: number; R: number; x: number; y: number };

export type GraphFilter = { hidden: Set<string>; area: string | null; orphans: boolean; focus: string | null; depth: number };
export type GraphOptions = { labels: 'auto' | 'always' | 'never' | 'all'; groupBy: 'theme' | 'category' | 'area' | 'none'; arrows: boolean };

/** Stable pseudo-random start positions: the same note lands in the same area every time. */
function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * « 🧩 Les briques de Claude Code : outils, skills… » → « Les briques de Claude Code » ;
 * « Le cycle d’une affaire, de l’opportunité au REX » → « Le cycle d’une affaire ».
 */
export function shortTitle(title: string, max = 32): string {
  let t = String(title).replace(/^[^\p{L}\p{N}«"(]+/u, '').trim();
  const cut = t.search(/\s[:—–|]\s|\s-\s/);
  if (cut >= 8) t = t.slice(0, cut);
  const comma = t.indexOf(', ');
  if (comma >= 12 && t.slice(0, comma).split(/\s+/).length >= 3) t = t.slice(0, comma);
  t = t.trim();
  if (t.length <= max) return t;
  const space = t.lastIndexOf(' ', max - 1);
  return `${t.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
}

const idOf = (v: string | { id: string }) => (typeof v === 'string' ? v : v.id);
const isDark = () => document.documentElement.dataset.mode === 'dark';

/** `#rrggbb` + alpha → `rgba()`. */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class GraphView {
  readonly el: HTMLElement;
  readonly mini: boolean;
  onSelect: (n: GNode | null) => void;
  onOpen: (n: GNode) => void;
  categories: Map<string, GraphCategory>;
  allNodes: GraphNodeIn[];
  allEdges: GraphEdgeIn[];
  filter: GraphFilter = { hidden: new Set(), area: null, orphans: true, focus: null, depth: 1 };
  options: GraphOptions;
  themes: Map<number, GraphTheme>;
  transform = { k: 1, x: 0, y: 0 };
  hover: GNode | null = null;
  selected: GNode | null = null;
  highlight: Set<string> | null = null;
  ringed = new Set<string>();
  autoFit = true;
  /** Room kept at the top for the controls floating over the map. */
  insetTop = 0;
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  adj = new Map<string, Set<string>>();
  private sim: Simulation<GNode, undefined> | null = null;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private ctx: CanvasRenderingContext2D | null;
  private ro: ResizeObserver;
  private mo: MutationObserver;
  private frame = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; k: number } | null = null;
  private drag: { node: GNode | null; start: { x: number; y: number }; last: { x: number; y: number }; moved: boolean } | null = null;
  private unbind: () => void;

  constructor(el: HTMLElement, data: { nodes: GraphNodeIn[]; edges: GraphEdgeIn[]; categories: GraphCategory[]; communities?: GraphTheme[]; mini?: boolean; label?: string; insetTop?: number; filter?: Partial<GraphFilter>; options?: Partial<GraphOptions>; onSelect?: (n: GNode | null) => void; onOpen?: (n: GNode) => void }) {
    this.el = el;
    this.mini = Boolean(data.mini);
    this.onSelect = data.onSelect ?? (() => undefined);
    this.onOpen = data.onOpen ?? (() => undefined);
    this.categories = new Map(data.categories.map((c) => [c.id, c]));
    this.allNodes = data.nodes;
    this.allEdges = data.edges;
    this.options = { labels: 'auto', groupBy: this.mini ? 'none' : 'theme', arrows: false, ...data.options };
    Object.assign(this.filter, data.filter);
    this.insetTop = data.insetTop ?? 0;
    this.themes = new Map((data.communities ?? []).map((c) => [c.id, { ...c, label: shortTitle(c.label, 40) }]));
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    this.canvas.setAttribute('role', 'img');
    if (data.label) this.canvas.setAttribute('aria-label', data.label);
    this.tip = document.createElement('div');
    this.tip.className = 'graph-tip';
    el.append(this.canvas, this.tip);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.mo = new MutationObserver(() => this.draw());
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
    this.unbind = this.bind();
    this.rebuild(true);
  }

  destroy(): void {
    this.sim?.stop();
    this.ro.disconnect();
    this.mo.disconnect();
    this.unbind();
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
    this.tip.remove();
  }

  colorOf(id: string): string {
    const c = this.categories.get(id) ?? this.categories.get('other');
    return c ? (isDark() ? c.colorDark : c.color) : '#94a3b8';
  }

  setFilter(patch: Partial<GraphFilter>): void { Object.assign(this.filter, patch); this.rebuild(false); }
  setOptions(patch: Partial<GraphOptions>): void { Object.assign(this.options, patch); this.rebuild(false); }

  /** Which notes and links are on screen, given the filters. */
  visible(): { nodes: GraphNodeIn[]; edges: GraphEdgeIn[] } {
    const f = this.filter;
    let nodes = this.allNodes.filter((n) => !f.hidden.has(n.category) && (!f.area || n.area === f.area));
    let ids = new Set(nodes.map((n) => n.id));
    let edges = this.allEdges.filter((e) => ids.has(idOf(e.source)) && ids.has(idOf(e.target)));
    if (f.focus && ids.has(f.focus)) {
      // A note and its neighbourhood, up to `depth` links away, in both directions.
      const adj = new Map<string, Set<string>>();
      for (const e of edges) {
        const s = idOf(e.source), t = idOf(e.target);
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s)!.add(t); adj.get(t)!.add(s);
      }
      const keep = new Set([f.focus]);
      let frontier = [f.focus];
      for (let d = 0; d < f.depth; d++) {
        const next: string[] = [];
        for (const id of frontier) for (const m of adj.get(id) ?? []) if (!keep.has(m)) { keep.add(m); next.push(m); }
        frontier = next;
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      ids = keep;
      edges = edges.filter((e) => keep.has(idOf(e.source)) && keep.has(idOf(e.target)));
    }
    if (!f.orphans) {
      const linked = new Set(edges.flatMap((e) => [idOf(e.source), idOf(e.target)]));
      nodes = nodes.filter((n) => linked.has(n.id) || n.id === f.focus);
    }
    return { nodes, edges };
  }

  /** What groups a note: its detected theme, its type or its area. */
  private groupKey(n: GNode): string | null {
    const mode = this.options.groupBy;
    if (mode === 'theme') return n.community !== undefined && n.community >= 0 ? `t${n.community}` : null;
    if (mode === 'category') return `c:${n.category}`;
    if (mode === 'area') return `a:${n.area ?? '.'}`;
    return null;
  }

  groupLabel(key: string): string {
    if (key.startsWith('t')) return this.themes.get(Number(key.slice(1)))?.label ?? '';
    if (key.startsWith('c:')) return this.categories.get(key.slice(2))?.label ?? '';
    if (key.startsWith('a:')) return key.slice(2) === '.' ? '' : key.slice(2);
    return '';
  }

  rebuild(first: boolean): void {
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    const { nodes: raw, edges: rawEdges } = this.visible();
    const nodes: GNode[] = raw.map((n) => ({ ...n, r: 0, degree: 0, group: null, x: 0, y: 0 }));
    const count = Math.max(1, nodes.length);
    this.nodes = nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    this.edges = rawEdges.map((e) => ({ source: byId.get(idOf(e.source))!, target: byId.get(idOf(e.target))!, kind: e.kind })).filter((e) => e.source && e.target);
    const degree = new Map<string, number>();
    for (const e of this.edges) { degree.set(e.source.id, (degree.get(e.source.id) ?? 0) + 1); degree.set(e.target.id, (degree.get(e.target.id) ?? 0) + 1); }
    this.adj = new Map(nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of this.edges) { this.adj.get(e.source.id)!.add(e.target.id); this.adj.get(e.target.id)!.add(e.source.id); }
    // A node may carry a weight (a folder's number of notes): a bigger disc.
    for (const n of nodes) {
      n.degree = degree.get(n.id) ?? 0;
      n.r = (this.mini ? 4.5 : 5) + Math.sqrt(n.degree) * (this.mini ? 1.6 : 2.1) + (n.weight ? (this.options.labels === 'all' ? 14 + Math.min(40, Math.sqrt(n.weight) * 4) : Math.min(18, Math.sqrt(n.weight) * 2)) : 0) + (n.id === this.filter.focus ? 3 : 0);
    }

    // Level 1: the groups.
    const grouped = !this.mini && this.options.groupBy !== 'none';
    const groups = new Map<string, GNode[]>();
    for (const n of nodes) {
      const k = grouped && (n.degree || this.options.groupBy !== 'theme') ? this.groupKey(n) : null;
      n.group = k;
      if (k) groups.set(k, [...(groups.get(k) ?? []), n]);
    }
    const anchors = new Map<string, GGroup>();
    if (groups.size) {
      const gnodes: GGroup[] = [...groups].map(([key, members], i) => {
        const a = i * 2.39996, r = 60 * Math.sqrt(i);
        return { key, size: members.length, R: 18 + Math.sqrt(members.length) * 26, x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
      const gIndex = new Map(gnodes.map((g) => [g.key, g]));
      const between = new Map<string, number>();
      for (const e of this.edges) {
        const a = e.source.group, b = e.target.group;
        if (!a || !b || a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        between.set(key, (between.get(key) ?? 0) + 1);
      }
      type GLink = SimulationLinkDatum<GGroup> & { w: number; source: GGroup; target: GGroup };
      const glinks: GLink[] = [...between].map(([key, w]) => { const [a, b] = key.split('|'); return { source: gIndex.get(a!)!, target: gIndex.get(b!)!, w }; });
      const gsim = forceSimulation(gnodes)
        .force('link', forceLink<GGroup, GLink>(glinks).distance((l) => l.source.R + l.target.R + 20).strength((l) => Math.min(0.9, 0.15 + l.w / Math.min(l.source.size, l.target.size))))
        .force('charge', forceManyBody<GGroup>().strength((g) => -26 * g.R))
        .force('collide', forceCollide<GGroup>().radius((g) => g.R + 18).strength(1))
        .force('x', forceX(0).strength(0.09)).force('y', forceY(0).strength(0.09))
        .stop();
      for (let i = 0; i < 400; i++) gsim.tick();
      for (const g of gnodes) anchors.set(g.key, g);
    }

    // Level 2: the notes, starting where they were or around their group's place.
    const spread = Math.sqrt(count) * 30;
    const perGroup = new Map<string, number>();
    for (const n of nodes) {
      const old = previous.get(n.id);
      if (old && !first && old.group === n.group) { n.x = old.x; n.y = old.y; continue; }
      const g = n.group ? anchors.get(n.group) : null;
      if (g) {
        const i = perGroup.get(n.group!) ?? 0;
        perGroup.set(n.group!, i + 1);
        const a = i * 2.39996, r = g.R * 0.85 * Math.sqrt((i + 0.5) / g.size);
        n.x = g.x + Math.cos(a) * r; n.y = g.y + Math.sin(a) * r;
      } else {
        const a = seed(n.id) * Math.PI * 2, r = spread * (0.3 + seed(`${n.id}#r`) * 0.7);
        n.x = Math.cos(a) * r; n.y = Math.sin(a) * r;
      }
    }
    // The ring for notes without links, just outside everything else.
    let outer = spread * 0.9;
    for (const g of anchors.values()) outer = Math.max(outer, Math.hypot(g.x, g.y) + g.R + 60);
    const lonely = (n: GNode) => n.degree === 0;
    const anchorOf = (n: GNode) => (n.group ? anchors.get(n.group) : undefined);

    this.sim?.stop();
    const sameGroup = (e: GEdge) => Boolean(e.source.group) && e.source.group === e.target.group;
    const sim = forceSimulation<GNode>(nodes)
      .force('link', forceLink<GNode, GEdge>(this.edges).id((n) => n.id)
        .distance((e) => (grouped && !sameGroup(e) ? 70 : this.mini ? 56 : 30) + Math.min(40, (e.source.r + e.target.r) * 1.5))
        .strength((e) => (grouped && !sameGroup(e) ? 0.04 : 0.8) / Math.min(degree.get(e.source.id) ?? 1, degree.get(e.target.id) ?? 1)))
      // ForceAtlas2-like repulsion: hubs push harder, leaves stay near their hub.
      .force('charge', forceManyBody<GNode>().strength((n) => -(this.mini ? 90 : 55) * (1 + Math.sqrt(n.degree))).distanceMax(grouped ? 320 : 900))
      .force('collide', forceCollide<GNode>().radius((n) => n.r + (this.mini ? 6 : 8)).strength(0.9))
      .force('x', forceX<GNode>((n) => anchorOf(n)?.x ?? 0).strength((n) => (lonely(n) ? 0 : anchorOf(n) ? 0.14 : 0.05)))
      .force('y', forceY<GNode>((n) => anchorOf(n)?.y ?? 0).strength((n) => (lonely(n) ? 0 : anchorOf(n) ? 0.14 : 0.05)))
      .force('ring', forceRadial<GNode>(outer, 0, 0).strength((n) => (lonely(n) && !this.mini ? 0.25 : 0)))
      .alphaDecay(0.028)
      .stop();
    // Settle before showing: no wobbling graph on screen.
    const started = performance.now();
    while (sim.alpha() > 0.04 && performance.now() - started < (first ? 900 : 500)) sim.tick();
    sim.on('tick', () => { if (this.autoFit) this.fit(); else this.draw(); });
    this.sim = sim;
    this.autoFit = true;
    this.resize();
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) sim.alpha(Math.min(sim.alpha(), 0.08)).restart();
  }

  /** Light up and frame a set of notes (a theme). */
  focusGroup(ids: readonly string[]): void {
    const set = new Set(ids);
    const members = this.nodes.filter((n) => set.has(n.id));
    if (!members.length) return;
    this.autoFit = false;
    this.highlight = set;
    this.frameOn(members, 120, 2.4);
  }

  private frameOn(members: readonly GNode[], padding: number, maxK: number): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of members) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const k = Math.min(maxK, Math.max(0.08, Math.min((this.w - padding) / Math.max(1, x1 - x0), (this.h - padding - this.insetTop) / Math.max(1, y1 - y0))));
    this.transform = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.insetTop / 2 + this.h / 2 - ((y0 + y1) / 2) * k };
    this.draw();
  }

  resize(): void {
    const r = this.el.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    if (this.autoFit) this.fit(); else this.draw();
    this.drawNow();
  }

  /** Zoom and centre so every visible note fits. */
  fit(padding = this.mini ? 26 : 48): void {
    if (!this.nodes.length || !this.w) { this.draw(); return; }
    this.frameOn(this.nodes, padding * 2, 2.2);
  }

  zoomBy(factor: number): void {
    this.autoFit = false;
    const t = this.transform;
    const k = Math.min(8, Math.max(0.05, t.k * factor));
    this.transform = { k, x: this.w / 2 - ((this.w / 2 - t.x) / t.k) * k, y: this.h / 2 - ((this.h / 2 - t.y) / t.k) * k };
    this.draw();
  }

  /** Centre on one note and light it up. */
  focusNode(id: string, zoom = 1.6): boolean {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return false;
    this.autoFit = false;
    this.selected = n;
    this.transform = { k: zoom, x: this.w / 2 - n.x * zoom, y: this.h / 2 - n.y * zoom };
    this.draw();
    return true;
  }

  select(id: string | null): void {
    this.selected = id ? this.nodes.find((n) => n.id === id) ?? null : null;
    this.draw();
  }

  setHighlight(ids: readonly string[] | null): void { this.highlight = ids ? new Set(ids) : null; this.draw(); }
  setRinged(ids: readonly string[] | null): void { this.ringed = new Set(ids ?? []); this.draw(); }

  private toWorld(px: number, py: number) { const t = this.transform; return { x: (px - t.x) / t.k, y: (py - t.y) / t.k }; }

  private nodeAt(px: number, py: number): GNode | null {
    const p = this.toWorld(px, py);
    let best: GNode | null = null, bestD = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      const reach = n.r + 5 / this.transform.k;
      if (d < reach && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  private bind(): () => void {
    const c = this.canvas;
    const local = (e: { clientX: number; clientY: number }) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.autoFit = false;
      const p = local(e);
      const t = this.transform;
      const k = Math.min(8, Math.max(0.05, t.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
      this.transform = { k, x: p.x - ((p.x - t.x) / t.k) * k, y: p.y - ((p.y - t.y) / t.k) * k };
      this.draw();
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) { this.autoFit = false; this.pinch = { d: this.pinchDistance(), k: this.transform.k }; this.drag = null; return; }
      const n = this.nodeAt(p.x, p.y);
      this.drag = { node: n, start: p, last: p, moved: false };
      if (n) { n.fx = n.x; n.fy = n.y; this.sim?.alphaTarget(0.2).restart(); }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) {
        const k = Math.min(8, Math.max(0.05, this.pinch.k * (this.pinchDistance() / this.pinch.d)));
        const mid = this.pinchMiddle();
        const t = this.transform;
        this.transform = { k, x: mid.x - ((mid.x - t.x) / t.k) * k, y: mid.y - ((mid.y - t.y) / t.k) * k };
        this.draw();
        return;
      }
      if (this.drag) {
        const dx = p.x - this.drag.last.x, dy = p.y - this.drag.last.y;
        if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 3) { this.drag.moved = true; this.autoFit = false; }
        if (this.drag.node) {
          const w = this.toWorld(p.x, p.y);
          this.drag.node.fx = w.x; this.drag.node.fy = w.y;
        } else {
          this.transform = { ...this.transform, x: this.transform.x + dx, y: this.transform.y + dy };
          this.draw();
        }
        this.drag.last = p;
        return;
      }
      const n = this.nodeAt(p.x, p.y);
      if (n !== this.hover) { this.hover = n; c.style.cursor = n ? 'pointer' : 'grab'; this.showTip(n, p); this.draw(); }
      else if (n) this.showTip(n, p);
    };
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch && this.pointers.size < 2) { this.pinch = null; return; }
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.node) { drag.node.fx = null; drag.node.fy = null; this.sim?.alphaTarget(0); }
      if (!drag.moved) {
        this.selected = drag.node;
        this.onSelect(drag.node);
        this.draw();
      }
    };
    const leave = () => { if (!this.drag) { this.hover = null; this.showTip(null); this.draw(); } };
    const dbl = (e: MouseEvent) => { const p = local(e); const n = this.nodeAt(p.x, p.y); if (n) this.onOpen(n); };
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('dblclick', dbl);
    return () => {
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', end);
      c.removeEventListener('pointercancel', end);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('dblclick', dbl);
    };
  }

  private pinchDistance() { const [a, b] = [...this.pointers.values()]; return Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)); }
  private pinchMiddle() { const [a, b] = [...this.pointers.values()]; return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }; }

  private showTip(n: GNode | null, p?: { x: number; y: number }): void {
    if (!n || this.mini || !p) { this.tip.style.display = 'none'; return; }
    const cat = this.categories.get(n.category);
    this.tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'graph-tip-type';
    head.style.setProperty('--c', this.colorOf(n.category));
    head.textContent = cat?.label ?? '';
    const title = document.createElement('b');
    title.textContent = n.title;
    this.tip.append(head, title);
    if (n.description) { const d = document.createElement('p'); d.textContent = n.description; this.tip.append(d); }
    if (n.in !== undefined) { const m = document.createElement('small'); m.textContent = `↩ ${n.in} · → ${n.out ?? 0}`; this.tip.append(m); }
    this.tip.style.display = 'block';
    const x = Math.min(p.x + 16, this.w - 300);
    this.tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.min(p.y + 16, this.h - 110)}px)`;
  }

  draw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  /** Paint now, without waiting for the next frame (the first picture, a resize): a hidden tab shows a drawn graph. */
  private drawNow(): void {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.paint();
  }

  private paint(): void {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const { k, x, y } = this.transform;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.nodes.length) return;
    const style = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const dark = isDark();
    const colors = { ink: v('--ink', dark ? '#ececf3' : '#17171f'), muted: v('--ink-3', '#6a6a80'), surface: v('--surface', dark ? '#17171f' : '#ffffff'), accent: v('--accent', '#5b4be0'), hair: v('--hair-strong', '#d6d6e2') };
    ctx.translate(x, y);
    ctx.scale(k, k);
    const active = this.hover ?? this.selected;
    const near = active ? this.adj.get(active.id) ?? new Set<string>() : null;
    const lit = (n: GNode) => !active || n === active || Boolean(near?.has(n.id));
    const marked = (n: GNode) => !this.highlight || this.highlight.has(n.id);

    // Group halos: a soft disc in the colour of the group's main type, named above it.
    const halos = this.groupHalos();
    for (const g of halos) {
      const grad = ctx.createRadialGradient(g.x, g.y, g.r * 0.2, g.x, g.y, g.r);
      grad.addColorStop(0, alpha(g.color, dark ? 0.1 : 0.075));
      grad.addColorStop(1, alpha(g.color, dark ? 0.04 : 0.03));
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = alpha(g.color, dark ? 0.28 : 0.22);
      ctx.stroke();
    }

    // Links under the dots; the more there are, the fainter each one, and links between groups fainter still.
    const base = Math.max(0.12, Math.min(0.38, 0.38 * Math.sqrt(120 / Math.max(120, this.edges.length))));
    const lineRgb = dark ? '160,160,190' : '90,90,120';
    for (const e of this.edges) {
      const on = Boolean(active) && (e.source === active || e.target === active);
      const dim = (active && !on) || (this.highlight && !(this.highlight.has(e.source.id) && this.highlight.has(e.target.id)));
      const across = e.source.group !== e.target.group;
      ctx.strokeStyle = on ? alpha(this.colorOf(active!.category), 0.85) : `rgba(${lineRgb},${dim ? 0.05 : across ? base * 0.45 : base})`;
      ctx.lineWidth = (on ? 1.8 : 1) / Math.max(0.6, k);
      ctx.setLineDash(e.kind === 'prereq' ? [4 / k, 3 / k] : []);
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
      if (this.options.arrows || e.kind === 'prereq' || on) this.arrow(ctx, e, on ? this.colorOf(active!.category) : `rgba(${lineRgb},${dim ? 0.1 : 0.45})`);
    }
    ctx.setLineDash([]);

    // Dots: a soft glow around the hubs, a ring of the page's colour so overlapping dots stay apart.
    for (const n of this.nodes) {
      const shown = lit(n) && marked(n);
      ctx.globalAlpha = shown ? 1 : 0.14;
      const color = this.colorOf(n.category);
      if (shown && (n.degree >= 5 || n === active) && !this.mini && !this.bubble(n)) {
        const glow = ctx.createRadialGradient(n.x, n.y, n.r * 0.6, n.x, n.y, n.r * 2.6);
        glow.addColorStop(0, alpha(color, dark ? 0.32 : 0.22));
        glow.addColorStop(1, alpha(color, 0));
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (this.bubble(n)) {
        // A folder seen from above: a tinted bubble ringed in its colour, its name inside.
        const fill = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.35, n.r * 0.1, n.x, n.y, n.r);
        fill.addColorStop(0, alpha(color, dark ? 0.42 : 0.26));
        fill.addColorStop(1, alpha(color, dark ? 0.22 : 0.12));
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = (n === active ? 3 : 2) / k;
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.4 / Math.max(0.8, k);
        ctx.strokeStyle = colors.surface;
        ctx.stroke();
      }
      if (n === this.selected || n.id === this.filter.focus || this.ringed.has(n.id)) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3.5 / k, 0, Math.PI * 2);
        ctx.lineWidth = 2.2 / k;
        ctx.strokeStyle = colors.accent;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const taken = this.paintGroupNames(ctx, halos, { k, x, y, colors, active });
    if (this.options.labels !== 'never') this.paintLabels(ctx, { k, x, y, active, near, lit, marked, colors, taken });
  }

  /** A big weighted node with every title shown: drawn as a bubble with its name inside. */
  private bubble(n: GNode): boolean {
    return this.options.labels === 'all' && Boolean(n.weight) && !this.mini;
  }

  /** Centre, radius and main colour of each group, from its notes' current positions. */
  private groupHalos(): { key: string; x: number; y: number; r: number; size: number; color: string }[] {
    if (this.mini || this.options.groupBy === 'none') return [];
    const groups = new Map<string, GNode[]>();
    for (const n of this.nodes) { if (!n.group) continue; groups.set(n.group, [...(groups.get(n.group) ?? []), n]); }
    const out = [];
    for (const [key, members] of groups) {
      if (members.length < 3) continue;
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
      const r = Math.max(...members.map((n) => Math.hypot(n.x - cx, n.y - cy) + n.r)) + 18;
      const counts = new Map<string, number>();
      for (const n of members) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
      const main = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      out.push({ key, x: cx, y: cy, r, size: members.length, color: this.colorOf(main) });
    }
    return out;
  }

  private paintGroupNames(ctx: CanvasRenderingContext2D, halos: ReturnType<GraphView['groupHalos']>, o: { k: number; x: number; y: number; colors: Record<string, string>; active: GNode | null }) {
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    if (!halos.length) return boxes;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 12.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = o.active ? 0.35 : 1;
    for (const g of halos) {
      const label = this.groupLabel(g.key);
      if (!label) continue;
      const text = `${label} · ${g.size}`;
      const w = ctx.measureText(text).width;
      // Kept inside the frame: a theme at the edge still shows its whole name.
      const sx = Math.min(Math.max(g.x * o.k + o.x, w / 2 + 14), this.w - w / 2 - 14);
      const sy = Math.max((g.y - g.r) * o.k + o.y - 4, 18);
      const box = { x0: sx - w / 2 - 10, x1: sx + w / 2 + 10, y0: sy - 11, y1: sy + 11 };
      if (boxes.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      boxes.push(box);
      roundRect(ctx, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 11);
      ctx.fillStyle = o.colors.surface!;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(g.color, 0.45);
      ctx.stroke();
      ctx.fillStyle = o.colors.ink!;
      ctx.fillText(text, sx, sy + 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr * o.k, 0, 0, this.dpr * o.k, this.dpr * o.x, this.dpr * o.y);
    return boxes;
  }

  private paintLabels(ctx: CanvasRenderingContext2D, o: { k: number; x: number; y: number; active: GNode | null; near: Set<string> | null; lit: (n: GNode) => boolean; marked: (n: GNode) => boolean; colors: Record<string, string>; taken: { x0: number; x1: number; y0: number; y1: number }[] }) {
    const { k, x, y, active, near } = o;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const font = this.mini ? 11 : 12;
    ctx.font = `500 ${font}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const mode = this.options.labels;
    const important = (n: GNode) => mode === 'all' || n === active || Boolean(near?.has(n.id)) || n.id === this.filter.focus || n === this.selected;
    // Zoomed out, only the hubs carry a title; zooming in reveals the others.
    const candidates = this.nodes
      .filter((n) => important(n) || (!active && o.marked(n) && (mode === 'always' || this.mini || n.r * k >= 7 || k >= 1.3)))
      .sort((a, b) => Number(important(b)) - Number(important(a)) || Number(b === active) - Number(a === active) || b.degree - a.degree);
    // Dots are obstacles: a title never hides another note.
    const dots = this.nodes.map((n) => ({ n, cx: n.x * k + x, cy: n.y * k + y, r: n.r * k + 2 }));
    const covers = (box: { x0: number; x1: number; y0: number; y1: number }, self: GNode) => dots.some((d) => d.n !== self && d.r > 2.5
      && d.cx + d.r > box.x0 && d.cx - d.r < box.x1 && d.cy + d.r > box.y0 && d.cy - d.r < box.y1
      && Math.hypot(Math.max(box.x0 - d.cx, 0, d.cx - box.x1), Math.max(box.y0 - d.cy, 0, d.cy - box.y1)) < d.r);
    const placed = [...o.taken];
    for (const n of candidates) {
      if (this.bubble(n) && n.r * k > 34) {
        const [name, count] = n.title.split(' · ');
        const sx = n.x * k + x, sy = n.y * k + y;
        ctx.globalAlpha = o.lit(n) ? 1 : 0.35;
        ctx.textBaseline = 'middle';
        ctx.font = `650 ${Math.min(16, Math.max(12, n.r * k * 0.2))}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = o.colors.ink!;
        ctx.fillText(shortTitle(name ?? n.title, 18), sx, sy - (count ? 8 : 0));
        if (count) { ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.fillStyle = o.colors.muted!; ctx.fillText(count, sx, sy + 11); }
        ctx.textBaseline = 'top';
        ctx.font = `500 ${font}px Inter, system-ui, sans-serif`;
        placed.push({ x0: sx - n.r * k, x1: sx + n.r * k, y0: sy - n.r * k, y1: sy + n.r * k });
        continue;
      }
      const strong = important(n);
      const label = shortTitle(n.title, this.mini ? 26 : strong ? 40 : 30);
      const w = ctx.measureText(label).width;
      const sx = n.x * k + x;
      const sy = (n.y + n.r) * k + y + 5;
      if (sx < -w || sx > this.w + w || sy < -20 || sy > this.h + 20) continue;
      const box = { x0: sx - w / 2 - 6, x1: sx + w / 2 + 6, y0: sy - 3, y1: sy + font + 4 };
      if (placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      if (!strong && covers(box, n)) continue;
      placed.push(box);
      ctx.globalAlpha = o.lit(n) ? 1 : 0.3;
      // A pill of the page's colour behind the title keeps it readable over the links.
      roundRect(ctx, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 7);
      ctx.fillStyle = alpha(o.colors.surface!, 0.92);
      ctx.fill();
      ctx.fillStyle = n === active ? this.colorOf(n.category) : o.colors.ink!;
      ctx.fillText(label, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  private arrow(ctx: CanvasRenderingContext2D, e: GEdge, color: string): void {
    const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const tipX = e.target.x - ux * (e.target.r + 2), tipY = e.target.y - uy * (e.target.r + 2);
    const s = 5.5 / Math.max(0.7, this.transform.k);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * s - uy * s * 0.6, tipY - uy * s + ux * s * 0.6);
    ctx.lineTo(tipX - ux * s + uy * s * 0.6, tipY - uy * s - ux * s * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}
