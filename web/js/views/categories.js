// #/categories — the kinds of notes in this KB: what goes where, with which template, in which colour.
import { h, t, tn, get, icon, loading, clear, catDot, catColor, localiseCategory, cmdBox } from '../core.js';
import { setTitle, go } from '../main.js';

export async function render({ mount }) {
  setTitle(t('web.nav.categories'));
  mount.append(loading(4));
  const data = await get('/api/categories');
  const cats = data.categories.map(localiseCategory);
  const total = cats.reduce((n, c) => n + c.count, 0);
  clear(mount);
  mount.append(h('p', { class: 'lead muted' }, t('web.categories.lead')));
  if (total) {
    mount.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('b', null, tn('web.graph.notes', total)), h('a', { class: 'btn sm', href: '#/graph' }, icon('graph', 14), t('web.categories.seeGraph'))),
      h('div', { class: 'cat-bar' }, cats.filter((c) => c.count).map((c) => h('span', { title: `${c.name} : ${c.count}`, style: { width: `${(c.count / total) * 100}%`, background: catColor(c) } })))));
  }
  mount.append(h('div', { class: 'grid cols-2' }, cats.filter((c) => c.id !== 'other' || c.count).map((c) => h('div', { class: 'card', style: { borderTop: `3px solid ${catColor(c)}` } },
    h('div', { class: 'card-head' }, catDot(c, 12), h('h2', null, `${c.emoji} ${c.name}`), h('span', { class: 'spacer' }), h('span', { class: 'badge' }, String(c.count))),
    h('p', { class: 'muted', style: { marginTop: 0 } }, c.about),
    c.templates.length ? h('div', { class: 'stack', style: { gap: '6px' } },
      h('div', { class: 'nav-label', style: { padding: 0 } }, t('web.categories.templates')),
      c.templates.map((tpl) => h('div', { class: 'row small', style: { gap: '8px' } }, h('code', null, tpl.id), h('span', { class: 'muted' }, tpl.label), h('span', { class: 'spacer' }), h('span', { class: 'mono muted' }, `${tpl.folder}/`)))) : null,
    c.count ? h('div', { style: { marginTop: '10px' } }, h('a', { href: '#/graph', onclick: () => { try { const p = JSON.parse(localStorage.getItem('okb-graph-prefs') || '{}'); p.hidden = cats.filter((x) => x.id !== c.id).map((x) => x.id); localStorage.setItem('okb-graph-prefs', JSON.stringify(p)); } catch { /* ignore */ } } }, t('web.categories.onlyThese'))) : null))));
  if (data.uncategorized.length) {
    mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('alert', 17), h('h2', null, tn('web.categories.uncategorized', data.uncategorized.length))),
      h('p', { class: 'muted', style: { marginTop: 0 } }, t('web.categories.uncategorizedHow')),
      h('div', { class: 'list' }, data.uncategorized.slice(0, 20).map((n) => h('div', { class: 'list-item', onclick: () => go(`#/note/${encodeURIComponent(n.path)}`) }, h('span', { class: 'grow' }, n.title), h('span', { class: 'small muted mono' }, n.path))))));
  }
  mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'card flat' },
    h('div', { class: 'card-head' }, icon('settings', 17), h('h2', null, t('web.categories.customTitle'))),
    h('p', { class: 'muted', style: { marginTop: 0 } }, t('web.categories.customText')),
    cmdBox('.okb/categories.yaml')));
}
