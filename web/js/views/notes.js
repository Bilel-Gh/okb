import { state, h, t, tn, get, post, icon, badge, copy, empty, loading, errorToast, toast, TYPE_ICON, catDot, catChip, catOf, catColor, localiseCategory } from '../core.js';
import { setTitle, go } from '../main.js';
import { GraphView } from '../graph.js';

let mermaidLoaded = null;
function loadMermaid() {
  if (!mermaidLoaded) {
    mermaidLoaded = new Promise((done) => {
      const s = document.createElement('script');
      s.src = '/vendor/mermaid.js';
      s.onload = () => { window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral' }); done(window.mermaid); };
      s.onerror = () => done(null);
      document.head.append(s);
    });
  }
  return mermaidLoaded;
}

/** Turn sanitized note HTML into a live reader: diagrams, in-page anchors, outline. */
export async function enhance(article) {
  const codes = [...article.querySelectorAll('code.language-mermaid')];
  if (codes.length) {
    const mermaid = await loadMermaid();
    if (mermaid) {
      for (const [i, code] of codes.entries()) {
        const box = document.createElement('div');
        box.className = 'mermaid';
        try {
          const { svg } = await mermaid.render(`m${Date.now()}${i}`, code.textContent);
          box.innerHTML = svg;
          code.parentElement.replaceWith(box);
        } catch { /* keep the code */ }
      }
    }
  }
  article.querySelectorAll('a[href^="#user-content-"]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    article.querySelector(`[id="${a.getAttribute('href').slice(1)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  article.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  const heads = [...article.querySelectorAll('h2, h3')];
  heads.forEach((hd, i) => { hd.id = `s-${i}`; });
  return heads.map((hd) => ({ id: hd.id, text: hd.textContent, level: hd.tagName === 'H3' ? 3 : 2 }));
}

function tree(notes, current, filter, cats, only) {
  const q = filter.trim().toLowerCase();
  const groups = new Map();
  for (const n of notes) {
    if (q && !`${n.title} ${n.path} ${n.description}`.toLowerCase().includes(q)) continue;
    if (only.size && !only.has(n.category)) continue;
    const folder = n.path.includes('/') ? n.path.split('/')[0] : '';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(n);
  }
  const box = h('div', { class: 'tree' });
  for (const [folder, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    box.append(h('div', { class: 'folder' }, folder || t('web.notes.root')));
    for (const n of items.sort((a, b) => (a.path.endsWith('index.md') ? -1 : 0) - (b.path.endsWith('index.md') ? -1 : 0) || a.title.localeCompare(b.title))) {
      const c = catOf(cats, n.category);
      box.append(h('a', { href: `#/note/${encodeURIComponent(n.path)}`, class: n.path === current ? 'active' : '', title: `${c?.one ?? ''} · ${n.path}` },
        catDot(c, 8), h('span', null, n.title)));
    }
  }
  if (!box.children.length) box.append(h('div', { class: 'muted small', style: { padding: '8px' } }, t('web.notes.noMatch')));
  return box;
}

/** Category chips above the tree: pick the kinds of notes to show. */
function categoryFilter(notes, cats, only, onChange) {
  const counts = new Map();
  for (const n of notes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
  return h('div', { class: 'cat-filter' }, cats.filter((c) => counts.get(c.id)).map((c) => h('button', {
    class: only.has(c.id) ? 'on' : '', style: { '--cat': catColor(c) }, title: c.about,
    onclick: () => { if (only.has(c.id)) only.delete(c.id); else only.add(c.id); onChange(); },
  }, catDot(c, 8), `${c.emoji} ${counts.get(c.id)}`)));
}

/** Pick another category for a note: prepares a proposal, approved like any change. */
function categoryMenu(anchor, path, current, cats) {
  const r = anchor.getBoundingClientRect();
  const close = () => { menu.remove(); document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const pickCategory = async (id) => {
    close();
    try {
      const res = await post('/api/categories/set', { path, category: id });
      toast(t('web.categories.changeProposed'));
      go(`#/proposal/${res.proposalId}`);
    } catch (e) { errorToast(e); }
  };
  const menu = h('div', { class: 'dropdown', style: { left: `${r.left}px`, top: `${r.bottom + 6}px`, minWidth: '240px' } },
    cats.map((c) => h('div', { class: 'd-item', onclick: () => c.id !== current && pickCategory(c.id) }, catDot(c, 10), h('span', null, `${c.emoji} ${c.one}`), c.id === current ? h('span', { style: { marginLeft: 'auto', color: 'var(--brand)' } }, icon('check', 15)) : null)),
    h('div', { class: 'd-sep' }),
    h('div', { class: 'd-item', onclick: () => pickCategory('auto') }, icon('sparkles', 15), t('web.categories.auto')));
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', outside, true), 0);
}

let graphCache = null;
async function kbGraph() {
  if (!graphCache || graphCache.kb !== state.kb || Date.now() - graphCache.at > 30_000) graphCache = { kb: state.kb, at: Date.now(), data: get('/api/graph') };
  return graphCache.data;
}

/** The note and its neighbours, drawn small; click a dot to go there. */
function localGraph(path) {
  const stage = h('div', { class: 'graph-stage mini' });
  const depth = h('select', { class: 'input sm' }, [1, 2].map((d) => h('option', { value: d }, tn('web.graph.depth', d))));
  const card = h('div', { class: 'card flat', style: { marginTop: '16px' } },
    h('div', { class: 'card-head' }, icon('graph', 17), h('h3', { style: { margin: 0 } }, t('web.graph.local')), h('span', { class: 'spacer' }), depth,
      h('a', { class: 'btn sm ghost', href: `#/graph?focus=${encodeURIComponent(path)}` }, t('web.graph.inFull'))),
    stage);
  kbGraph().then(async (data) => {
    if (!data.nodes.some((n) => n.id === path)) { card.remove(); return; }
    const view = new GraphView(stage, { nodes: data.nodes, edges: data.edges, categories: data.categories.map(localiseCategory), mini: true, onSelect: (n) => n && n.id !== path && go(`#/note/${encodeURIComponent(n.id)}`) });
    view.filter.focus = path;
    view.filter.depth = 1;
    view.options.labels = 'always';
    await view.ready;
    depth.addEventListener('change', () => view.setFilter({ depth: Number(depth.value) }));
    if (view.nodes.length <= 1) stage.replaceChildren(h('div', { class: 'muted small', style: { padding: '16px' } }, t('web.graph.alone')));
  }).catch(() => card.remove());
  return card;
}

export async function render({ view, arg, mount }) {
  setTitle(t('web.nav.notes'));
  mount.append(loading());
  const { notes, categories: rawCats } = await get('/api/notes');
  const cats = rawCats.map(localiseCategory);
  const only = new Set();
  mount.replaceChildren();
  if (!notes.length) {
    mount.append(empty('📚', t('web.notes.emptyTitle'), t('web.notes.emptyText'), h('a', { class: 'btn primary', href: '#/source' }, t('web.home.addSource'))));
    return;
  }
  const [rawPath, anchor] = (arg || '').split('::');
  const home = notes.find((n) => n.path === 'accueil.md') ?? notes.find((n) => n.path === 'index.md') ?? notes[0];
  const path = view === 'note' && rawPath ? rawPath : home.path;

  const filter = h('input', { class: 'input', placeholder: t('web.notes.filter'), style: { marginBottom: '8px' } });
  const treeBox = h('div');
  const chipsBox = h('div');
  const drawTree = () => { treeBox.replaceChildren(tree(notes, path, filter.value, cats, only)); chipsBox.replaceChildren(categoryFilter(notes, cats, only, drawTree)); };
  filter.addEventListener('input', drawTree);
  drawTree();
  const side = h('div', { class: 'side-panel card flat', style: { padding: '12px' } }, filter, chipsBox, treeBox);
  const readerCol = h('div', null, loading(8));
  mount.append(h('div', { class: 'split' }, side, readerCol));

  try {
    const note = await get('/api/note', { path });
    setTitle(note.title, t('web.nav.notes'));
    const article = h('article', { class: 'reader', html: note.html });
    const outline = await enhance(article);
    if (!article.querySelector('h1')) article.prepend(h('h1', null, note.title));
    // Words of the note that have a concept card: the card on hover, one click to open it.
    if (note.terms?.length) glossaryHover(article, note.terms);
    const crumbs = note.crumbs?.length ? h('div', { class: 'row small muted', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } },
      h('a', { href: '#/brain' }, '🧠'), note.crumbs.map((c) => [' › ', c.path ? h('a', { href: `#/note/${encodeURIComponent(c.path)}` }, c.title) : c.title])) : null;
    const stars = note.score ? h('span', { class: 'badge', title: `${t('web.score.quality')} ${note.score.quality}/100 · ${t('web.score.value')} ${note.score.value}/100${note.score.young ? ` · ${t('web.score.young')}` : ''}${note.score.notes.length ? `\n• ${note.score.notes.join('\n• ')}` : ''}`, style: { color: 'var(--warn)' } }, `${'★'.repeat(note.score.stars)}${'☆'.repeat(5 - note.score.stars)} ${note.score.global} %`) : null;
    const rate = (verdict) => h('button', { class: 'btn sm ghost', title: t(`web.score.${verdict}`), onclick: async () => { try { await post('/api/rate', { path, verdict }); toast(t('scores.rated')); } catch (e) { errorToast(e); } } }, verdict === 'up' ? '👍' : '👎');
    const chip = h('button', { class: 'chip-btn', title: `${t('web.categories.change')}${note.type ? ` · type ${note.type}` : ''}`, onclick: (e) => categoryMenu(e.currentTarget, path, note.category, cats) }, catChip(catOf(cats, note.category)), icon('chevron', 13));
    const head = h('div', { class: 'note-head' },
      chip,
      badge(note.status, note.status === 'stable' ? 'ok' : ''),
      note.confidentiality === 'secret' ? h('span', { class: 'badge warn', title: t('web.notes.secretHint') }, `🔒 ${t('web.notes.secret')}`) : null,
      note.sources ? badge(`📌 ${note.sources} ${t('web.notes.sources')}`) : null,
      stars, note.score ? rate('up') : null, note.score ? rate('down') : null,
      h('span', { class: 'spacer' }),
      h('a', { class: 'btn sm', href: `#/versions/${encodeURIComponent(path)}` }, icon('history', 14), t('web.notes.versions')),
      h('a', { class: 'btn sm', href: `#/graph?focus=${encodeURIComponent(path)}` }, icon('graph', 14), t('web.graph.see')),
      h('button', { class: 'btn sm', onclick: () => post('/api/open', { path }).catch(errorToast) }, icon('external', 14), t('web.notes.openObsidian')),
      h('button', { class: 'btn sm ghost', onclick: () => copy(path), title: t('web.copy') }, icon('copy', 14), path));
    const linkList = (items) => h('div', { class: 'row', style: { gap: '6px' } }, items.map((b) => h('a', { class: 'badge', href: `#/note/${encodeURIComponent(b.path)}` }, catDot(catOf(cats, b.category), 8), b.title)));
    const back = h('div', null,
      note.backlinks.length || note.outlinks.length ? h('div', { class: 'card flat', style: { marginTop: '28px' } },
        note.backlinks.length ? h('div', null, h('h3', null, `↩ ${t('web.notes.backlinks')} (${note.backlinks.length})`), linkList(note.backlinks)) : null,
        note.outlinks.length ? h('div', { style: { marginTop: note.backlinks.length ? '14px' : 0 } }, h('h3', null, `→ ${t('web.notes.outlinks')} (${note.outlinks.length})`), linkList(note.outlinks)) : null) : null,
      localGraph(path));
    const toc = outline.length > 3 ? h('div', { class: 'toc-col' }, h('div', { class: 'side-panel' },
      h('div', { class: 'nav-label' }, t('web.notes.onThisPage')),
      h('div', { class: 'toc' }, outline.map((o) => h('a', { class: o.level === 3 ? 'l3' : '', href: '#', onclick: (e) => { e.preventDefault(); document.getElementById(o.id)?.scrollIntoView({ behavior: 'smooth' }); } }, o.text))))) : h('div', { class: 'toc-col' });
    readerCol.replaceChildren(h('div', { class: `reader-layout${toc.childElementCount ? '' : ' solo'}` }, h('div', null, crumbs, head, article, back), toc));
    if (anchor) {
      const target = [...article.querySelectorAll('h1,h2,h3,h4')].find((x) => x.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').includes(decodeURIComponent(anchor).toLowerCase()));
      target?.scrollIntoView({ block: 'start' });
    }
  } catch (e) {
    readerCol.replaceChildren(empty('🔎', e?.body?.title ?? t('code.E_NOT_FOUND.title'), path, h('button', { class: 'btn', onclick: () => go('#/notes') }, t('web.notes.backHome'))));
  }
  void state;
}

/** The first occurrence of each known term becomes a link to its card, with its one-line definition on hover. */
function glossaryHover(article, terms) {
  const done = new Set();
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('a, code, pre, h1, h2, h3, h4, .mermaid, svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const term of terms) {
    const words = [term.term, ...(term.aliases ?? [])].filter((w) => w && w.length >= 2).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(esc).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
    for (const node of nodes) {
      if (done.has(term.path) || !node.parentNode) continue;
      const m = re.exec(node.nodeValue ?? '');
      if (!m) continue;
      const start = m.index + m[1].length;
      const after = node.splitText(start);
      after.nodeValue = after.nodeValue.slice(m[2].length);
      node.parentNode.insertBefore(h('a', { class: 'term', href: `#/note/${encodeURIComponent(term.path)}`, title: term.description || term.term }, m[2]), after);
      done.add(term.path);
    }
  }
}
