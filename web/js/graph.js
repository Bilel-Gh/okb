// The KB as a living graph: notes as dots coloured by category, links as lines.
// Canvas + d3-force (served at /vendor/d3-force.js): pan, zoom, drag, hover,
// focus on a note and its neighbourhood. Used full page (#/graph) and small
// (the local graph under a note).

let forceLoaded = null;
export function loadForce() {
  if (!forceLoaded) {
    forceLoaded = new Promise((done, fail) => {
      if (window.d3?.forceSimulation) { done(window.d3); return; }
      const s = document.createElement('script');
      s.src = '/vendor/d3-force.js';
      s.onload = () => (window.d3?.forceSimulation ? done(window.d3) : fail(new Error('d3-force missing')));
      s.onerror = () => fail(new Error('d3-force could not load'));
      document.head.append(s);
    });
  }
  return forceLoaded;
}

/** Stable pseudo-random start positions: the same note lands in the same area every time. */
function seed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

const dark = () => document.documentElement.dataset.theme === 'dark';
/**
 * "🧩 Les briques de Claude Code : outils, skills…" → "Les briques de Claude Code";
 * "Le cycle d’une affaire, de l’opportunité au REX" → "Le cycle d’une affaire".
 * Same rule as the theme names (src/kb/themes.ts).
 */
export function shortTitle(title, max = 32) {
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class GraphView {
  /**
   * @param {HTMLElement} el container
   * @param {{nodes: any[], edges: any[], categories: any[], mini?: boolean, onSelect?: Function, onOpen?: Function, onHover?: Function}} data
   */
  constructor(el, data) {
    this.el = el;
    this.mini = Boolean(data.mini);
    this.onSelect = data.onSelect ?? (() => {});
    this.onOpen = data.onOpen ?? (() => {});
    this.categories = new Map(data.categories.map((c) => [c.id, c]));
    this.allNodes = data.nodes.map((n) => ({ ...n }));
    this.allEdges = data.edges;
    this.filter = { hidden: new Set(), area: null, orphans: true, focus: null, depth: 1, query: '' };
    this.options = { labels: 'auto', groupBy: this.mini ? 'none' : 'theme', arrows: false };
    this.themes = new Map((data.communities ?? []).map((c) => [c.id, { ...c, label: shortTitle(c.label, 40) }]));
    this.transform = { k: 1, x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    this.highlight = null;
    /** Nodes drawn with a ring, without dimming the others (the repository in scope). */
    this.ringed = new Set();
    this.pointers = new Map();
    /** Keep everything in view while the layout settles, until the person zooms, pans or focuses. */
    this.autoFit = true;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    this.canvas.setAttribute('role', 'img');
    this.tip = document.createElement('div');
    this.tip.className = 'graph-tip';
    el.append(this.canvas, this.tip);
    this.ctx = this.canvas.getContext('2d');
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(el);
    this.mo = new MutationObserver(() => this.draw());
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.bind();
    this.ready = loadForce().then((d3) => { this.d3 = d3; this.rebuild(true); });
  }

  destroy() {
    this.sim?.stop();
    this.ro.disconnect();
    this.mo.disconnect();
    cancelAnimationFrame(this.frame);
  }

  colorOf(id) {
    const c = this.categories.get(id) ?? this.categories.get('other');
    return c ? (dark() ? c.colorDark : c.color) : '#94a3b8';
  }

  setFilter(patch) { Object.assign(this.filter, patch); this.rebuild(false); }
  setOptions(patch) { Object.assign(this.options, patch); this.rebuild(false); }

  /** Which notes and links are on screen, given the filters. */
  visible() {
    const f = this.filter;
    let nodes = this.allNodes.filter((n) => !f.hidden.has(n.category) && (!f.area || n.area === f.area));
    let ids = new Set(nodes.map((n) => n.id));
    let edges = this.allEdges.filter((e) => ids.has(e.source.id ?? e.source) && ids.has(e.target.id ?? e.target));
    if (f.focus && ids.has(f.focus)) {
      // A note and its neighbourhood, up to `depth` links away, in both directions.
      const adj = new Map();
      for (const e of edges) {
        const s = e.source.id ?? e.source, t = e.target.id ?? e.target;
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s).add(t); adj.get(t).add(s);
      }
      const keep = new Set([f.focus]);
      let frontier = [f.focus];
      for (let d = 0; d < f.depth; d++) {
        const next = [];
        for (const id of frontier) for (const m of adj.get(id) ?? []) if (!keep.has(m)) { keep.add(m); next.push(m); }
        frontier = next;
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      ids = keep;
      edges = edges.filter((e) => keep.has(e.source.id ?? e.source) && keep.has(e.target.id ?? e.target));
    }
    if (!f.orphans) {
      const linked = new Set(edges.flatMap((e) => [e.source.id ?? e.source, e.target.id ?? e.target]));
      nodes = nodes.filter((n) => linked.has(n.id) || n.id === f.focus);
    }
    return { nodes, edges };
  }

  /** What groups a note: its detected theme, its category or its area. */
  groupKey(n) {
    const mode = this.options.groupBy;
    if (mode === 'theme') return n.community >= 0 ? `t${n.community}` : null;
    if (mode === 'category') return `c:${n.category}`;
    if (mode === 'area') return `a:${n.area}`;
    return null;
  }

  groupLabel(key) {
    if (key.startsWith('t')) return this.themes.get(Number(key.slice(1)))?.label ?? '';
    if (key.startsWith('c:')) { const c = this.categories.get(key.slice(2)); return c ? `${c.emoji} ${c.name ?? c.id}` : ''; }
    if (key.startsWith('a:')) return key.slice(2) === '.' ? '' : key.slice(2);
    return '';
  }

  /**
   * Two-level force layout ("group in a box"): the groups are laid out first,
   * as discs sized by their number of notes and pulled together by the links
   * between them; then each note settles around its group's place, with
   * ForceAtlas2-style forces (well-linked notes push harder, links inside a
   * group are short and strong, links between groups long and loose).
   * Notes without links wait on a ring around the graph. Computed before the
   * first frame, so the graph appears settled.
   */
  rebuild(first) {
    if (!this.d3) return;
    const d3 = this.d3;
    const previous = new Map((this.nodes ?? []).map((n) => [n.id, n]));
    const { nodes, edges } = this.visible();
    const count = Math.max(1, nodes.length);
    this.nodes = nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges.map((e) => ({ source: byId.get(e.source.id ?? e.source), target: byId.get(e.target.id ?? e.target), kind: e.kind })).filter((e) => e.source && e.target);
    const degree = new Map();
    for (const e of this.edges) { degree.set(e.source.id, (degree.get(e.source.id) ?? 0) + 1); degree.set(e.target.id, (degree.get(e.target.id) ?? 0) + 1); }
    this.adj = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const e of this.edges) { this.adj.get(e.source.id).add(e.target.id); this.adj.get(e.target.id).add(e.source.id); }
    // A node may carry a weight (a repository's number of notes, in the workspace view): bigger disc.
    for (const n of nodes) { n.degree = degree.get(n.id) ?? 0; n.r = (this.mini ? 4 : 4.5) + Math.sqrt(n.degree) * (this.mini ? 1.6 : 2.1) + (n.weight ? Math.min(16, Math.sqrt(n.weight) * 1.8) : 0) + (n.id === this.filter.focus ? 3 : 0); }

    // Level 1: the groups.
    const grouped = !this.mini && this.options.groupBy !== 'none';
    const groups = new Map();
    if (grouped) for (const n of nodes) { const k = n.degree || this.options.groupBy !== 'theme' ? this.groupKey(n) : null; n.group = k; if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); } }
    else for (const n of nodes) n.group = null;
    const anchors = new Map();
    if (groups.size) {
      const gnodes = [...groups].map(([key, members]) => ({ key, size: members.length, R: 18 + Math.sqrt(members.length) * 26 }));
      const gIndex = new Map(gnodes.map((g) => [g.key, g]));
      const between = new Map();
      for (const e of this.edges) {
        const a = e.source.group, b = e.target.group;
        if (!a || !b || a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        between.set(key, (between.get(key) ?? 0) + 1);
      }
      const glinks = [...between].map(([key, w]) => { const [a, b] = key.split('|'); return { source: gIndex.get(a), target: gIndex.get(b), w }; });
      gnodes.forEach((g, i) => { const a = i * 2.39996; const r = 60 * Math.sqrt(i); g.x = Math.cos(a) * r; g.y = Math.sin(a) * r; });
      const gsim = d3.forceSimulation(gnodes)
        .force('link', d3.forceLink(glinks).distance((l) => l.source.R + l.target.R + 20).strength((l) => Math.min(0.9, 0.15 + l.w / Math.min(l.source.size, l.target.size))))
        .force('charge', d3.forceManyBody().strength((g) => -26 * g.R))
        .force('collide', d3.forceCollide().radius((g) => g.R + 18).strength(1))
        .force('x', d3.forceX(0).strength(0.09)).force('y', d3.forceY(0).strength(0.09))
        .stop();
      for (let i = 0; i < 400; i++) gsim.tick();
      for (const g of gnodes) anchors.set(g.key, g);
    }

    // Level 2: the notes, starting where they were or around their group's place.
    const spread = Math.sqrt(count) * 30;
    const perGroupIndex = new Map();
    for (const n of nodes) {
      const old = previous.get(n.id);
      if (old && !first && old.group === n.group && old.x !== undefined) { n.x = old.x; n.y = old.y; continue; }
      const g = n.group ? anchors.get(n.group) : null;
      if (g) {
        const i = perGroupIndex.get(n.group) ?? 0;
        perGroupIndex.set(n.group, i + 1);
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
    const lonely = (n) => n.degree === 0;

    this.sim?.stop();
    const sameGroup = (e) => e.source.group && e.source.group === e.target.group;
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(this.edges).id((n) => n.id)
        .distance((e) => (grouped && !sameGroup(e) ? 70 : this.mini ? 56 : 30) + Math.min(40, (e.source.r + e.target.r) * 1.5))
        .strength((e) => (grouped && !sameGroup(e) ? 0.04 : 0.8) / Math.min(degree.get(e.source.id) ?? 1, degree.get(e.target.id) ?? 1)))
      // ForceAtlas2-like repulsion: hubs push harder, leaves stay near their hub.
      .force('charge', d3.forceManyBody().strength((n) => -(this.mini ? 90 : 55) * (1 + Math.sqrt(n.degree))).distanceMax(grouped ? 320 : 900))
      .force('collide', d3.forceCollide().radius((n) => n.r + (this.mini ? 6 : 8)).strength(0.9))
      .force('x', d3.forceX((n) => (n.group && anchors.get(n.group) ? anchors.get(n.group).x : 0)).strength((n) => (lonely(n) ? 0 : n.group && anchors.get(n.group) ? 0.14 : 0.05)))
      .force('y', d3.forceY((n) => (n.group && anchors.get(n.group) ? anchors.get(n.group).y : 0)).strength((n) => (lonely(n) ? 0 : n.group && anchors.get(n.group) ? 0.14 : 0.05)))
      .force('ring', d3.forceRadial(outer, 0, 0).strength((n) => (lonely(n) && !this.mini ? 0.25 : 0)))
      .alphaDecay(0.028)
      .stop();
    // Settle before showing: no wobbling graph on screen.
    const started = performance.now();
    while (sim.alpha() > 0.04 && performance.now() - started < (first ? 900 : 500)) sim.tick();
    sim.on('tick', () => { if (this.autoFit) this.fit(); else this.draw(); });
    this.sim = sim;
    this.autoFit = true;
    this.fit();
    sim.alpha(Math.min(sim.alpha(), 0.08)).restart();
  }

  /** Light up and frame a set of notes (a theme). */
  focusGroup(ids) {
    const set = new Set(ids);
    const members = (this.nodes ?? []).filter((n) => set.has(n.id));
    if (!members.length) return;
    this.autoFit = false;
    this.highlight = set;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of members) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const k = Math.min(2.4, Math.max(0.1, Math.min((this.w - 120) / Math.max(1, x1 - x0), (this.h - 120) / Math.max(1, y1 - y0))));
    this.transform = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
    this.draw();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.dpr = dpr;
    if (this.autoFit) this.fit(); else this.draw();
  }

  /** Zoom and centre so every visible note fits. */
  fit(padding = this.mini ? 26 : 40) {
    if (!this.nodes?.length || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const k = Math.min(2.2, Math.max(0.08, Math.min((this.w - padding * 2) / Math.max(1, x1 - x0), (this.h - padding * 2) / Math.max(1, y1 - y0))));
    this.transform = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
    this.draw();
  }

  /** Centre on one note and light it up. */
  focusNode(id, zoom = 1.6) {
    const n = this.nodes?.find((x) => x.id === id);
    if (!n) return false;
    this.autoFit = false;
    this.selected = n;
    this.transform = { k: zoom, x: this.w / 2 - n.x * zoom, y: this.h / 2 - n.y * zoom };
    this.draw();
    return true;
  }

  setHighlight(ids) { this.highlight = ids ? new Set(ids) : null; this.draw(); }
  setRinged(ids) { this.ringed = new Set(ids ?? []); this.draw(); }

  toWorld(px, py) { const t = this.transform; return { x: (px - t.x) / t.k, y: (py - t.y) / t.k }; }

  nodeAt(px, py) {
    const p = this.toWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of this.nodes ?? []) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      const reach = n.r + 4 / this.transform.k;
      if (d < reach && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  bind() {
    const c = this.canvas;
    const local = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.autoFit = false;
      const p = local(e);
      const t = this.transform;
      const k = Math.min(8, Math.max(0.05, t.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
      this.transform = { k, x: p.x - ((p.x - t.x) / t.k) * k, y: p.y - ((p.y - t.y) / t.k) * k };
      this.draw();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) { this.autoFit = false; this.pinch = { d: this.pinchDistance(), k: this.transform.k }; this.drag = null; return; }
      const n = this.nodeAt(p.x, p.y);
      this.drag = { node: n, start: p, last: p, moved: false };
      if (n) { n.fx = n.x; n.fy = n.y; this.sim?.alphaTarget(0.2).restart(); }
    });
    c.addEventListener('pointermove', (e) => {
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
    });
    const end = (e) => {
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
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.showTip(null); this.draw(); } });
    c.addEventListener('dblclick', (e) => { const p = local(e); const n = this.nodeAt(p.x, p.y); if (n) this.onOpen(n); });
  }

  pinchDistance() { const [a, b] = [...this.pointers.values()]; return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); }
  pinchMiddle() { const [a, b] = [...this.pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  showTip(n, p) {
    if (!n || this.mini) { this.tip.style.display = 'none'; return; }
    const cat = this.categories.get(n.category);
    this.tip.replaceChildren();
    const title = document.createElement('b');
    title.textContent = n.title;
    const meta = document.createElement('div');
    meta.className = 'small muted';
    meta.textContent = `${cat?.emoji ?? ''} ${cat?.one ?? ''} · ${n.in} ↩ · ${n.out} →`;
    this.tip.append(title, meta);
    if (n.description) { const d = document.createElement('div'); d.className = 'small'; d.textContent = n.description; this.tip.append(d); }
    this.tip.style.display = 'block';
    const x = Math.min(p.x + 14, this.w - 300);
    this.tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.min(p.y + 14, this.h - 90)}px)`;
  }

  draw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  paint() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const { k, x, y } = this.transform;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.nodes) return;
    ctx.translate(x, y);
    ctx.scale(k, k);
    const isDark = dark();
    const text = css('--text', isDark ? '#e5e7eb' : '#111827');
    const line = isDark ? 'rgba(148,163,184,' : 'rgba(100,116,139,';
    const active = this.hover ?? this.selected;
    const near = active ? this.adj.get(active.id) ?? new Set() : null;
    const lit = (n) => !active || n === active || near.has(n.id);
    const marked = (n) => !this.highlight || this.highlight.has(n.id);

    // Group halos: a soft disc around each theme (or category, or area), named.
    const halos = this.groupHalos();
    for (const g of halos) {
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? 'rgba(148,163,184,.045)' : 'rgba(100,116,139,.05)';
      ctx.fill();
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = isDark ? 'rgba(148,163,184,.14)' : 'rgba(100,116,139,.16)';
      ctx.stroke();
    }

    // Links first, under the dots; the more there are, the fainter each one,
    // and links between groups fainter still, so each group reads as one.
    const edgeAlpha = Math.max(0.1, Math.min(0.32, 0.32 * Math.sqrt(120 / Math.max(120, this.edges.length))));
    ctx.lineWidth = 1 / Math.max(0.6, k);
    for (const e of this.edges) {
      const on = active && (e.source === active || e.target === active);
      const dim = (active && !on) || (this.highlight && !(this.highlight.has(e.source.id) && this.highlight.has(e.target.id)));
      const across = e.source.group !== e.target.group;
      ctx.strokeStyle = on ? this.colorOf(active.category) : `${line}${dim ? 0.05 : across ? edgeAlpha * 0.45 : edgeAlpha})`;
      ctx.lineWidth = (on ? 1.8 : 1) / Math.max(0.6, k);
      if (e.kind === 'prereq') ctx.setLineDash([4 / k, 3 / k]); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
      if (this.options.arrows || e.kind === 'prereq' || on) this.arrow(ctx, e, on ? this.colorOf(active.category) : `${line}${dim ? 0.1 : 0.45})`);
    }
    ctx.setLineDash([]);

    // Dots.
    for (const n of this.nodes) {
      const visibleNow = lit(n) && marked(n);
      ctx.globalAlpha = visibleNow ? 1 : 0.16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = this.colorOf(n.category);
      ctx.fill();
      if (n === this.selected || n.id === this.filter.focus || this.ringed.has(n.id)) {
        ctx.lineWidth = 2.5 / k;
        ctx.strokeStyle = text;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Labels, in screen space so they keep their size: the active neighbourhood
    // first, then the most linked notes; a title is drawn only where it does not
    // cover another one, and fades in as you zoom.
    const mode = this.options.labels;
    const taken = this.paintGroupNames(ctx, halos, { k, x, y, isDark, active });
    if (mode !== 'never') this.paintLabels(ctx, { k, x, y, active, near, lit, marked, text, isDark, mode, taken });
  }

  /** Centre and radius of each group, from its notes' current positions. */
  groupHalos() {
    if (this.mini || this.options.groupBy === 'none' || !this.nodes) return [];
    const groups = new Map();
    for (const n of this.nodes) { if (!n.group) continue; if (!groups.has(n.group)) groups.set(n.group, []); groups.get(n.group).push(n); }
    const out = [];
    for (const [key, members] of groups) {
      if (members.length < 3) continue;
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
      const r = Math.max(...members.map((n) => Math.hypot(n.x - cx, n.y - cy) + n.r)) + 16;
      out.push({ key, x: cx, y: cy, r, size: members.length });
    }
    return out;
  }

  /** Each group's name above its halo, in screen space. */
  paintGroupNames(ctx, halos, { k, x, y, isDark, active }) {
    const boxes = [];
    if (!halos.length) return boxes;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '650 12.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.globalAlpha = active ? 0.35 : 0.9;
    for (const g of halos) {
      const label = this.groupLabel(g.key);
      if (!label) continue;
      const textOut = `${label} · ${g.size}`;
      const w = ctx.measureText(textOut).width;
      // Kept inside the frame: a theme at the edge still shows its whole name.
      const sx = Math.min(Math.max(g.x * k + x, w / 2 + 8), this.w - w / 2 - 8);
      const sy = Math.max((g.y - g.r) * k + y - 4, 20);
      const box = { x0: sx - w / 2 - 4, x1: sx + w / 2 + 4, y0: sy - 16, y1: sy + 2 };
      if (boxes.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      boxes.push(box);
      ctx.fillStyle = isDark ? 'rgba(203,213,225,.85)' : 'rgba(51,65,85,.85)';
      ctx.fillText(textOut, sx, sy);
    }
    ctx.globalAlpha = 1;
    // Back to world space for anything drawn next.
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
    return boxes;
  }

  paintLabels(ctx, { k, x, y, active, near, lit, marked, text, isDark, mode, taken = [] }) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const font = this.mini ? 11 : 12;
    ctx.font = `500 ${font}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const important = (n) => n === active || (near && near.has(n.id)) || n.id === this.filter.focus || n === this.selected;
    // Zoomed out, only the hubs carry a title; zooming in reveals the others.
    const candidates = this.nodes
      .filter((n) => important(n) || (!active && marked(n) && (mode === 'always' || this.mini || n.r * k >= 7 || k >= 1.3)))
      .sort((a, b) => (important(b) - important(a)) || (b === active) - (a === active) || b.degree - a.degree);
    // Dots are obstacles: a title never hides another note.
    const dots = this.nodes.map((n) => ({ n, cx: n.x * k + x, cy: n.y * k + y, r: n.r * k + 2 }));
    const covers = (box, self) => dots.some((d) => d.n !== self && d.r > 2.5
      && d.cx + d.r > box.x0 && d.cx - d.r < box.x1 && d.cy + d.r > box.y0 && d.cy - d.r < box.y1
      && Math.hypot(Math.max(box.x0 - d.cx, 0, d.cx - box.x1), Math.max(box.y0 - d.cy, 0, d.cy - box.y1)) < d.r);
    const placed = [...taken];
    const pad = 4;
    for (const n of candidates) {
      const strong = important(n);
      const label = shortTitle(n.title, this.mini ? 26 : strong ? 40 : 30);
      const w = ctx.measureText(label).width;
      const sx = n.x * k + x;
      const sy = (n.y + n.r) * k + y + 4;
      if (sx < -w || sx > this.w + w || sy < -20 || sy > this.h + 20) continue;
      const box = { x0: sx - w / 2 - pad, x1: sx + w / 2 + pad, y0: sy - 2, y1: sy + font + 3 };
      if (placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      if (!strong && covers(box, n)) continue;
      placed.push(box);
      ctx.globalAlpha = lit(n) ? 1 : 0.3;
      // An opaque pill behind the title keeps it readable over the links.
      ctx.fillStyle = isDark ? 'rgba(17,20,26,.92)' : 'rgba(255,255,255,.94)';
      roundRect(ctx, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 6);
      ctx.fill();
      ctx.fillStyle = n === active ? this.colorOf(n.category) : text;
      ctx.fillText(label, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  arrow(ctx, e, color) {
    const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const tipX = e.target.x - ux * (e.target.r + 1.5), tipY = e.target.y - uy * (e.target.r + 1.5);
    const s = 5 / Math.max(0.7, this.transform.k);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * s - uy * s * 0.6, tipY - uy * s + ux * s * 0.6);
    ctx.lineTo(tipX - ux * s + uy * s * 0.6, tipY - uy * s - ux * s * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}
