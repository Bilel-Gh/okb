// #/versions/<note> — every version of a note OKB kept (no Git needed), one click to read it, one to restore it.
import { h, t, get, post, icon, loading, clear, errorToast, empty, fmtDate } from '../core.js';
import { setTitle, go } from '../main.js';
import { enhance } from './notes.js';

export async function render({ arg, mount }) {
  const path = arg;
  setTitle(t('web.versions.title'), path.split('/').pop());
  mount.append(loading(4));
  const data = await get('/api/history', { path });
  clear(mount);
  mount.append(h('div', { class: 'row small muted', style: { marginBottom: '10px' } }, h('a', { href: `#/note/${encodeURIComponent(path)}` }, `← ${path}`)));
  if (!data.versions.length) { mount.append(empty('🕰️', t('web.versions.noneTitle'), t('history.none'))); return; }
  const reader = h('div', { class: 'card' }, h('div', { class: 'small muted' }, t('web.versions.pick')));
  const list = h('div', { class: 'list' }, data.versions.map((v) => h('div', { class: 'list-item', role: 'button', tabindex: '0', onclick: async () => {
    clear(reader).append(loading(4));
    const one = await get('/api/history', { path, n: v.n });
    const article = h('article', { class: 'reader', html: one.html ?? '' });
    await enhance(article);
    clear(reader).append(h('div', { class: 'row', style: { marginBottom: '10px' } }, h('b', null, `#${v.n} · ${t(`history.action.${v.action}`)} · ${fmtDate(v.at)}`), h('span', { class: 'spacer' }),
      v.action !== 'current' ? h('button', { class: 'btn sm primary', onclick: async () => { try { const r = await post('/api/history/restore', { path, n: v.n }); if (r.proposalId) go(`#/proposal/${r.proposalId}`); } catch (e) { errorToast(e); } } }, icon('undo', 14), t('web.versions.restore')) : null), article);
  } }, h('span', null, '🕰️'), h('div', { class: 'grow' }, `#${v.n} · ${t(`history.action.${v.action}`)}`, h('div', { class: 'small muted' }, `${fmtDate(v.at)}${v.path !== path ? ` · ${v.path}` : ''}`)))));
  mount.append(h('div', { class: 'grid cols-2' }, h('div', { class: 'card' }, list), reader));
}
