// The brain: its drawers and subjects, « Maintenant », each subject's page (its 5-minute summary and its index),
// and the suggestion cards waiting for the person's decision.
import { h, t, get, post, icon, badge, empty, loading, errorToast, toast, clear, cmdBox, rel } from '../core.js';
import { setTitle, go } from '../main.js';
import { enhance } from './notes.js';

const DRAWER_ICON = { inbox: '📥', world: '🌍', subjects: '📦', toolbox: '🧰', activity: '📅' };
const STAR = (n) => (n === null || n === undefined ? '' : `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`);

export async function render({ view, arg, mount }) {
  if (view === 'suggestions') return renderSuggestions(mount);
  mount.append(loading(5));
  const data = await get('/api/brain');
  clear(mount);
  if (!data.brain) {
    setTitle(t('web.brain.title'));
    mount.append(empty('🧠', t('web.brain.notYetTitle'), t('web.brain.notYetText'), h('div', { class: 'stack', style: { width: 'min(520px, 100%)' } }, cmdBox('okb brain migrate'))));
    return;
  }
  if (arg) return renderSubject(mount, arg, data);
  setTitle(`🧠 ${data.name}`);
  mount.append(nowCard(data), h('div', { style: { height: '16px' } }));
  if (data.suggestions) {
    mount.append(h('div', { class: 'card hover', role: 'button', tabindex: '0', onclick: () => go('#/suggestions') },
      h('div', { class: 'card-head' }, h('span', { style: { fontSize: '18px' } }, '💡'), h('h2', null, t('web.brain.suggestionsWaiting', { n: data.suggestions })), h('span', { class: 'spacer' }), h('span', { class: 'btn sm primary' }, t('web.brain.decide')))), h('div', { style: { height: '16px' } }));
  }
  mount.append(h('div', { class: 'grid cols-2' }, data.shape.drawers.map((d) => h('div', { class: 'card hover', role: 'button', tabindex: '0', onclick: () => go(`#/brain/${encodeURIComponent(d.folder)}`) },
    h('div', { class: 'card-head' }, h('span', { style: { fontSize: '20px' } }, DRAWER_ICON[d.drawer]), h('h2', null, d.folder), h('span', { class: 'spacer' }), badge(String(d.notes))),
    d.subjects.length
      ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, d.subjects.slice(0, 12).map((s) => h('a', { class: 'badge', href: `#/brain/${encodeURIComponent(s.folder)}`, onclick: (e) => e.stopPropagation() }, `${s.name} · ${s.notes}`)))
      : h('div', { class: 'small muted' }, t('web.brain.emptyDrawer'))))));
  if (data.shape.outside.length) mount.append(h('div', { style: { height: '12px' } }), h('div', { class: 'small muted' }, t('web.brain.outside', { n: data.shape.outside.length }), ' ', h('code', null, 'okb brain check')));
  mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'row' },
    h('a', { class: 'btn', href: '#/graph?brain=1' }, icon('graph', 16), t('web.brain.graph')),
    h('a', { class: 'btn', href: '#/health' }, icon('health', 16), t('web.brain.storage'))));
}

function nowCard(data) {
  const n = data.now;
  const objective = h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
    h('span', { class: 'muted small' }, t('web.brain.objective')),
    h('div', { class: 'grow' }, n.objective ? h('b', null, n.objective.text) : h('span', { class: 'muted' }, t('web.brain.noObjective'))),
    h('button', { class: 'btn sm ghost', onclick: async () => {
      const text = prompt(t('web.brain.objectiveQ'), n.objective?.text ?? '');
      if (text === null) return;
      try { await post('/api/now/objective', { text }); toast(t('web.brain.saved')); go(`#/brain?t=${Date.now()}`); } catch (e) { errorToast(e); }
    } }, icon('plus', 14), t('web.brain.change')));
  const rows = [];
  for (const tk of n.tickets) rows.push(h('div', { class: 'list-item wrap' }, '🔨', h('div', { class: 'grow' }, h('b', null, tk.ref), tk.title && tk.title !== tk.ref ? ` — ${tk.title}` : '', h('div', { class: 'small muted' }, tk.repos.join(', '), ' · ', rel(tk.updatedAt)))));
  for (const d of n.deadlines.slice(0, 5)) rows.push(h('a', { class: 'list-item', href: `#/note/${encodeURIComponent(d.path)}` }, '⏰', h('div', { class: 'grow' }, d.title), badge(d.due, d.days <= 2 ? 'warn' : '')));
  for (const w of n.waiting) rows.push(h('div', { class: 'list-item wrap' }, '⏳', h('div', { class: 'grow' }, w.text, w.who ? h('span', { class: 'muted' }, ` (${w.who})`) : null, h('div', { class: 'small muted' }, t('web.brain.waitingSince', { n: w.days }))),
    h('button', { class: 'btn sm', onclick: async () => { try { await post('/api/now/answered', { id: w.id }); go(`#/brain?t=${Date.now()}`); } catch (e) { errorToast(e); } } }, icon('check', 14), t('web.brain.answered'))));
  if (n.lastSession) rows.push(h('div', { class: 'list-item wrap' }, '⏸️', h('div', { class: 'grow' }, n.lastSession.summary, n.lastSession.next ? h('div', { class: 'small muted' }, `→ ${n.lastSession.next}`) : null)));
  if (n.pendingProposals) rows.push(h('a', { class: 'list-item', href: '#/review' }, '📝', h('div', { class: 'grow' }, t('web.brain.toReview', { n: n.pendingProposals }))));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { style: { fontSize: '18px' } }, '🎯'), h('h2', null, t('web.brain.now'))),
    objective,
    rows.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, rows) : h('div', { class: 'small muted', style: { marginTop: '8px' } }, t('web.brain.nothingNow')));
}

async function renderSubject(mount, folder, data) {
  mount.append(loading(6));
  const index = await get('/api/brain/index', { folder });
  clear(mount);
  setTitle(index.title, `🧠 ${data.name}`);
  const crumbs = h('div', { class: 'row small muted', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
    h('a', { href: '#/brain' }, `🧠 ${data.name}`),
    index.crumbs.map((c) => [' › ', c.path ? h('a', { href: `#/note/${encodeURIComponent(c.path)}` }, c.title) : c.title]),
    ' › ', h('b', null, index.title));
  mount.append(crumbs);
  if (index.hubHtml) {
    const article = h('article', { class: 'reader card', html: index.hubHtml });
    await enhance(article);
    mount.append(article);
  } else {
    mount.append(h('div', { class: 'card flat' }, h('div', { class: 'small muted' }, t('web.brain.noSummary'))));
  }
  mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'row' }, h('a', { class: 'btn sm', href: `#/graph?brain=1&focus=${encodeURIComponent(folder)}` }, icon('graph', 14), t('web.graph.see'))));
  if (!index.items.length) { mount.append(h('div', { class: 'small muted', style: { marginTop: '16px' } }, t('web.brain.emptySubject'))); return; }
  for (const g of index.groups) {
    mount.append(h('div', { class: 'nav-label', style: { padding: '14px 0 6px' } }, g.name ? g.name.replace(/^Code\//, '💻 ').replace(/\//g, ' › ') : t('web.brain.root')),
      h('div', { class: 'list' }, g.items.map((it) => h('a', { class: 'list-item wrap', href: it.hub ? `#/brain/${encodeURIComponent(it.path.split('/').slice(0, -1).join('/'))}` : `#/note/${encodeURIComponent(it.path)}` },
        h('span', null, it.hub ? '📌' : '📄'),
        h('div', { class: 'grow' }, h('div', null, it.title, it.status === 'draft' ? h('span', { class: 'muted small' }, ` · ${t('web.brain.draft')}`) : null), it.description ? h('div', { class: 'small muted' }, it.description) : null),
        index.stars[it.path] !== null && index.stars[it.path] !== undefined ? h('span', { class: 'small', title: t('web.brain.scoreHint'), style: { color: 'var(--warn)' } }, STAR(index.stars[it.path])) : null))));
  }
}

async function renderSuggestions(mount) {
  setTitle(t('web.nav.suggestions'));
  mount.append(loading(4));
  const data = await get('/api/suggestions');
  clear(mount);
  const pct = data.budget.daily ? Math.min(100, Math.round((data.budget.spent / data.budget.daily) * 100)) : 0;
  mount.append(h('p', { class: 'lead muted' }, t('web.suggest.lead')),
    data.budget.daily ? h('div', { class: 'stack', style: { gap: '4px', marginBottom: '16px' } },
      h('div', { class: 'row small muted', style: { justifyContent: 'space-between' } }, h('span', null, t('web.suggest.budget')), h('span', null, `${data.budget.spent.toLocaleString()} / ${data.budget.daily.toLocaleString()} tokens`)),
      h('div', { class: 'progress' }, h('div', { style: { width: `${pct}%` } }))) : null);
  if (!data.suggestions.length) mount.append(empty('💡', t('web.suggest.emptyTitle'), t('web.suggest.emptyText')));
  for (const s of data.suggestions) {
    const decide = (decision) => async () => {
      try { await post('/api/suggestions/decide', { id: s.id, decision }); toast(t(`web.suggest.decided.${decision}`)); go(`#/suggestions?t=${Date.now()}`); } catch (e) { errorToast(e); }
    };
    mount.append(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'card-head' }, h('span', { style: { fontSize: '18px' } }, '💡'), h('h2', null, s.title), h('span', { class: 'spacer' }), badge(`${t('web.suggest.pertinence')} ${s.pertinence.total}/100`, s.pertinence.total >= 80 ? 'brand' : '')),
      h('table', { class: 'table' }, h('tbody', null,
        h('tr', null, h('td', { class: 'muted' }, t('web.suggest.where')), h('td', null, s.breadcrumb, s.path ? h('div', { class: 'small muted mono' }, s.path) : null)),
        h('tr', null, h('td', { class: 'muted' }, t('web.suggest.why')), h('td', null, s.why)),
        h('tr', null, h('td', { class: 'muted' }, t('web.suggest.already')), h('td', null, s.overlaps.length ? s.overlaps.slice(0, 3).map((o) => h('a', { class: 'badge', href: `#/note/${encodeURIComponent(o.path)}` }, o.title)) : t('web.suggest.nothingClose'))),
        h('tr', null, h('td', { class: 'muted' }, t('web.suggest.recommendation')), h('td', null, t(`web.suggest.rec.${s.recommendation}`))),
        h('tr', null, h('td', { class: 'muted' }, t('web.suggest.cost')), h('td', null, `${s.cost.size} · ≈ ${s.cost.tokens.toLocaleString()} tokens`)))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', onclick: decide('accept') }, icon('check', 16), t('web.suggest.accept')),
        h('button', { class: 'btn', onclick: decide('later') }, t('web.suggest.laterBtn')),
        h('button', { class: 'btn ghost', onclick: decide('decline') }, icon('x', 16), t('web.suggest.declineBtn'))),
      s.status === 'later' ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, t('web.suggest.keptForLater')) : null));
  }
  if (data.gaps.length) {
    mount.append(h('div', { class: 'card flat', style: { marginTop: '16px' } }, h('h3', null, `🔎 ${t('web.suggest.gaps')}`),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, data.gaps.map((g) => badge(`${g.query} ×${g.times}`)))));
  }
  mount.append(h('p', { class: 'small muted', style: { marginTop: '16px' } }, t('web.suggest.afterAccept')));
}
