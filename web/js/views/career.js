import { h, t, get, icon, empty, loading } from '../core.js';
import { setTitle, go } from '../main.js';

/** The career side: STAR stories with their proofs, feedback, goals, what to do next, and whether a copy could leave. */
export async function render({ mount }) {
  setTitle(t('web.nav.career'));
  mount.append(loading());
  const data = await get('/api/career');
  mount.replaceChildren();
  if (!data.notes.length) {
    mount.append(empty('🧭', t('web.career.empty'), t('web.career.emptyText')));
    mount.append(h('div', { class: 'note-box info', style: { marginTop: '18px' } }, icon('sparkles', 16), h('div', null, t('web.career.claude'), ' ', h('code', null, '/okb:career'))));
    return;
  }
  mount.append(h('div', { class: 'grid cols-3' },
    h('div', { class: 'card' }, h('div', { class: 'small muted' }, t('web.career.stories')), h('div', { class: 'term' }, String(data.achievements.length))),
    h('div', { class: 'card' }, h('div', { class: 'small muted' }, t('web.career.feedback')), h('div', { class: 'term' }, String(data.feedback.count))),
    h('div', { class: 'card' }, h('div', { class: 'small muted' }, t('web.career.goals')), h('div', { class: 'term' }, `${data.goals.done} / ${data.goals.open + data.goals.done}`))));
  if (data.hints.length) {
    mount.append(h('div', { class: 'note-box warn', style: { marginTop: '14px' } }, icon('alert', 16), h('div', null, data.hints.map((x) => h('div', null, t(`career.hint.${x.key}`, { detail: x.detail }))))));
  }
  mount.append(h('h2', { style: { marginTop: '22px' } }, t('web.career.storiesTitle')), h('div', { class: 'card' }, h('div', { class: 'list' }, data.achievements.map((a) => h('div', { class: 'list-item', role: 'button', tabindex: '0', onclick: () => go(`#/note/${encodeURIComponent(a.path)}`) },
    h('span', null, '🏆'),
    h('div', { class: 'grow' }, h('b', null, a.title), h('div', { class: 'small muted' }, `${a.date ?? ''} · STAR ${a.star.length}/4${a.hasProof ? ' · ✓' : ''}${a.skills.length ? ` · ${a.skills.join(', ')}` : ''}`)))))));
  if (data.skills.length) {
    mount.append(h('h2', { style: { marginTop: '22px' } }, t('web.career.skills')), h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } }, data.skills.map((s) => h('span', { class: 'badge' }, `${s.skill} · ${s.stories}`))));
  }
  mount.append(h('div', { class: `note-box ${data.leaks ? 'warn' : 'info'}`, style: { marginTop: '18px' } }, icon(data.leaks ? 'alert' : 'check', 16), h('div', null, data.leaks ? t('web.career.leaks', { count: data.leaks }) : t('web.career.clean'), ' ', h('code', null, 'okb career check'))));
}
