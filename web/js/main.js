// OKB web app shell: boot, sidebar, router, KB switcher, command palette, theme.
import { state, h, t, get, post, icon, clear, overlay, errorToast, toast } from './core.js';

const VIEWS = {
  home: () => import('./views/home.js'),
  notes: () => import('./views/notes.js'),
  note: () => import('./views/notes.js'),
  repos: () => import('./views/repos.js'),
  graph: () => import('./views/graph.js'),
  categories: () => import('./views/categories.js'),
  repo: () => import('./views/repos.js'),
  search: () => import('./views/search.js'),
  review: () => import('./views/review.js'),
  proposal: () => import('./views/review.js'),
  history: () => import('./views/review.js'),
  inbox: () => import('./views/inbox.js'),
  focus: () => import('./views/focus.js'),
  weekly: () => import('./views/weekly.js'),
  learn: () => import('./views/learn.js'),
  health: () => import('./views/health.js'),
  usage: () => import('./views/usage.js'),
  source: () => import('./views/tools.js'),
  skills: () => import('./views/tools.js'),
  templates: () => import('./views/tools.js'),
  doctor: () => import('./views/tools.js'),
  help: () => import('./views/tools.js'),
  settings: () => import('./views/settings.js'),
  kbs: () => import('./views/kbs.js'),
  newkb: () => import('./views/kbs.js'),
};

const NAV = [
  ['space', [['home', 'home'], ['notes', 'notes'], ['graph', 'graph'], ['repos', 'repo'], ['search', 'search']]],
  ['work', [['review', 'review'], ['inbox', 'inbox'], ['focus', 'focus']]],
  ['rhythm', [['weekly', 'weekly'], ['learn', 'learn']]],
  ['care', [['health', 'health'], ['usage', 'usage'], ['history', 'history'], ['source', 'source'], ['skills', 'skill'], ['templates', 'template']]],
];

let shell, contentEl, titleEl;

export function go(hash) { location.hash = hash; }

function parseRoute() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, query = ''] = raw.split('?');
  const [view = 'home', ...rest] = path.split('/');
  return { view: view || 'home', arg: rest.join('/'), query: new URLSearchParams(query) };
}

export function setTitle(title, crumb) {
  document.title = `${title} · OKB`;
  if (!titleEl) return;
  clear(titleEl).append(crumb ? h('span', null, h('span', { class: 'crumb' }, `${crumb} / `), title) : title);
  document.title = `${title} · OKB`;
}

export async function refreshStatus() {
  try {
    state.status = await get('/api/status');
    renderSidebar();
  } catch { /* the view shows its own error */ }
}

function applyTheme(theme) {
  state.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('okb-theme', theme); } catch { /* private mode */ }
}

function kbMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const close = () => { menu.remove(); document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const menu = h('div', { class: 'dropdown', style: { left: `${r.left}px`, top: `${r.bottom + 6}px`, width: `${r.width}px` } },
    state.session.kbs.map((kb) => h('div', { class: 'd-item', onclick: async () => { close(); await switchKb(kb.id); } },
      h('span', { class: 'kb-avatar', style: { width: '22px', height: '22px', borderRadius: '6px', fontSize: '11px', display: 'grid', placeItems: 'center', color: '#fff', background: 'var(--gradient)' } }, kb.name.slice(0, 1).toUpperCase()),
      h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, kb.name), h('div', { class: 'small muted' }, kb.id)),
      kb.id === state.kb ? h('span', { style: { marginLeft: 'auto', color: 'var(--brand)' } }, icon('check', 16)) : null)),
    h('div', { class: 'd-sep' }),
    h('div', { class: 'd-item', onclick: () => { close(); go('#/newkb'); } }, icon('plus', 16), t('web.kb.new')),
    h('div', { class: 'd-item', onclick: () => { close(); go('#/kbs'); } }, icon('kb', 16), t('web.kb.manage')));
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', outside, true), 0);
}

export async function switchKb(id, makeActive = false) {
  state.kb = id;
  try { localStorage.setItem('okb-kb', id); } catch { /* ignore */ }
  if (makeActive) await post('/api/kb/switch', { id });
  await refreshStatus();
  route();
}

function renderSidebar() {
  const s = state.status;
  const kb = state.session.kbs.find((k) => k.id === state.kb) ?? { name: state.kb, id: state.kb };
  const counts = { review: s?.pending?.length ?? 0, inbox: s?.inbox?.open ?? 0 };
  const { view } = parseRoute();
  const activeView = view === 'note' ? 'notes' : view === 'proposal' ? 'review' : view === 'repo' ? 'repos' : view === 'categories' ? 'graph' : view;
  const nav = NAV.map(([group, items]) => h('div', { class: 'nav-group' },
    h('div', { class: 'nav-label' }, t(`web.nav.group.${group}`)),
    items.map(([id, ico]) => h('a', { class: `nav-item${activeView === id ? ' active' : ''}`, href: `#/${id === 'home' ? '' : id}` },
      icon(ico, 17), t(`web.nav.${id}`),
      counts[id] ? h('span', { class: `count${id === 'review' ? ' hot' : ''}` }, String(counts[id])) : null))));
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo-mark' }), h('span', null, 'OKB ', h('small', null, t('web.tagline')))),
    h('button', { class: 'kb-switch', onclick: (e) => kbMenu(e.currentTarget), title: t('web.kb.switch') },
      h('span', { class: 'kb-avatar' }, String(kb.name).slice(0, 1).toUpperCase()),
      h('span', { style: { minWidth: 0 } }, h('div', { class: 'kb-name' }, kb.name), h('div', { class: 'kb-sub' }, s ? tn2('status.notes', s.notes, { concepts: s.concepts }) : kb.id)),
      h('span', { class: 'chev' }, icon('chevron', 16))),
    nav,
    h('div', { class: 'sidebar-foot' },
      h('a', { class: `nav-item${activeView === 'settings' ? ' active' : ''}`, href: '#/settings' }, icon('settings', 17), t('web.nav.settings')),
      h('a', { class: `nav-item${activeView === 'doctor' ? ' active' : ''}`, href: '#/doctor' }, icon('doctor', 17), t('web.nav.doctor')),
      h('a', { class: `nav-item${activeView === 'help' ? ' active' : ''}`, href: '#/help' }, icon('help', 17), t('web.nav.help')),
      h('div', { class: 'foot-row' },
        h('button', { class: 'btn icon ghost sm', title: t('web.theme'), onclick: () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); renderSidebar(); } }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16)),
        h('button', { class: 'btn sm ghost', title: t('web.language'), onclick: toggleLanguage }, icon('globe', 15), state.lang.toUpperCase()),
        h('span', { class: 'version' }, `v${state.session.version}`))));
  const old = shell.querySelector('.sidebar');
  if (old) old.replaceWith(sidebar); else shell.prepend(sidebar);
}

function tn2(key, n, params) { return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params }); }

async function toggleLanguage() {
  const next = state.lang === 'fr' ? 'en' : 'fr';
  try {
    await post('/api/settings', { key: 'ui.language', value: next });
    location.reload();
  } catch (e) { errorToast(e); }
}

/* ---------- command palette ---------- */
async function palette() {
  const input = h('input', { placeholder: t('web.palette.placeholder'), 'aria-label': t('web.palette.placeholder') });
  const results = h('div', { class: 'results' });
  let notes = [];
  get('/api/notes').then((r) => { notes = r.notes; render(); }).catch(() => undefined);
  const actions = [
    ...NAV.flatMap(([, items]) => items.map(([id]) => ({ group: 'pages', label: t(`web.nav.${id}`), run: () => go(`#/${id === 'home' ? '' : id}`) }))),
    { group: 'pages', label: t('web.nav.settings'), run: () => go('#/settings') },
    { group: 'pages', label: t('web.nav.doctor'), run: () => go('#/doctor') },
    { group: 'pages', label: t('web.nav.help'), run: () => go('#/help') },
    { group: 'actions', label: t('web.action.capture'), run: () => go('#/inbox?new=1') },
    { group: 'actions', label: t('web.action.done'), run: () => go('#/focus?done=1') },
    { group: 'actions', label: t('web.kb.new'), run: () => go('#/newkb') },
    ...state.session.kbs.filter((k) => k.id !== state.kb).map((k) => ({ group: 'actions', label: `${t('web.kb.switchTo')} ${k.name}`, run: () => switchKb(k.id) })),
  ];
  let sel = 0, items = [];
  function render() {
    const q = input.value.trim().toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);
    items = [
      ...actions.filter((a) => match(a.label)),
      ...(q ? notes.filter((n) => match(`${n.title} ${n.path}`)).slice(0, 20).map((n) => ({ group: 'notes', label: n.title, hint: n.path, run: () => go(`#/note/${encodeURIComponent(n.path)}`) })) : []),
      ...(q ? [{ group: 'search', label: `${t('web.palette.searchFor')} « ${input.value.trim()} »`, run: () => go(`#/search?q=${encodeURIComponent(input.value.trim())}`) }] : []),
    ];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    clear(results);
    let last = '';
    items.forEach((it, i) => {
      if (it.group !== last) { results.append(h('div', { class: 'p-group' }, t(`web.palette.${it.group}`))); last = it.group; }
      results.append(h('div', { class: `p-item${i === sel ? ' sel' : ''}`, onclick: () => { close(); it.run(); } }, h('span', null, it.label), it.hint ? h('span', { class: 'k mono' }, it.hint) : null));
    });
  }
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
  });
  const close = overlay(h('div', { class: 'palette' }, input, results));
  render();
  setTimeout(() => input.focus(), 20);
}

/* ---------- router ---------- */
let routeSerial = 0;
export async function route() {
  const serial = ++routeSerial;
  const r = parseRoute();
  shell.classList.remove('menu-open');
  renderSidebar();
  const load = VIEWS[r.view] ?? VIEWS.home;
  clear(contentEl);
  try {
    const mod = await load();
    if (serial !== routeSerial) return;
    await mod.render({ ...r, mount: contentEl, isCurrent: () => serial === routeSerial });
  } catch (e) {
    if (serial !== routeSerial) return;
    const b = e?.body;
    // A network failure (okb serve stopped or restarted) is not a bug: say so, offer a reload.
    const offline = !b && /fetch|import|network|load/i.test(String(e?.message ?? ''));
    const title = offline ? t('web.offline.title') : b?.title ?? t('err.internal.title');
    const message = offline ? t('web.offline.text') : b?.message ?? String(e?.message ?? e);
    clear(contentEl).append(h('div', { class: `note-box err` }, icon('alert', 17), h('div', null, h('b', null, title), h('div', null, message),
      b?.fix ? h('div', { class: 'small', style: { marginTop: '6px' } }, `→ ${b.fix}`) : null,
      b?.detail ? h('div', { class: 'small mono muted', style: { marginTop: '6px' } }, b.detail) : null,
      offline ? h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: () => location.reload() }, t('web.offline.reload')) : null)));
  }
  contentEl.focus?.();
  window.scrollTo(0, 0);
}

async function boot() {
  let theme = 'auto';
  try { theme = localStorage.getItem('okb-theme') || 'auto'; } catch { /* ignore */ }
  applyTheme(theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(state.theme));
  const [session, i18n] = await Promise.all([get('/api/session'), get('/api/i18n')]);
  state.session = session;
  state.messages = i18n.messages;
  state.lang = i18n.lang;
  document.documentElement.lang = state.lang;
  const app = document.getElementById('app');
  app.className = '';
  if (!session.kbs.length) {
    const mod = await import('./views/kbs.js');
    clear(app);
    await mod.onboarding(app);
    return;
  }
  let saved = null;
  try { saved = localStorage.getItem('okb-kb'); } catch { /* ignore */ }
  state.kb = session.kbs.some((k) => k.id === saved) ? saved : session.active;
  titleEl = h('h1');
  contentEl = h('div', { class: 'content', tabindex: '-1' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn icon ghost menu-toggle', onclick: () => shell.classList.toggle('menu-open'), 'aria-label': 'Menu' }, icon('menu')),
    titleEl,
    h('div', { class: 'searchbox', role: 'button', tabindex: '0', onclick: palette, onkeydown: (e) => { if (e.key === 'Enter') palette(); } }, icon('search', 15), h('span', null, t('web.palette.short')), h('kbd', null, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')));
  // After an update, a page served by an older server says so instead of failing oddly.
  const outdated = session.outdated ? h('div', { class: 'note-box warn', style: { margin: '12px 28px 0' } }, icon('alert', 17), h('div', null, t('web.outdated'))) : null;
  shell = h('div', { class: 'shell' }, h('main', { class: 'main' }, topbar, outdated, contentEl));
  clear(app).append(shell);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); palette(); }
  });
  window.addEventListener('hashchange', route);
  await refreshStatus();
  route();
  setInterval(() => { if (document.visibilityState === 'visible') refreshStatus(); }, 30_000);
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || outdated) return;
    try { if ((await get('/api/session')).outdated) location.reload(); } catch { /* server stopped: the view says so */ }
  }, 60_000);
}

boot().catch((e) => {
  const app = document.getElementById('app');
  app.className = 'boot';
  app.replaceChildren(h('div', { class: 'note-box err', style: { maxWidth: '560px' } }, icon('alert'), h('div', null, h('b', null, 'OKB'), h('div', null, e?.body?.message ?? String(e?.message ?? e)))));
});

export { toast };
