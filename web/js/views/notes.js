import { state, h, t, get, post, icon, badge, copy, empty, loading, errorToast, TYPE_ICON } from '../core.js';
import { setTitle, go } from '../main.js';

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

function tree(notes, current, filter) {
  const q = filter.trim().toLowerCase();
  const groups = new Map();
  for (const n of notes) {
    if (q && !`${n.title} ${n.path} ${n.description}`.toLowerCase().includes(q)) continue;
    const folder = n.path.includes('/') ? n.path.split('/')[0] : '';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(n);
  }
  const box = h('div', { class: 'tree' });
  for (const [folder, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    box.append(h('div', { class: 'folder' }, folder || t('web.notes.root')));
    for (const n of items.sort((a, b) => (a.path.endsWith('index.md') ? -1 : 0) - (b.path.endsWith('index.md') ? -1 : 0) || a.title.localeCompare(b.title))) {
      box.append(h('a', { href: `#/note/${encodeURIComponent(n.path)}`, class: n.path === current ? 'active' : '', title: n.path },
        h('span', null, TYPE_ICON[n.type] ?? '📄'), h('span', null, n.title)));
    }
  }
  if (!box.children.length) box.append(h('div', { class: 'muted small', style: { padding: '8px' } }, t('web.notes.noMatch')));
  return box;
}

export async function render({ view, arg, mount }) {
  setTitle(t('web.nav.notes'));
  mount.append(loading());
  const { notes } = await get('/api/notes');
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
  const drawTree = () => treeBox.replaceChildren(tree(notes, path, filter.value));
  filter.addEventListener('input', drawTree);
  drawTree();
  const side = h('div', { class: 'side-panel card flat', style: { padding: '12px' } }, filter, treeBox);
  const readerCol = h('div', null, loading(8));
  mount.append(h('div', { class: 'split' }, side, readerCol));

  try {
    const note = await get('/api/note', { path });
    setTitle(note.title, t('web.nav.notes'));
    const article = h('article', { class: 'reader', html: note.html });
    const outline = await enhance(article);
    if (!article.querySelector('h1')) article.prepend(h('h1', null, note.title));
    const head = h('div', { class: 'note-head' },
      badge(`${TYPE_ICON[note.type] ?? '📄'} ${note.type}`, 'brand'),
      badge(note.status, note.status === 'stable' ? 'ok' : ''),
      note.sources ? badge(`📌 ${note.sources} ${t('web.notes.sources')}`) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => post('/api/open', { path }).catch(errorToast) }, icon('external', 14), t('web.notes.openObsidian')),
      h('button', { class: 'btn sm ghost', onclick: () => copy(path), title: t('web.copy') }, icon('copy', 14), path));
    const back = note.backlinks.length ? h('div', { class: 'card flat', style: { marginTop: '28px' } },
      h('h3', null, `↩ ${t('web.notes.backlinks')} (${note.backlinks.length})`),
      h('div', { class: 'row' }, note.backlinks.map((b) => h('a', { class: 'badge', href: `#/note/${encodeURIComponent(b.path)}` }, b.title)))) : null;
    const toc = outline.length > 3 ? h('div', { class: 'toc-col' }, h('div', { class: 'side-panel' },
      h('div', { class: 'nav-label' }, t('web.notes.onThisPage')),
      h('div', { class: 'toc' }, outline.map((o) => h('a', { class: o.level === 3 ? 'l3' : '', href: '#', onclick: (e) => { e.preventDefault(); document.getElementById(o.id)?.scrollIntoView({ behavior: 'smooth' }); } }, o.text))))) : h('div', { class: 'toc-col' });
    readerCol.replaceChildren(h('div', { class: `reader-layout${toc.childElementCount ? '' : ' solo'}` }, h('div', null, head, article, back), toc));
    if (anchor) {
      const target = [...article.querySelectorAll('h1,h2,h3,h4')].find((x) => x.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').includes(decodeURIComponent(anchor).toLowerCase()));
      target?.scrollIntoView({ block: 'start' });
    }
  } catch (e) {
    readerCol.replaceChildren(empty('🔎', e?.body?.title ?? t('code.E_NOT_FOUND.title'), path, h('button', { class: 'btn', onclick: () => go('#/notes') }, t('web.notes.backHome'))));
  }
  void state;
}
