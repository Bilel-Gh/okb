import { h, t, get, post, icon, empty, loading, errorToast } from '../core.js';
import { setTitle, go } from '../main.js';

/**
 * Spaced review: the cards due today (concept notes and « Q — R » lines of the
 * notes), recall, reveal, grade — OKB schedules the next review (FSRS). Below,
 * the skills map: how much of each subject is known.
 */
export async function render({ mount }) {
  setTitle(t('web.nav.learn'));
  mount.append(loading());
  const data = await get('/api/learn');
  mount.replaceChildren();
  const session = [...data.due, ...data.fresh];
  const box = h('div');
  mount.append(h('p', { class: 'lead' }, t('web.learn.lead2', { due: data.counts.due, fresh: data.fresh.length, cards: data.counts.cards })), box);
  if (!data.counts.cards) box.append(empty('🧠', t('web.learn.empty'), t('web.learn.emptyText2')));
  let i = 0, done = 0;
  const draw = (revealed = false) => {
    if (!session.length) return;
    if (i >= session.length) {
      box.replaceChildren(h('div', { class: 'flash' }, h('div', null, h('div', { class: 'term' }, '🎉'), h('div', { class: 'def' }, t('web.learn.done2', { done })))));
      return;
    }
    const c = session[i];
    const grade = async (rating) => {
      try { await post('/api/learn/grade', { id: c.id, rating }); done++; i++; draw(); } catch (e) { errorToast(e); }
    };
    box.replaceChildren(
      h('div', { class: 'progress', style: { marginBottom: '14px' } }, h('div', { style: { width: `${(i / session.length) * 100}%` } })),
      h('div', { class: 'flash' }, h('div', null,
        h('div', { class: 'small muted' }, `${i + 1} / ${session.length} · ${c.subject} · ${t(`learn.level.${c.level}`)}`),
        h('div', { class: 'term', style: { marginTop: '8px' } }, c.front),
        revealed ? h('div', { class: 'def' }, c.back) : h('div', { class: 'def muted' }, t('web.learn.think')),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' } },
          revealed
            ? [
              h('button', { class: 'btn', onclick: () => grade('again') }, '🔁 ', t('web.learn.r.again')),
              h('button', { class: 'btn', onclick: () => grade('hard') }, '😬 ', t('web.learn.r.hard')),
              h('button', { class: 'btn primary', onclick: () => grade('good') }, '✔ ', t('web.learn.r.good')),
              h('button', { class: 'btn', onclick: () => grade('easy') }, '⚡ ', t('web.learn.r.easy')),
              h('button', { class: 'btn ghost', onclick: () => go(`#/note/${encodeURIComponent(c.path)}`) }, icon('notes', 15), t('web.learn.open')),
            ]
            : h('button', { class: 'btn primary lg', onclick: () => draw(true) }, t('web.learn.reveal'))))));
  };
  if (session.length) draw();
  else if (data.counts.cards) box.append(empty('✅', t('web.learn.nothingDue'), t('web.learn.nothingDueText')));

  if (data.map.length) {
    mount.append(h('h2', { style: { marginTop: '26px' } }, t('web.learn.map')), h('div', { class: 'card' }, h('div', { class: 'list' }, data.map.map((m) => h('div', { class: 'list-item' },
      h('div', { class: 'grow' }, h('b', null, m.subject), h('div', { class: 'small muted' }, `★ ${m.levels.mastered} · ✓ ${m.levels.known} · … ${m.levels.learning} · ○ ${m.levels.new}`)),
      h('div', { style: { width: '140px' } }, h('div', { class: 'progress' }, h('div', { style: { width: `${m.percent}%` } }))),
      h('b', { style: { width: '48px', textAlign: 'right' } }, `${m.percent}%`))))));
  }
  if (data.objectives.length) {
    mount.append(h('h2', { style: { marginTop: '26px' } }, t('web.learn.objectives')), h('div', { class: 'card' }, h('div', { class: 'list' }, data.objectives.map((o) => h('div', { class: 'list-item' }, h('span', null, '🎯'), h('div', { class: 'grow' }, o.text, o.by ? h('div', { class: 'small muted' }, o.by) : null))))));
  }
  mount.append(h('div', { class: 'note-box info', style: { marginTop: '18px' } }, icon('sparkles', 16), h('div', null, t('web.learn.claude'), ' ', h('code', null, '/okb:learn'))));
}
