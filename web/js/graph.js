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
    this.options = { labels: 'auto', groupBy: 'none', arrows: false };
    this.transform = { k: 1, x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    this.highlight = null;
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

  rebuild(first) {
    if (!this.d3) return;
    const d3 = this.d3;
    const previous = new Map((this.nodes ?? []).map((n) => [n.id, n]));
    const { nodes, edges } = this.visible();
    const count = Math.max(1, nodes.length);
    const spread = Math.sqrt(count) * 28;
    this.nodes = nodes.map((n) => {
      const old = previous.get(n.id) ?? this.allNodes.find((x) => x.id === n.id);
      const a = seed(n.id) * Math.PI * 2;
      const r = spread * (0.3 + seed(`${n.id}#r`) * 0.7);
      return Object.assign(n, { x: old?.x ?? Math.cos(a) * r, y: old?.y ?? Math.sin(a) * r });
    });
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges.map((e) => ({ source: byId.get(e.source.id ?? e.source), target: byId.get(e.target.id ?? e.target), kind: e.kind })).filter((e) => e.source && e.target);
    const degree = new Map();
    for (const e of this.edges) { degree.set(e.source.id, (degree.get(e.source.id) ?? 0) + 1); degree.set(e.target.id, (degree.get(e.target.id) ?? 0) + 1); }
    this.adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (const e of this.edges) { this.adj.get(e.source.id).add(e.target.id); this.adj.get(e.target.id).add(e.source.id); }
    for (const n of this.nodes) { n.degree = degree.get(n.id) ?? 0; n.r = (this.mini ? 4 : 4.5) + Math.sqrt(n.degree) * (this.mini ? 1.6 : 2.2) + (n.id === this.filter.focus ? 3 : 0); }
    this.sim?.stop();
    const sim = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.edges).id((n) => n.id).distance((e) => (this.mini ? 60 : 34) + Math.min(40, (e.source.r + e.target.r) * 1.6)).strength((e) => 0.9 / Math.min(degree.get(e.source.id) ?? 1, degree.get(e.target.id) ?? 1)))
      .force('charge', d3.forceManyBody().strength(this.mini ? -110 : -150).distanceMax(600))
      .force('collide', d3.forceCollide().radius((n) => n.r + 3))
      .force('x', d3.forceX(0).strength(this.nodes.length > 300 ? 0.06 : 0.04))
      .force('y', d3.forceY(0).strength(this.nodes.length > 300 ? 0.06 : 0.04))
      .alphaDecay(this.nodes.length > 800 ? 0.035 : 0.025);
    if (this.options.groupBy !== 'none') {
      const key = this.options.groupBy === 'category' ? 'category' : 'area';
      const groups = [...new Set(this.nodes.map((n) => n[key]))];
      const radius = Math.max(120, Math.sqrt(count) * 40);
      const anchor = new Map(groups.map((g, i) => [g, { x: Math.cos((i / groups.length) * Math.PI * 2) * radius, y: Math.sin((i / groups.length) * Math.PI * 2) * radius }]));
      sim.force('x', d3.forceX((n) => anchor.get(n[key]).x).strength(0.12)).force('y', d3.forceY((n) => anchor.get(n[key]).y).strength(0.12));
    }
    sim.on('tick', () => { if (this.autoFit) this.fit(); else this.draw(); });
    this.sim = sim;
    if (first) for (let i = 0; i < 120; i++) sim.tick();
    if (!first) this.autoFit = true;
    this.fit();
    sim.alpha(first ? 0.3 : 0.6).restart();
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

    // Links first, under the dots.
    ctx.lineWidth = 1 / Math.max(0.6, k);
    for (const e of this.edges) {
      const on = active && (e.source === active || e.target === active);
      const dim = (active && !on) || (this.highlight && !(this.highlight.has(e.source.id) && this.highlight.has(e.target.id)));
      ctx.strokeStyle = on ? this.colorOf(active.category) : `${line}${dim ? 0.08 : 0.32})`;
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
      if (n === this.selected || n.id === this.filter.focus) {
        ctx.lineWidth = 2.5 / k;
        ctx.strokeStyle = text;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Labels: on the notes that matter at this zoom, always on the active neighbourhood.
    const mode = this.options.labels;
    if (mode !== 'never') {
      const size = 12 / k;
      ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of this.nodes) {
        const important = n === active || (near && near.has(n.id)) || n.id === this.filter.focus;
        const show = mode === 'always' || important || (!active && (k > 1.15 || n.r * k > 9 || this.mini));
        if (!show || (!important && !marked(n))) continue;
        const label = n.title.length > 42 ? `${n.title.slice(0, 40)}…` : n.title;
        ctx.globalAlpha = lit(n) ? 1 : 0.25;
        ctx.lineWidth = 3 / k;
        ctx.strokeStyle = isDark ? 'rgba(15,17,21,.85)' : 'rgba(255,255,255,.9)';
        ctx.strokeText(label, n.x, n.y + n.r + 3 / k);
        ctx.fillStyle = text;
        ctx.fillText(label, n.x, n.y + n.r + 3 / k);
      }
      ctx.globalAlpha = 1;
    }
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
