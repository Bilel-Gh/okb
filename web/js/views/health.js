import { h, t, tn, get, post, icon, loading, noteBox, toast, errorToast } from '../core.js';
import { setTitle, go } from '../main.js';

export async function render({ mount, query }) {
  setTitle(t('web.nav.health'));
  mount.append(loading(6));
  const sources = query.get('sources') === '1';
  const r = await get('/api/health', { sources: sources ? 1 : '' });
  mount.replaceChildren();
  const hh = r.health;
  const color = hh.errors ? 'var(--err)' : hh.warnings ? 'var(--warn)' : 'var(--brand)';
  mount.append(h('div', { class: 'hero row', style: { gap: '22px' } },
    h('div', { class: 'ring', style: { '--v': hh.score, '--ring-color': color } }, h('div', null, String(hh.score))),
    h('div', { class: 'stack', style: { gap: '4px' } },
      h('h2', { style: { margin: 0 } }, t('maintain.title')),
      h('div', { class: 'muted' }, `${tn('maintain.scanned', r.scanned)} · ${r.okf ? t('maintain.conform') : t('maintain.notConform')}`),
      h('div', { class: 'row small' }, h('span', { class: 'badge err' }, tn('status.errors', hh.errors)), h('span', { class: 'badge warn' }, tn('status.warnings', hh.warnings)), h('span', { class: 'badge' }, tn('maintain.infos', hh.infos)))),
    h('span', { class: 'spacer' }),
    h('div', { class: 'stack', style: { gap: '8px' } },
      h('button', { class: 'btn', onclick: async () => {
        try { const out = await post('/api/nav'); if (out.proposalId) { toast(t('web.health.navReady')); go(`#/proposal/${out.proposalId}`); } else toast(t('web.health.navCurrent')); } catch (e) { errorToast(e); }
      } }, icon('notes', 15), t('web.health.nav')),
      h('a', { class: 'btn ghost', href: sources ? '#/health' : '#/health?sources=1' }, icon('source', 15), sources ? t('web.health.noSources') : t('web.health.sources')))));
  mount.append(h('div', { style: { height: '16px' } }));
  if (!r.groups.length) { mount.append(noteBox('ok', t('maintain.clean'))); return; }
  const order = { error: 0, warning: 1, info: 2 };
  for (const g of r.groups.sort((a, b) => (order[a.items[0].level] ?? 3) - (order[b.items[0].level] ?? 3))) {
    const level = g.items[0].level;
    const items = h('div', { class: 'stack', style: { gap: '4px', marginTop: '8px', display: 'none' } }, g.items.slice(0, 80).map((i) => h('div', { class: 'small mono muted' }, `${i.where} — ${i.message}`)));
    mount.append(h('div', { class: 'card', style: { marginBottom: '10px' } },
      h('div', { class: 'row' }, h('span', { style: { color: level === 'error' ? 'var(--err)' : level === 'warning' ? 'var(--warn)' : 'var(--info)' } }, icon(level === 'info' ? 'info' : 'alert', 17)),
        h('b', null, g.title), h('span', { class: 'badge' }, String(g.items.length)), h('span', { class: 'mono muted small' }, g.code), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', onclick: () => { items.style.display = items.style.display === 'none' ? 'flex' : 'none'; } }, t('web.health.details'))),
      g.why ? h('div', { class: 'muted', style: { marginTop: '6px' } }, g.why) : null,
      g.fix ? h('div', { style: { marginTop: '6px' } }, '→ ', g.fix) : null,
      items));
  }
}
