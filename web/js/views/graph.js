// #/graph — every note and every link, coloured by category: find your way in a growing KB.
import { state, h, t, tn, get, icon, empty, loading, clear, catChip, catColor, catDot, localiseCategory, cmdBox } from '../core.js';
import { setTitle, go } from '../main.js';
import { GraphView, shortTitle } from '../graph.js';

const PREFS = 'okb-graph-prefs-v2';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* private mode */ }
}

export async function render({ mount, query }) {
  // A brain is seen from above first: drawers and products, then a click goes down one level.
  if (query?.get('brain') === '1' || (state.session?.kbs?.find((k) => k.id === state.kb)?.brain && !query?.get('notes') && !query?.get('focus'))) {
    const { renderBrainGraph } = await import('./brain-graph.js');
    return renderBrainGraph({ mount, query: query ?? new URLSearchParams() });
  }
  setTitle(t('web.nav.graph'));
  mount.append(loading(3));
  const prefs = { hidden: [], orphans: true, labels: 'auto', groupBy: 'theme', area: '', nav: false, depth: 1, mode: '', ...loadPrefs() };
  let data = await get('/api/graph', prefs.nav ? { nav: 1 } : {});
  clear(mount);
  // A workspace is drawn from above even before its first note.
  if (!data.nodes.length && !data.workspace) {
    mount.append(empty('🕸️', t('web.graph.emptyTitle'), t('web.graph.emptyText'), h('div', { class: 'stack', style: { width: 'min(460px, 100%)' } }, cmdBox('/okb:ingest'), cmdBox('/okb:onboard'))));
    return;
  }
  const cats = data.categories.map(localiseCategory);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  // A workspace KB: also seen from above, one disc per repository.
  const ws = data.workspace ?? null;
  let mode = ws ? (prefs.mode || 'overview') : 'notes';

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
  const groupBy = h('select', { class: 'input sm', 'aria-label': t('web.graph.group') }, ['theme', 'category', 'area', 'none'].map((v) => h('option', { value: v, selected: prefs.groupBy === v }, t(`web.graph.group.${v}`))));
  const orphans = h('input', { type: 'checkbox', checked: prefs.orphans });
  const nav = h('input', { type: 'checkbox', checked: prefs.nav });
  const focusBar = h('div', { class: 'graph-focus', style: { display: 'none' } });
  const overStage = h('div', { class: 'graph-stage', style: { display: 'none' } });
  const modeSwitch = ws ? h('div', { class: 'segmented' },
    h('button', { 'data-mode': 'overview', onclick: () => setMode('overview') }, `🗂️ ${t('web.graph.ws.overview')}`),
    h('button', { 'data-mode': 'notes', onclick: () => setMode('notes') }, `🕸️ ${t('web.graph.ws.notes')}`)) : null;
  const scopeSelect = ws ? h('select', { class: 'input sm', 'aria-label': t('web.graph.ws.scope'), title: t('web.graph.ws.scopeHelp') },
    h('option', { value: '' }, t('web.graph.ws.noScope')),
    ws.repos.map((r) => h('option', { value: r.id, selected: r.id === ws.scope.repo }, `🎯 ${r.name}`))) : null;

  const toolbar = h('div', { class: 'graph-toolbar card' },
    modeSwitch,
    h('div', { class: 'graph-search notes-only' }, icon('search', 15), search, results),
    h('div', { class: 'row notes-only', style: { gap: '8px', flexWrap: 'wrap' } },
      scopeSelect, areaSelect, groupBy, labels,
      h('label', { class: 'toggle' }, orphans, t('web.graph.orphans')),
      h('label', { class: 'toggle' }, nav, t('web.graph.nav')),
      h('button', { class: 'btn sm', onclick: () => { view.setHighlight(null); view.autoFit = false; view.fit(); }, title: t('web.graph.fit') }, icon('focus', 14), t('web.graph.fit'))),
    focusBar);
  const themes = h('div', { class: 'graph-legend' });
  const overInfo = ws ? h('div', { class: 'card over-only' }) : null;
  const side = h('div', { class: 'graph-side' },
    overInfo,
    h('div', { class: 'card notes-only' }, h('div', { class: 'nav-label', style: { paddingTop: 0 } }, t('web.graph.legend')), legend, h('div', { class: 'hr' }), stats),
    data.communities?.length ? h('div', { class: 'card notes-only' }, h('div', { class: 'nav-label', style: { paddingTop: 0 } }, t('web.graph.themes')),
      h('div', { class: 'small muted', style: { marginBottom: '8px' } }, t('web.graph.themesIntro')), themes,
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, t(data.modularity >= 0.3 ? 'web.graph.themesClear' : 'web.graph.themesMixed', { q: String(data.modularity).replace('.', state.lang === 'fr' ? ',' : '.') }))) : null,
    panel);
  mount.append(h('div', { class: 'graph-page' }, h('div', { class: 'graph-main' }, toolbar, stage, overStage), side));

  /* ---------- the graph ---------- */
  const view = new GraphView(stage, {
    nodes: data.nodes, edges: data.edges, categories: cats, communities: data.communities,
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

  const persist = () => savePrefs({ hidden: [...view.filter.hidden], orphans: view.filter.orphans, labels: view.options.labels, groupBy: view.options.groupBy, area: view.filter.area ?? '', nav: prefs.nav, depth: view.filter.depth, mode: ws ? mode : prefs.mode });

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

  // Detected themes, each with what it holds: click one to frame it and light it up.
  for (const c of (data.communities ?? []).slice(0, 12)) {
    const members = data.nodes.filter((n) => n.community === c.id);
    const shown = members
      .filter((n) => c.namedBy === 'tag' || n.id !== c.hub)
      .sort((a, b) => (b.in + b.out) - (a.in + a.out) || a.title.localeCompare(b.title))
      .map((n) => shortTitle(n.title, 60));
    const preview = shown.length > 4 ? `${shown.slice(0, 4).join(', ')} ${t('web.graph.themeMore', { n: String(shown.length - 4) })}` : shown.join(', ');
    const why = c.namedBy === 'tag' ? t('web.graph.themeByTag', { tag: c.tag ?? '' }) : t('web.graph.themeByNote', { title: byId.get(c.hub)?.title ?? c.label });
    themes.append(h('button', { class: 'legend-item theme-item', title: why, onclick: () => { view.focusGroup(members.map((n) => n.id)); showPanel(byId.get(c.hub)); } },
      h('span', { class: 'theme-dot' }),
      h('span', { class: 'grow theme-text' }, h('span', { class: 'theme-name' }, c.label), preview ? h('span', { class: 'theme-members' }, preview) : null),
      h('span', { class: 'muted small' }, String(c.size))));
  }

  /* ---------- the workspace, from above ---------- */
  const isRepoArea = (area) => typeof area === 'string' && area.startsWith('repos/') && ws?.repos.some((r) => r.area === area);
  let over = null;

  /** One disc per repository and per shared folder; code connections and note links between them. */
  function overviewData() {
    const repoByArea = new Map(ws.repos.map((r) => [r.area, r]));
    const groupOf = (area) => (repoByArea.has(area) ? `repo:${repoByArea.get(area).id}` : `area:${area}`);
    const nodes = ws.repos.map((r) => ({ id: `repo:${r.id}`, title: r.name, category: r.ownKb ? 'ws-attached' : 'ws-repo', area: r.area, weight: r.notes, community: -1, in: 0, out: 0, repo: r }));
    const shared = new Map();
    for (const n of data.nodes) if (!n.reserved && !repoByArea.has(n.area)) shared.set(n.area, (shared.get(n.area) ?? 0) + 1);
    for (const [area, count] of shared) nodes.push({ id: `area:${area}`, title: area === '.' ? t('web.notes.root') : area === 'repos' ? t('web.graph.ws.map') : area, category: 'ws-shared', area, weight: count, community: -1, in: 0, out: 0 });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [];
    const seen = new Set();
    for (const e of ws.edges) {
      const a = `repo:${e.from}`, b = `repo:${e.to}`;
      if (ids.has(a) && ids.has(b) && !seen.has(`${a}>${b}`)) { seen.add(`${a}>${b}`); edges.push({ source: a, target: b, kind: 'code', label: e.label }); }
    }
    for (const e of data.edges) {
      const sa = byId.get(e.source.id ?? e.source)?.area, ta = byId.get(e.target.id ?? e.target)?.area;
      if (sa === undefined || ta === undefined) continue;
      const a = groupOf(sa), b = groupOf(ta);
      if (a === b || !ids.has(a) || !ids.has(b) || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      edges.push({ source: a, target: b, kind: 'link' });
    }
    return { nodes, edges };
  }

  function buildOverview() {
    const { nodes, edges } = overviewData();
    const overCats = [
      { id: 'ws-repo', color: '#0d9488', colorDark: '#2dd4bf', emoji: '📦', name: t('web.graph.ws.repos') },
      { id: 'ws-attached', color: '#d97706', colorDark: '#fbbf24', emoji: '🔗', name: t('web.graph.ws.attached') },
      { id: 'ws-shared', color: '#6366f1', colorDark: '#a5b4fc', emoji: '📚', name: t('web.graph.ws.shared') },
    ];
    const g = new GraphView(overStage, { nodes, edges, categories: overCats, onSelect: (n) => (n ? showOverPanel(n) : hidePanel()), onOpen: (n) => openArea(n.area) });
    g.options.groupBy = 'none';
    g.options.labels = 'always';
    g.options.arrows = true;
    // The repository in scope wears a ring; every name stays readable.
    if (ws.scope.repo) g.ready.then(() => g.setRinged([`repo:${ws.scope.repo}`]));
    return g;
  }

  /** The notes of one repository or shared folder, in the notes view. */
  function openArea(area) {
    setMode('notes');
    areaSelect.value = area;
    view.setFilter({ area });
    persist(); drawStats();
  }

  /** Light up a repository, the shared notes tied to it and the repositories it talks to; dim the rest. */
  function applyScope(id) {
    if (!ws || !id) { view.setHighlight(null); return; }
    const area = `repos/${id}`;
    const mine = new Set(data.nodes.filter((n) => n.area === area).map((n) => n.id));
    const tied = new Set(id === ws.scope.repo ? ws.scope.tied : []);
    for (const e of data.edges) {
      const s = e.source.id ?? e.source, t2 = e.target.id ?? e.target;
      if (mine.has(s) && !isRepoArea(byId.get(t2)?.area)) tied.add(t2);
      if (mine.has(t2) && !isRepoArea(byId.get(s)?.area)) tied.add(s);
    }
    const near = new Set(ws.edges.filter((e) => e.from === id || e.to === id).map((e) => `repos/${e.from === id ? e.to : e.from}`));
    const neighbours = data.nodes.filter((n) => near.has(n.area)).map((n) => n.id);
    view.setHighlight([...mine, ...tied, ...neighbours]);
  }

  function showOverPanel(n) {
    panel.style.display = 'block';
    if (n.repo) {
      const r = n.repo;
      const calls = ws.edges.filter((e) => e.from === r.id).map((e) => `${ws.repos.find((x) => x.id === e.to)?.name ?? e.to} (${e.label})`);
      const callers = ws.edges.filter((e) => e.to === r.id).map((e) => `${ws.repos.find((x) => x.id === e.from)?.name ?? e.from} (${e.label})`);
      const tickets = ws.tickets.filter((tk) => tk.status === 'active' && tk.repos.includes(r.id));
      clear(panel).append(...[
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'badge' }, r.ownKb ? `🔗 ${t('web.graph.ws.attached')}` : `📦 ${t('web.graph.ws.repo')}`),
          h('button', { class: 'btn icon ghost sm', title: t('web.close'), onclick: hidePanel }, icon('x', 14))),
        h('h3', { style: { margin: '10px 0 4px' } }, r.name),
        h('div', { class: 'small muted' }, r.ownKb ? t('web.graph.ws.ownKb', { kb: r.ownKb }) : tn('web.graph.notes', r.notes)),
        calls.length ? h('div', { class: 'small', style: { marginTop: '8px' } }, h('span', { class: 'muted' }, `${t('web.graph.ws.calls')} `), calls.join(', ')) : null,
        callers.length ? h('div', { class: 'small', style: { marginTop: '4px' } }, h('span', { class: 'muted' }, `${t('web.graph.ws.calledBy')} `), callers.join(', ')) : null,
        tickets.length ? h('div', { class: 'small', style: { marginTop: '8px' } }, tickets.map((tk) => h('div', null, `🎫 ${tk.ref}${tk.title !== tk.ref ? ` · ${tk.title}` : ''}`))) : null,
        r.ownKb ? null : h('div', { class: 'row', style: { gap: '6px', marginTop: '10px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm primary', onclick: () => openArea(r.area) }, icon('notes', 14), t('web.graph.ws.showNotes')),
          h('button', { class: 'btn sm', onclick: () => { setMode('notes'); if (scopeSelect) scopeSelect.value = r.id; applyScope(r.id); } }, icon('focus', 14), t('web.graph.ws.emphasise'))),
      ].filter(Boolean));
      return;
    }
    clear(panel).append(
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'badge' }, `📚 ${t('web.graph.ws.shared')}`), h('button', { class: 'btn icon ghost sm', title: t('web.close'), onclick: hidePanel }, icon('x', 14))),
      h('h3', { style: { margin: '10px 0 4px' } }, n.title),
      h('div', { class: 'small muted' }, tn('web.graph.notes', n.weight)),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm primary', onclick: () => openArea(n.area) }, icon('notes', 14), t('web.graph.ws.showNotes'))));
  }

  function drawOverInfo() {
    if (!overInfo) return;
    const active = ws.tickets.filter((tk) => tk.status === 'active');
    clear(overInfo).append(
      h('div', { class: 'nav-label', style: { paddingTop: 0 } }, `🗂️ ${ws.name}`),
      h('div', { class: 'small muted', style: { marginBottom: '8px' } }, t('web.graph.ws.intro')),
      h('div', { class: 'graph-legend' }, [['ws-repo', '📦', 'web.graph.ws.repos'], ['ws-attached', '🔗', 'web.graph.ws.attached'], ['ws-shared', '📚', 'web.graph.ws.shared']].map(([, e, k]) => h('div', { class: 'legend-item' }, h('span', { class: 'grow' }, `${e} ${t(k)}`)))),
      h('div', { class: 'hr' }),
      h('div', { class: 'nav-label', style: { padding: '4px 0' } }, `🎫 ${t('web.graph.ws.tickets')}`),
      active.length ? h('div', { class: 'stack', style: { gap: '4px' } }, active.map((tk) => h('div', { class: 'small' }, h('strong', null, tk.ref), tk.title !== tk.ref ? ` · ${tk.title}` : '', h('span', { class: 'muted' }, ` (${tk.repos.join(', ')})`)))) : h('div', { class: 'small muted' }, t('web.graph.ws.noTickets')),
      ws.scope.repo ? h('div', { class: 'small', style: { marginTop: '10px' } }, `🎯 ${t('web.graph.ws.inScope', { repo: ws.repos.find((r) => r.id === ws.scope.repo)?.name ?? ws.scope.repo })}`) : null);
  }

  function setMode(next) {
    mode = next;
    stage.style.display = mode === 'notes' ? '' : 'none';
    overStage.style.display = mode === 'overview' ? '' : 'none';
    for (const el of mount.querySelectorAll('.notes-only')) el.style.display = mode === 'notes' ? '' : 'none';
    for (const el of mount.querySelectorAll('.over-only')) el.style.display = mode === 'overview' ? '' : 'none';
    for (const b of modeSwitch?.querySelectorAll('button') ?? []) b.classList.toggle('on', b.dataset.mode === mode);
    hidePanel();
    if (mode === 'overview' && !over) over = buildOverview();
    persist();
  }
  if (scopeSelect) scopeSelect.addEventListener('change', () => applyScope(scopeSelect.value));

  drawLegend();
  drawStats();
  if (ws) {
    drawOverInfo();
    setMode(mode);
    if (ws.scope.repo) applyScope(ws.scope.repo);
  }
  const focus = query?.get('focus');
  if (focus && byId.has(focus)) { if (ws) setMode('notes'); setFocus(focus); showPanel(byId.get(focus)); }
  void state; void catColor;
}
