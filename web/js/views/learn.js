import { state, h, t, get, icon, empty, loading } from '../core.js';
import { setTitle, go } from '../main.js';

/** Flashcards from the KB's concept cards: see the term, recall, reveal, rate. Ratings stay in this browser. */
export async function render({ mount }) {
  setTitle(t('web.nav.learn'));
  mount.append(loading());
  const { cards } = await get('/api/cards');
  mount.replaceChildren();
  if (!cards.length) { mount.append(empty('🧠', t('web.learn.empty'), t('web.learn.emptyText'))); return; }
  const key = `okb-learn-${state.kb}`;
  let memory = {};
  try { memory = JSON.parse(localStorage.getItem(key) || '{}'); } catch { memory = {}; }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(memory)); } catch { /* ignore */ } };
  // Cards to review first: never seen, then "to review", then the oldest.
  const order = [...cards].sort((a, b) => (memory[a.path]?.score ?? -1) - (memory[b.path]?.score ?? -1) || (memory[a.path]?.at ?? 0) - (memory[b.path]?.at ?? 0));
  const session = order.slice(0, 12);
  let i = 0, known = 0;
  const box = h('div');
  mount.append(h('p', { class: 'lead' }, t('web.learn.lead')), box);
  const draw = (revealed = false) => {
    if (i >= session.length) {
      box.replaceChildren(h('div', { class: 'flash' }, h('div', null, h('div', { class: 'term' }, '🎉'), h('div', { class: 'def' }, t('web.learn.done', { known, total: session.length })),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px' } }, h('button', { class: 'btn primary', onclick: () => { i = 0; known = 0; draw(); } }, t('web.learn.again'))))));
      return;
    }
    const c = session[i];
    const rate = (score) => { memory[c.path] = { score, at: Date.now() }; save(); if (score > 0) known++; i++; draw(); };
    box.replaceChildren(
      h('div', { class: 'progress', style: { marginBottom: '14px' } }, h('div', { style: { width: `${(i / session.length) * 100}%` } })),
      h('div', { class: 'flash' }, h('div', null,
        h('div', { class: 'small muted' }, `${i + 1} / ${session.length}`),
        h('div', { class: 'term', style: { marginTop: '8px' } }, c.title),
        revealed ? h('div', { class: 'def' }, c.definition) : h('div', { class: 'def muted' }, t('web.learn.think')),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px' } },
          revealed
            ? [h('button', { class: 'btn', onclick: () => rate(0) }, '🔁 ', t('web.learn.again2')), h('button', { class: 'btn primary', onclick: () => rate(1) }, '✔ ', t('web.learn.knew')), h('button', { class: 'btn ghost', onclick: () => go(`#/note/${encodeURIComponent(c.path)}`) }, icon('notes', 15), t('web.learn.open'))]
            : h('button', { class: 'btn primary lg', onclick: () => draw(true) }, t('web.learn.reveal'))))));
  };
  draw();
  mount.append(h('div', { class: 'note-box info', style: { marginTop: '18px' } }, icon('sparkles', 16), h('div', null, t('web.learn.claude'), ' ', h('code', null, '/okb:learn'))));
}
