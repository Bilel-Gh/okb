import { h, t, get, icon, empty, loading, TYPE_ICON, categories, catDot, catOf } from '../core.js';
import { setTitle, go } from '../main.js';

function highlight(text, words) {
  if (!words.length) return [text];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark', { style: { background: 'var(--brand-soft)', color: 'inherit', borderRadius: '4px', padding: '0 2px' } }, part) : part));
}

export async function render({ query, mount }) {
  setTitle(t('web.nav.search'));
  const q = query.get('q') ?? '';
  const input = h('input', { class: 'input', value: q, placeholder: t('ask.placeholder'), style: { fontSize: '16px', padding: '12px 14px' } });
  const form = h('form', { class: 'row', style: { flexWrap: 'nowrap', marginBottom: '18px' }, onsubmit: (e) => { e.preventDefault(); go(`#/search?q=${encodeURIComponent(input.value.trim())}`); } },
    input, h('button', { class: 'btn primary lg' }, icon('search', 16), t('web.search.go')));
  const results = h('div', { class: 'stack' });
  mount.append(form, results);
  setTimeout(() => input.focus(), 30);
  if (!q) {
    results.append(empty('🔎', t('web.search.title'), t('web.search.text')));
    return;
  }
  results.append(loading(5));
  const r = await get('/api/search', { q });
  results.replaceChildren();
  if (!r.hits.length) { results.append(empty('🤔', t('ask.none'), t('ask.noneTip'))); return; }
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  results.append(h('div', { class: 'muted small' }, t('ask.found', { n: r.hits.length, query: q })));
  const cats = await categories().catch(() => []);
  for (const hit of r.hits) {
    const ev = r.evidence.filter((e) => e.path === hit.path).slice(0, 3);
    results.append(h('div', { class: 'card hover', onclick: () => go(`#/note/${encodeURIComponent(hit.path)}`) },
      h('div', { class: 'row' }, cats.length ? catDot(catOf(cats, hit.noteCategory), 10) : h('span', null, TYPE_ICON[hit.type] ?? '📄'), h('b', null, hit.title), h('span', { class: 'mono muted' }, hit.path)),
      hit.description ? h('div', { class: 'muted', style: { marginTop: '4px' } }, hit.description) : null,
      ev.length ? h('div', { class: 'stack', style: { marginTop: '10px', gap: '6px' } }, ev.map((e) => h('div', { class: 'small', style: { borderLeft: '3px solid var(--brand)', paddingLeft: '10px', color: 'var(--text-2)' } },
        highlight(e.quote.replace(/\s+/g, ' ').slice(0, 280), words), h('span', { class: 'muted' }, ` · l.${e.line}`)))) : null));
  }
  if (r.prerequisites?.length) results.append(h('div', { class: 'note-box info' }, icon('info', 16), h('div', null, h('b', null, t('ask.prereq')), ' ', r.prerequisites.map((p) => h('a', { href: `#/note/${encodeURIComponent(p.path)}`, style: { marginRight: '8px' } }, p.title ?? p.path)))));
}
