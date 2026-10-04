// #/graph — every note and every link, coloured by category: find your way in a growing KB.
import { state, h, t, tn, get, icon, empty, loading, clear, catChip, catColor, catDot, localiseCategory, cmdBox } from '../core.js';
import { setTitle, go } from '../main.js';
import { GraphView } from '../graph.js';

const PREFS = 'okb-graph-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* private mode */ }
}

export async function render({ mount, query }) {
  setTitle(t('web.nav.graph'));
  mount.append(loading(3));
  const prefs = { hidden: [], orphans: true, labels: 'auto', groupBy: 'none', area: '', nav: false, depth: 1, ...loadPrefs() };
  let data = await get('/api/graph', prefs.nav ? { nav: 1 } : {});
  clear(mount);
  if (!data.nodes.length) {
    mount.append(empty('🕸️', t('web.graph.emptyTitle'), t('web.graph.emptyText'), h('div', { class: 'stack', style: { width: 'min(460px, 100%)' } }, cmdBox('/okb:ingest'), cmdBox('/okb:onboard'))));
    return;
  }
  const cats = data.categories.map(localiseCategory);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));

  /* ---------- layout ---------- */
  const stage = h('div', { class: 'graph-stage' });
  const panel = h('aside', { class: 'graph-panel card', style: { display: 'none' } });
  const search = h('input', { class: 'input', placeholder: t('web.graph.search'), 'aria-label': t('web.graph.search') });
  const results = h('div', { class: 'graph-results' });
  const stats = h('div', { class: 'small muted' });
  const legend = h('div', { class: 'graph-legend' });
  const areaSelect = h('select', { class: 'input sm', 'aria-label': t('web.graph.area') },
    h('option', { value: '' }, t('web.graph.allAreas')),
    data.areas.map((a) => h('option', { value: a.id, selected: prefs.area === a.id }, `${a.id === '.' ? t('web.notes.root') : a.id} (${a.count})`)));
  const labels = h('select', { class: 'input sm', 'aria-label': t('web.graph.labels') }, ['auto', 'always', 'never'].map((v) => h('option', { value: v, selected: prefs.labels === v }, t(`web.graph.labels.${v}`))));
  const groupBy = h('select', { class: 'input sm', 'aria-label': t('web.graph.group') }, ['none', 'category', 'area'].map((v) => h('option', { value: v, selected: prefs.groupBy === v }, t(`web.graph.group.${v}`))));
  const orphans = h('input', { type: 'checkbox', checked: prefs.orphans });
  const nav = h('input', { type: 'checkbox', checked: prefs.nav });
  const focusBar = h('div', { class: 'graph-focus', style: { display: 'none' } });

  const toolbar = h('div', { class: 'graph-toolbar card' },
    h('div', { class: 'graph-search' }, icon('search', 15), search, results),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      areaSelect, groupBy, labels,
      h('label', { class: 'toggle' }, orphans, t('web.graph.orphans')),
      h('label', { class: 'toggle' }, nav, t('web.graph.nav')),
      h('button', { class: 'btn sm', onclick: () => view.fit(), title: t('web.graph.fit') }, icon('focus', 14), t('web.graph.fit'))),
    focusBar);
  const side = h('div', { class: 'graph-side' }, h('div', { class: 'card' }, h('div', { class: 'nav-label', style: { paddingTop: 0 } }, t('web.graph.legend')), legend, h('div', { class: 'hr' }), stats), panel);
  mount.append(h('div', { class: 'graph-page' }, h('div', { class: 'graph-main' }, toolbar, stage), side));

  /* ---------- the graph ---------- */
  const view = new GraphView(stage, {
    nodes: data.nodes, edges: data.edges, categories: cats,
    onSelect: (n) => (n ? showPanel(n) : hidePanel()),
    onOpen: (n) => go(`#/note/${encodeURIComponent(n.id)}`),
  });
  view.filter.hidden = new Set(prefs.hidden);
  view.filter.orphans = prefs.orphans;
  view.filter.area = prefs.area || null;
  view.filter.depth = prefs.depth;
  view.options.labels = prefs.labels;
  view.options.groupBy = prefs.groupBy;
  await view.ready;

  const persist = () => savePrefs({ hidden: [...view.filter.hidden], orphans: view.filter.orphans, labels: view.options.labels, groupBy: view.options.groupBy, area: view.filter.area ?? '', nav: prefs.nav, depth: view.filter.depth });

  function drawLegend() {
    clear(legend);
    for (const c of cats) {
      if (!c.count) continue;
      const off = view.filter.hidden.has(c.id);
      legend.append(h('button', { class: `legend-item${off ? ' off' : ''}`, title: c.about, onclick: () => {
        if (off) view.filter.hidden.delete(c.id); else view.filter.hidden.add(c.id);
        view.setFilter({});
        persist(); drawLegend(); drawStats();
      } }, catDot(c, 10), h('span', { class: 'grow' }, `${c.emoji} ${c.name}`), h('span', { class: 'muted small' }, String(c.count))));
    }
    const only = h('div', { class: 'row small', style: { gap: '10px', marginTop: '6px' } },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); view.filter.hidden.clear(); view.setFilter({}); persist(); drawLegend(); drawStats(); } }, t('web.graph.showAll')),
      h('a', { href: '#/categories' }, t('web.graph.aboutCategories')));
    legend.append(only);
  }

  function drawStats() {
    const { nodes, edges } = view.visible();
    const linked = new Set(edges.flatMap((e) => [e.source.id ?? e.source, e.target.id ?? e.target]));
    const lonely = nodes.filter((n) => !linked.has(n.id)).length;
    clear(stats).append(...[
      h('div', null, `${tn('web.graph.notes', nodes.length)} · ${tn('web.graph.links', edges.length)}`),
      lonely ? h('div', null, tn('web.graph.lonely', lonely)) : null,
      data.unresolved ? h('div', null, tn('web.graph.unresolved', data.unresolved)) : null,
      h('div', { style: { marginTop: '6px' } }, t('web.graph.hint')),
    ].filter(Boolean));
  }

  function showPanel(n) {
    const c = cats.find((x) => x.id === n.category);
    const neigh = [...(view.adj.get(n.id) ?? [])].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
    panel.style.display = 'block';
    clear(panel).append(...[
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        catChip(c),
        h('button', { class: 'btn icon ghost sm', title: t('web.close'), onclick: () => { view.selected = null; view.draw(); hidePanel(); } }, icon('x', 14))),
      h('h3', { style: { margin: '10px 0 4px' } }, n.title),
      n.description ? h('p', { class: 'small muted', style: { margin: '0 0 8px' } }, n.description) : null,
      h('div', { class: 'small muted mono', style: { wordBreak: 'break-all' } }, n.id),
      h('div', { class: 'row small', style: { gap: '10px', margin: '8px 0' } }, h('span', null, `↩ ${n.in}`), h('span', null, `→ ${n.out}`), n.status === 'draft' ? h('span', { class: 'badge' }, t('web.graph.draft')) : null),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('a', { class: 'btn sm primary', href: `#/note/${encodeURIComponent(n.id)}` }, icon('notes', 14), t('web.graph.open')),
        h('button', { class: 'btn sm', onclick: () => setFocus(n.id) }, icon('focus', 14), t('web.graph.focus'))),
      neigh.length ? h('div', { style: { marginTop: '12px' } },
        h('div', { class: 'nav-label', style: { padding: '4px 0' } }, tn('web.graph.neighbours', neigh.length)),
        h('div', { class: 'list' }, neigh.slice(0, 40).map((m) => h('div', { class: 'list-item', onclick: () => { view.focusNode(m.id, view.transform.k); showPanel(m); } },
          catDot(cats.find((x) => x.id === m.category), 9), h('span', { class: 'grow small' }, m.title))))) : h('p', { class: 'small muted' }, t('web.graph.alone')),
    ].filter(Boolean));
  }
  function hidePanel() { panel.style.display = 'none'; }

  function setFocus(id) {
    view.setFilter({ focus: id });
    const n = byId.get(id);
    focusBar.style.display = id ? 'flex' : 'none';
    if (id) {
      const depth = h('select', { class: 'input sm' }, [1, 2, 3].map((d) => h('option', { value: d, selected: view.filter.depth === d }, tn('web.graph.depth', d))));
      depth.addEventListener('change', () => { view.setFilter({ depth: Number(depth.value) }); persist(); drawStats(); });
      clear(focusBar).append(icon('focus', 14), h('span', { class: 'small' }, t('web.graph.focused', { title: n?.title ?? id })), depth,
        h('button', { class: 'btn sm ghost', onclick: () => setFocus(null) }, icon('x', 14), t('web.graph.unfocus')));
    }
    drawStats();
  }

  /* ---------- search: type, pick, the graph goes there ---------- */
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    clear(results);
    if (!q) { view.setHighlight(null); return; }
    const hits = data.nodes.filter((n) => `${n.title} ${n.id}`.toLowerCase().includes(q)).slice(0, 8);
    view.setHighlight(hits.map((x) => x.id));
    for (const n of hits) {
      results.append(h('div', { class: 'p-item', onclick: () => { clear(results); search.value = n.title; view.setHighlight(null); if (!view.focusNode(n.id)) { setFocus(n.id); } showPanel(n); } },
        catDot(cats.find((x) => x.id === n.category), 9), h('span', null, n.title), h('span', { class: 'k mono' }, n.id)));
    }
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') results.querySelector('.p-item')?.click(); if (e.key === 'Escape') { search.value = ''; clear(results); view.setHighlight(null); } });

  areaSelect.addEventListener('change', () => { view.setFilter({ area: areaSelect.value || null }); persist(); drawStats(); });
  labels.addEventListener('change', () => { view.setOptions({ labels: labels.value }); persist(); });
  groupBy.addEventListener('change', () => { view.setOptions({ groupBy: groupBy.value }); persist(); });
  orphans.addEventListener('change', () => { view.setFilter({ orphans: orphans.checked }); persist(); drawStats(); });
  nav.addEventListener('change', async () => { prefs.nav = nav.checked; persist(); go(`#/graph?r=${Date.now()}`); });

  drawLegend();
  drawStats();
  const focus = query?.get('focus');
  if (focus && byId.has(focus)) { setFocus(focus); showPanel(byId.get(focus)); }
  void state; void catColor;
}
